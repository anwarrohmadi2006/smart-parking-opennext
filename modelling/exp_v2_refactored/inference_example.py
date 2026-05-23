"""
SmartPark AI — Contoh Kode Inference Sederhana (Standalone)
Menunjukkan cara meload model, scaler, dan menjalankan prediksi occupancy.
"""

import pickle
import numpy as np
from pathlib import Path

# Setup current working directory path for loading files
BASE_DIR = Path(__file__).resolve().parent

def run_inference():
    print("⏳ Meload model dan scaler...")
    
    # 1. Load Scaler & Feature list
    try:
        with open(BASE_DIR / 'scaler_X.pkl', 'rb') as f:
            scaler_X = pickle.load(f)
        with open(BASE_DIR / 'scaler_y.pkl', 'rb') as f:
            scaler_y = pickle.load(f)
        with open(BASE_DIR / 'feature_cols.pkl', 'rb') as f:
            feature_cols = pickle.load(f)
    except FileNotFoundError as e:
        print(f"❌ Error: File scaler/feature tidak ditemukan di {BASE_DIR}. Pastikan Anda berada di direktori yang benar.")
        print(e)
        return

    # 2. Load Model Keras (.keras format siap produksi)
    import tensorflow as tf
    model_path = BASE_DIR / 'best_clstan.keras'
    if not model_path.exists():
        print(f"❌ Error: Model {model_path} tidak ditemukan.")
        return
        
    model = tf.keras.models.load_model(str(model_path), compile=False)
    print("✅ Model dan Scaler berhasil dimuat.")

    # 3. Membuat Dummy Data Window (18 Baris x 27 Fitur)
    # Di dunia nyata, ini diisi dengan 18 baris pengamatan parkir teraktual.
    window_size = 18
    num_features = len(feature_cols)
    
    # Buat dummy input dengan occupancy awal ~0.65
    dummy_raw_data = np.random.normal(loc=0.5, scale=0.1, size=(window_size, num_features))
    # Kolom ke-0 biasanya occupancy_rate
    dummy_raw_data[:, 0] = np.linspace(0.60, 0.70, window_size)

    # 4. Melakukan Scaling Input
    # Scaler di-fit strictly di train set untuk mencegah data leakage
    dummy_scaled_data = scaler_X.transform(dummy_raw_data)
    
    # Reshape menjadi batch (1, window_size, num_features)
    input_sequence = dummy_scaled_data.reshape(1, window_size, num_features)
    print(f"Input Sequence Shape: {input_sequence.shape}")

    # 5. Menjalankan Prediksi Model
    pred_scaled = model.predict(input_sequence, verbose=0).flatten()[0]
    print(f"Prediksi Scaled Space: {pred_scaled:.5f}")

    # 6. Melakukan Inverse Transform ke Skala Asli (0.0 - 1.0)
    pred_unscaled = scaler_y.inverse_transform(np.array([[pred_scaled]]))[0, 0]
    pred_unscaled = np.clip(pred_unscaled, 0.0, 1.0)
    
    print("\n--- Hasil Prediksi ---")
    print(f"Prediksi Occupancy Rate (30 menit ke depan): {pred_unscaled:.5f}")
    print(f"Persentase Keterisian Parkir                : {pred_unscaled * 100:.2f}%")
    print("----------------------")

if __name__ == "__main__":
    run_inference()
