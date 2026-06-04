import os
import pickle
import numpy as np
import pandas as pd
from pathlib import Path

import modal

app = modal.App("smartpark-ab-test-bootstrap")

tf_image = (
    modal.Image.from_registry("tensorflow/tensorflow:2.15.0-gpu")
    .pip_install("numpy<2.0", "scikit-learn", "pandas", "scipy")
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/CNRParkEXT (1).csv",
        remote_path="/root/CNRParkEXT (1).csv"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/best_clstan.keras",
        remote_path="/root/best_clstan.keras"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/scaler_X.pkl",
        remote_path="/root/scaler_X.pkl"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/scaler_y.pkl",
        remote_path="/root/scaler_y.pkl"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/feature_cols.pkl",
        remote_path="/root/feature_cols.pkl"
    )
)

@app.function(image=tf_image, gpu="T4", timeout=3600)
def run_bootstrap_test():
    import tensorflow as tf
    from tensorflow.keras import layers

    print("🚀 Memulai Uji Block Bootstrapping di Modal.com...")
    
    class TemporalAttention(layers.Layer):
        def __init__(self, **kw):
            super().__init__(**kw)
            self.score = layers.Dense(1)
        def call(self, x):
            w = tf.nn.softmax(self.score(x), axis=1)
            return tf.reduce_sum(x * w, axis=1)

    print("⏳ Memuat Model & Data (Skenario 30 Menit Kedepan)...")
    with open("/root/scaler_X.pkl", "rb") as f: scaler_X = pickle.load(f)
    with open("/root/scaler_y.pkl", "rb") as f: scaler_y = pickle.load(f)
    with open("/root/feature_cols.pkl", "rb") as f: FEATURE_COLS = pickle.load(f)

    model_A = tf.keras.models.load_model(
        "/root/best_clstan.keras", 
        custom_objects={'TemporalAttention': TemporalAttention},
        compile=False
    )
    
    df = pd.read_csv("/root/CNRParkEXT (1).csv", low_memory=False)
    dt_series = df['datetime'].astype(str).str.replace('_', ' ', regex=False).str.replace('.', ':', regex=False)
    df['timestamp'] = pd.to_datetime(dt_series, format='mixed', errors='coerce')
    df['weather'] = df['weather'].map({'S': 'SUNNY', 'C': 'OVERCAST', 'R': 'RAINY'}).fillna('UNKNOWN')

    df_ts = df.dropna(subset=['timestamp']).groupby('timestamp').agg(
        occupied_slots=('occupancy', 'sum'),
        total_patches=('occupancy', 'count'),
        weather=('weather', 'first')
    ).reset_index()
    df_ts['occupancy_rate'] = (df_ts['occupied_slots'] / df_ts['total_patches']).clip(0, 1)
    df_ts = df_ts.set_index('timestamp')

    df_uni = df_ts.resample('10min').agg({'weather': 'first', 'occupancy_rate': 'mean'}).reset_index()
    df_uni['occupancy_rate'] = df_uni['occupancy_rate'].interpolate(limit_direction='both').clip(0, 1)
    df_uni['weather'] = df_uni['weather'].ffill().bfill().fillna('UNKNOWN')
    df_uni['hour'] = df_uni['timestamp'].dt.hour
    df_uni['day_of_week'] = df_uni['timestamp'].dt.dayofweek
    df_uni['is_weekend'] = (df_uni['day_of_week'] >= 5).astype(int)

    weather_map = {'SUNNY': 0, 'OVERCAST': 1, 'RAINY': 2, 'UNKNOWN': 0}
    df_uni['weather_encoded'] = df_uni['weather'].map(weather_map).fillna(0).astype(int)
    df_uni['hour_sin'] = np.sin(2 * np.pi * df_uni['hour'] / 24)
    df_uni['hour_cos'] = np.cos(2 * np.pi * df_uni['hour'] / 24)
    df_uni['dow_sin']  = np.sin(2 * np.pi * df_uni['day_of_week'] / 7)
    df_uni['dow_cos']  = np.cos(2 * np.pi * df_uni['day_of_week'] / 7)
    df_uni['is_morning_peak'] = df_uni['hour'].between(8, 11).astype(int)
    df_uni['is_evening_peak'] = df_uni['hour'].between(16, 19).astype(int)
    df_uni['is_rush_hour']    = df_uni['hour'].isin([7, 8, 9, 16, 17, 18]).astype(int)

    for lag in [1, 2, 3, 6, 12, 24, 48]: df_uni[f'lag_{lag}'] = df_uni['occupancy_rate'].shift(lag)
    for w in [3, 6, 12, 24, 48]:
        df_uni[f'roll_mean_{w}'] = df_uni['occupancy_rate'].rolling(w, min_periods=1).mean()
        df_uni[f'roll_std_{w}']  = df_uni['occupancy_rate'].rolling(w, min_periods=1).std().fillna(0)

    df_uni['momentum'] = df_uni['occupancy_rate'].diff().fillna(0)
    df_uni['acceleration'] = df_uni['momentum'].diff().fillna(0)
    df_uni['ema_01'] = df_uni['occupancy_rate'].ewm(alpha=0.1).mean()
    df_uni['ema_03'] = df_uni['occupancy_rate'].ewm(alpha=0.3).mean()

    TARGET_HORIZON = 3 # 30 menit ke depan
    df_uni['target_occ'] = df_uni['occupancy_rate'].shift(-TARGET_HORIZON)
    df_clean = df_uni.dropna(subset=FEATURE_COLS + ['target_occ']).reset_index(drop=True)

    WINDOW_SIZE = 18
    val_end = int(0.85 * len(df_clean))
    df_test = df_clean.iloc[val_end:].reset_index(drop=True)

    X_test_scaled = df_test.copy()
    X_test_scaled[FEATURE_COLS] = scaler_X.transform(df_test[FEATURE_COLS])
    
    X_batch, y_actual, y_naive = [], [], []
    for i in range(len(df_test) - WINDOW_SIZE):
        X_batch.append(X_test_scaled[FEATURE_COLS].iloc[i:i+WINDOW_SIZE].values)
        y_actual.append(df_test['target_occ'].iloc[i+WINDOW_SIZE])
        y_naive.append(df_test['occupancy_rate'].iloc[i+WINDOW_SIZE-1])
        
    X_batch = np.array(X_batch, dtype=np.float32)
    y_actual = np.array(y_actual)
    y_naive = np.array(y_naive)
    
    pred_A_scaled = model_A.predict(X_batch, verbose=0).flatten()
    pred_A = scaler_y.inverse_transform(pred_A_scaled.reshape(-1, 1)).flatten().clip(0, 1)

    mae_A = np.abs(pred_A - y_actual)
    mae_B = np.abs(y_naive - y_actual)
    
    # Perbedaan error (Positif artinya Model B lebih baik, Negatif artinya Model A lebih baik)
    diff = mae_A - mae_B

    print("\n" + "="*50)
    print("🔄 MENJALANKAN BLOCK BOOTSTRAPPING (10.000 Iterasi)")
    print("="*50)
    
    n_samples = len(diff)
    block_size = 144 # 144 steps = 1 hari (karena data per 10 menit)
    n_blocks = n_samples // block_size
    n_iterations = 10000
    
    bootstrap_means = []
    
    for i in range(n_iterations):
        # Mengambil sampel acak dari blok indeks
        # Menjaga autokorelasi dalam 1 hari
        random_starts = np.random.randint(0, n_samples - block_size, size=n_blocks)
        boot_sample = []
        for start in random_starts:
            boot_sample.extend(diff[start:start+block_size])
        
        bootstrap_means.append(np.mean(boot_sample))
    
    bootstrap_means = np.array(bootstrap_means)
    
    # Hitung p-value: persentase di mana perbedaan error menyeberang ke angka < 0 
    # (Di dunia nyata, Model A (CLSTAN) kalah karena diff > 0. P-value adalah berapa kali CLSTAN menang secara kebetulan)
    p_value_boot = np.sum(bootstrap_means < 0) / n_iterations
    
    mean_diff_observed = np.mean(diff)
    conf_interval = np.percentile(bootstrap_means, [2.5, 97.5])

    print(f"Rata-rata MAE Model A (CLSTAN) : {np.mean(mae_A):.5f}")
    print(f"Rata-rata MAE Model B (Naive)  : {np.mean(mae_B):.5f}")
    print(f"Selisih Error Rata-rata        : {mean_diff_observed:.5f} (Selisih positif = B lebih baik)")
    print(f"Ukuran Blok Waktu              : {block_size} (1 Hari / 24 Jam)")
    print("-" * 50)
    print("🔬 HASIL BLOCK BOOTSTRAPPING")
    print(f"95% Confidence Interval (Selisih Error): [{conf_interval[0]:.5f}, {conf_interval[1]:.5f}]")
    print(f"P-Value (Bootstrapped)                 : {p_value_boot:.5f}")
    
    if p_value_boot < 0.05:
        print("\n✅ KESIMPULAN: Perbedaan Performa SANGAT SIGNIFIKAN secara statistik (P < 0.05).")
        print("Meskipun kita menggunakan uji statistik yang jauh lebih ketat (Block Bootstrapping)")
        print("Model Baseline masih terbukti secara konsisten lebih baik untuk prediksi 30 menit.")
    else:
        print("\n❌ KESIMPULAN: Perbedaan performa TIDAK SIGNIFIKAN secara statistik.")
        print("Dengan uji Block Bootstrapping, terbukti bahwa kemenangan Baseline hanyalah kebetulan (noise).")
    print("="*50 + "\n")

@app.local_entrypoint()
def main():
    print("📡 Mengirim job Bootstrapping ke Modal.com...")
    run_bootstrap_test.remote()

if __name__ == "__main__":
    main()
