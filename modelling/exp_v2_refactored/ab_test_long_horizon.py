import os
import pickle
import numpy as np
import pandas as pd

# Modal definition
import modal

app = modal.App("smartpark-ab-test-long-horizon")

# Setup Image
tf_image = (
    modal.Image.from_registry("tensorflow/tensorflow:2.15.0-gpu")
    .pip_install("numpy<2.0", "scikit-learn", "pandas", "scipy")
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/CNRParkEXT (1).csv",
        remote_path="/root/CNRParkEXT (1).csv"
    )
)

@app.function(image=tf_image, gpu="L4", timeout=3600)
def run_long_horizon_test():
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers, Model
    from sklearn.preprocessing import StandardScaler
    from scipy import stats

    print("🚀 Memulai Simulasi A/B Testing JANGKA PANJANG (3 JAM) di Modal.com...")
    
    # 1. Load Data
    print("📊 Memproses dataset...")
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

    # Features
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

    # -------------------------------------------------------------
    # PENTING: Target Horizon diubah menjadi 18 (18 x 10 mnt = 3 Jam)
    # -------------------------------------------------------------
    TARGET_HORIZON = 18 
    df_uni['target_occ'] = df_uni['occupancy_rate'].shift(-TARGET_HORIZON)
    
    FEATURE_COLS = [
        'occupancy_rate', 'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
        'is_weekend', 'weather_encoded', 'is_morning_peak', 'is_evening_peak', 'is_rush_hour',
        'lag_1', 'lag_2', 'lag_3', 'lag_6', 'lag_12', 'lag_24', 'lag_48',
        'roll_mean_3', 'roll_std_3', 'roll_mean_6', 'roll_std_6', 'roll_mean_12', 'roll_std_12',
        'momentum', 'acceleration', 'ema_01', 'ema_03'
    ]
    df_clean = df_uni.dropna(subset=FEATURE_COLS + ['target_occ']).reset_index(drop=True)

    # 2. Split Data & Scale
    WINDOW_SIZE = 18
    n = len(df_clean)
    train_end = int(0.70 * n)
    val_end   = int(0.85 * n)

    scaler_X = StandardScaler()
    scaler_y = StandardScaler()
    
    scaler_X.fit(df_clean.iloc[:train_end][FEATURE_COLS])
    scaler_y.fit(df_clean.iloc[:train_end]['target_occ'].values.reshape(-1, 1))

    df_sc = df_clean.copy()
    df_sc[FEATURE_COLS] = scaler_X.transform(df_clean[FEATURE_COLS])
    y_raw = df_clean['target_occ'].values.reshape(-1, 1)
    y_scaled = scaler_y.transform(y_raw).flatten()

    def create_sequences(data_feat, y_vals, window):
        X, y = [], []
        for i in range(len(data_feat) - window):
            X.append(data_feat[FEATURE_COLS].iloc[i:i+window].values)
            y.append(y_vals[i+window])
        return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)

    X_seq, y_seq = create_sequences(df_sc, y_scaled, WINDOW_SIZE)
    y_seq_raw = y_raw[WINDOW_SIZE:].flatten()

    train_end_seq = int(0.70 * len(X_seq))
    val_end_seq   = int(0.85 * len(X_seq))

    X_train, y_train = X_seq[:train_end_seq], y_seq[:train_end_seq]
    X_val,   y_val   = X_seq[train_end_seq:val_end_seq], y_seq[train_end_seq:val_end_seq]
    X_test,  y_test  = X_seq[val_end_seq:], y_seq[val_end_seq:]
    y_test_raw       = y_seq_raw[val_end_seq:]

    # 3. Build & Fast Train CLSTAN for 3-Hour Prediction
    print("⏳ Melatih ulang CLSTAN khusus untuk prediksi 3 Jam ke depan (Fast Training)...")
    
    class TemporalAttention(layers.Layer):
        def __init__(self, **kw):
            super().__init__(**kw)
            self.score = layers.Dense(1)
        def call(self, x):
            w = tf.nn.softmax(self.score(x), axis=1)
            return tf.reduce_sum(x * w, axis=1)

    inp = layers.Input(shape=(WINDOW_SIZE, len(FEATURE_COLS)))
    x   = layers.Conv1D(64, 3, padding='same', activation='relu')(inp)
    x   = layers.Bidirectional(layers.GRU(64, return_sequences=True))(x)
    x   = layers.Dropout(0.2)(x)
    x   = TemporalAttention()(x)
    x   = layers.Dense(32, activation='relu')(x)
    out = layers.Dense(1)(x)
    
    model_A = Model(inp, out, name='CLSTAN_LongHorizon')
    model_A.compile(optimizer='adam', loss='mse', metrics=['mae'])
    
    # Train singkat 15 epoch
    model_A.fit(X_train, y_train, validation_data=(X_val, y_val), epochs=15, batch_size=64, verbose=0)
    print("✅ Training Selesai.")

    # 4. A/B Testing on Test Set
    print("🧮 Menjalankan A/B Test pada Test Set...")
    pred_A_scaled = model_A.predict(X_test, verbose=0).flatten()
    pred_A = scaler_y.inverse_transform(pred_A_scaled.reshape(-1, 1)).flatten().clip(0, 1)

    # Naive Baseline: Tebakan sama dengan observasi terakhir di window (iloc[i+window-1])
    # Di X_test, observasi terakhir ada di indeks [..., -1, 0] asumsi kolom 0 adalah 'occupancy_rate'
    last_obs_scaled = X_test[:, -1, 0] 
    
    # Inverse transform kolom 0 (karena scaler_X nge-scale 27 fitur, kita ambil trik dari df_clean asli)
    # Untuk gampangnya, ambil langsung dari df_clean
    test_start_idx = val_end_seq + WINDOW_SIZE
    y_naive = df_clean['occupancy_rate'].iloc[test_start_idx - 1 : test_start_idx - 1 + len(y_test_raw)].values

    mae_A = np.abs(pred_A - y_test_raw)
    mae_B = np.abs(y_naive - y_test_raw)

    mean_A = np.mean(mae_A)
    mean_B = np.mean(mae_B)
    
    print("\n" + "="*60)
    print("📈 HASIL SIMULASI A/B TESTING (PREDIKSI 3 JAM KEDEPAN)")
    print("="*60)
    print(f"Skenario   : Prediksi 18 Langkah (3 Jam) ke depan")
    print(f"Data Points: {len(y_test_raw)} sampel")
    print(f"Model A    : CLSTAN (Trained for 3 Hours)")
    print(f"Model B    : Baseline Naive (Persistensi / Kondisi 3 Jam Lalu)")
    print("-" * 60)
    print(f"Rata-rata Error (MAE) Model A : {mean_A:.5f} ({mean_A*100:.2f}%)")
    print(f"Rata-rata Error (MAE) Model B : {mean_B:.5f} ({mean_B*100:.2f}%)")
    
    t_stat, p_value = stats.ttest_ind(mae_A, mae_B)
    
    print("-" * 60)
    print("🔬 UJI STATISTIK T-TEST (Independent Samples)")
    print(f"T-Statistic : {t_stat:.4f}")
    print(f"P-Value     : {p_value:.5e}")
    
    if p_value < 0.05:
        print("\n✅ KESIMPULAN: Perbedaan Performa SANGAT SIGNIFIKAN secara statistik (P < 0.05).")
        if mean_A < mean_B:
            print("🏆 PEMENANG MULTLAK: MODEL A (CLSTAN).")
            print("AI Canggih Anda berhasil melihat pola cuaca dan jam sibuk untuk menebak 3 jam ke depan!")
            print("Sementara Model Baseline hancur lebur karena 3 jam adalah waktu yang lama untuk parkiran.")
        else:
            print("🏆 PEMENANG: MODEL B (Baseline).")
    else:
        print("\n❌ KESIMPULAN: Perbedaan performa TIDAK SIGNIFIKAN secara statistik.")
    print("="*60 + "\n")

@app.local_entrypoint()
def main():
    print("📡 Mengirim job retrain & test ke Modal.com...")
    run_long_horizon_test.remote()

if __name__ == "__main__":
    main()
