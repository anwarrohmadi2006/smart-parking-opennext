# SmartPark AI 🚗🤖

SmartPark AI adalah sistem prediksi okupansi parkir cerdas berbasis Deep Learning (Bi-Directional GRU-LSTM / BiDir) yang di-deploy ke arsitektur Cloud Serverless. Aplikasi ini dibangun dengan stack modern menggunakan Next.js (OpenNext), Modal.com untuk AI inference, dan Firebase untuk real-time data layer.

## 🌟 Fitur Utama
- **Real-Time Prediction**: Prediksi tingkat okupansi 30 menit ke depan dengan sangat akurat memanfaatkan *Temporal Attention* dan arsitektur *Residual LSTM*.
- **Admin Dashboard**: Visualisasi analitik okupansi secara real-time.
- **AI Recommendation Engine**: Memberikan saran *actionable* kepada admin parkir di lapangan jika terdeteksi anomali atau potensi penuh.
- **Serverless Cloud**: Backend AI berjalan secara efisien di Modal.com, sementara frontend di-host menggunakan OpenNext / Vercel.

## 📂 Struktur Proyek Terpenting
- `/app` - Halaman utama Next.js (Dashboard Admin & API Proxy).
- `/modelling` - *Source code* untuk training AI, evaluasi W&B, dan deployment cloud API (`smartpark_api.py`) ke Modal.com.
- `/lib` - Koneksi Firebase dan Utilities.
- `/tests` - Skrip verifikasi mandiri akurasi model AI.

## 🚀 Cara Menjalankan Secara Lokal

1. **Install dependensi Node.js**
   ```bash
   npm install
   ```

2. **Konfigurasi Environment**
   Gunakan `.env.example` sebagai referensi untuk membuat file `.env.local`. Pastikan *keys* Firebase dan Modal (jika diperlukan) sudah terisi.

3. **Jalankan Development Server**
   ```bash
   npm run dev
   ```

Aplikasi akan berjalan di `http://localhost:3000`.

## 🧠 Deployment Model AI
Model AI dikelola terpisah di platform Modal.com untuk *high-performance inference*. Untuk mendeploy ulang:
```bash
cd modelling/exp_v2_refactored
modal deploy smartpark_api.py
```
