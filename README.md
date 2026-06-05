# SmartPark AI: Sistem Manajemen Parkir Cerdas Berbasis IoT dan Prediksi Okupansi

![SmartPark AI](https://img.shields.io/badge/Project-Coding_Camp_2026-blue.svg)
![Status](https://img.shields.io/badge/Status-100%25_Selesai-success.svg)

> Proyek ini dikembangkan untuk memenuhi kualifikasi **Capstone Project - Coding Camp 2026 powered by DBS Foundation**.

## 📋 Informasi Tim (CC26-PRU436)

**Tema yang Dipilih:** Inclusive & Resilient Communities

**Nama Advisor Capstone:**
- Adinda Puji Rahmawaty (14 Mei 2026)
- Arfara Yema Samgusdian (21 Mei 2026)

**Anggota Tim:**
1. `CDCC889D6Y0610` - Anwar Rohmadi (Data Science) - [Aktif]
2. `CDCC002D6X0602` - Audie Quisha Jerome Tampubolon (Data Science) - [Aktif]
3. `CACC222D6X0903` - Salwa Sayyidati Azkia (Artificial Intelligence) - [Aktif]
4. `CACC010D6Y0898` - Gerardus Jeremy H. (Artificial Intelligence) - [Aktif]
5. `CFCC846D6Y1299` - Ryan Fajar Ramadhani (Full Stack Developer) - [Aktif]
6. `CFCC308D6Y1164` - M. Faiz Septian (Full Stack Developer) - [Aktif]

---

## 🎯 Ringkasan Eksekutif

### Latar Belakang & Problem Statement
Permasalahan pengelolaan parkir merupakan isu nyata yang berdampak langsung pada mobilitas dan kenyamanan komunitas urban. Sistem parkir konvensional yang ada saat ini umumnya hanya mencatat transaksi kendaraan masuk dan keluar tanpa menyediakan informasi ketersediaan slot secara real-time maupun kapabilitas prediksi ke depan. Kondisi ini mengakibatkan pemborosan waktu pengguna, antrean yang tidak terkelola, serta ketidakmampuan pengelola dalam mengambil keputusan berbasis data.

Pada sisi teknis, sistem deteksi berbasis kamera konvensional memiliki keterbatasan yang signifikan: akurasi deteksi sering menurun tajam akibat variasi pencahayaan, bayangan (*shadow*), atau kondisi kendaraan yang tertutup sebagian (*partial occlusion*). 

**Problem Statement:**
Bagaimana membangun sistem prediksi okupansi parkir yang mampu memantau ketersediaan slot secara cerdas, menghasilkan prediksi jangka pendek (30 menit ke depan) secara akurat, dan menyajikannya melalui dashboard analitik yang dapat diakses pengelola secara real-time?

### Research Questions
1. Bagaimana membangun dan melatih model deep learning berbasis TensorFlow yang mampu memprediksi tingkat okupansi parkir dalam rentang waktu 30 menit ke depan dengan performa tinggi menggunakan dataset CNRPark+EXT?
2. Bagaimana mengintegrasikan model AI yang telah dilatih ke dalam arsitektur serverless cloud (Modal.com) agar dapat memberikan prediksi secara efisien dan scalable melalui REST API?
3. Bagaimana menyajikan hasil prediksi dan analitik data melalui antarmuka web yang interaktif (Next.js & Firebase) serta dashboard analitik berbasis Streamlit agar informasi dapat dipahami dan dimanfaatkan secara optimal oleh pengelola parkir?

### Solusi yang Ditawarkan
**SmartPark AI** adalah sistem prediksi okupansi parkir cerdas yang memadukan tiga komponen utama: 
1. **Model Deep Learning TensorFlow:** Arsitektur *Bidirectional LSTM (BiDir)* dengan margin error hanya 1,4% untuk prediksi okupansi jangka pendek.
2. **Serverless AI API:** Berbasis Modal.com untuk melayani *inference* model secara efisien di cloud.
3. **Web Dashboard & Analytics:** Dashboard Admin berbasis Next.js yang terhubung dengan Firebase sebagai *real-time data layer*, dilengkapi dashboard analitik interaktif Streamlit.

Proyek ini relevan dengan tema **Inclusive & Resilient Communities** karena secara langsung mendukung kelancaran mobilitas, mengoptimalkan kapasitas layanan parkir publik, dan memberikan alat pengambilan keputusan berbasis data bagi pengelola fasilitas komunitas.

### Alasan Pemilihan Proyek
Proyek ini dipilih karena memberikan dampak nyata bagi layanan publik dan memfasilitasi integrasi end-to-end antara Data Science, Artificial Intelligence, dan Full-Stack Web Development dalam satu ekosistem yang kohesif. Cakupan pengembangan yang lengkap—mulai dari data wrangling, EDA, model training, REST API, hingga deployment cloud serverless—menjadikan proyek ini ideal sebagai Capstone Project.

---

## ✅ Tech Stack & Checklist Pencapaian

*Status Penyelesaian Proyek: 100% Selesai berdasarkan Rencana Proyek.*

### Main Quest
- [x] **Front End & Back End:** Implementasi UI/UX, Next.js API Routes, RESTful API (simpan ke database), Integrasi AI/ML.
- [x] **Artificial Intelligence:** Deep Learning Model (TensorFlow Functional API/Subclassing), Custom Layer/Loss/Callback, Export ke format `.keras`/SavedModel, Skrip Inference mandiri.
- [x] **Data Science:** Data Wrangling *end-to-end* (Gathering, Assessing, Cleaning), EDA, Visualisasi Data interaktif, Streamlit Dashboard.

### Side Quest (Nilai Tambah)
- [x] **Front-End & Back-End:** Mockup UI/UX (di presentasi), Layout responsif (Tailwind CSS), Firebase Realtime Database & Firestore, Cloud Deployment (OpenNext ke Cloudflare Workers).
- [x] **Artificial Intelligence:** REST API Serverless (Modal.com), Performa Model BiDir margin error 1,4% (MAE ≤ 0,02, Akurasi ≥ 85%).
- [x] **Data Science:** Feature Engineering (fitur turunan waktu), Streamlit Cloud Deployment, A/B Testing, Laporan Teknis Komprehensif.

---

## 🔗 Tautan Penting

- **Dataset Utama:** [CNRPark+EXT Dataset](https://github.com/fabiocarrara/deep-parking/releases/download/archive/CNRPark+EXT.csv)
- **Live App (Dashboard Admin - Next.js):** [Sistem Manajemen Parkir](https://smart-parking-opennext.anwarrohmadi111.workers.dev/) *(Password login admin: `cc26`)*
- **Dashboard Streamlit (Data Analytics):** [https://smartpark-ai-dashboard.streamlit.app/](https://smartpark-ai-dashboard.streamlit.app/)
- **AI Inference API (Modal.com):** [https://anwarrohmadi111--smartpark-api-web-app.modal.run](https://anwarrohmadi111--smartpark-api-web-app.modal.run)
- **Video Presentasi (Pitching):** [https://youtu.be/thWRA60pTcA](https://youtu.be/thWRA60pTcA)
- **Slide Presentasi:** [https://canva.link/zqap36unfugeg7h](https://canva.link/zqap36unfugeg7h)
- **Penggunaan Produk:** [Buku Panduan CC26-PRU436](https://docs.google.com/document/d/1sxVlpqytsBtSkJ3goKhW6ftn6UJK_2WO2FgJkKQUASc/edit?usp=sharing)
- **Dokumentasi Riset Pemodelan (Google Colab):** [Akses Lingkungan Eksperimen](https://colab.research.google.com/drive/1V2brg3_K2bH1EtTdeJO3vQALBESH9d2G?usp=sharing)
- **Laporan Teknis Komprehensif:** [SmartPark_Technical_Report.md](./SmartPark_Technical_Report.md)
- **Aset Model AI (Google Drive):** [Unduh Model BiDir LSTM](https://drive.google.com/drive/folders/1jz4Wm4rBRS36HVIJ0tD_3kx1_VJT7IfX?usp=sharing)

---

## 📂 Struktur Repository

```text
smart-parking-opennext/
├── app/                	# Halaman utama Next.js (Dashboard Admin & API Proxy)
├── backend/            	# Source code API produksi (smartpark_api.py & modal_api.py)
│   ├── smartpark_api.py	# REST API produksi untuk serverless deployment ke Modal.com
│   ├── modal_api.py    	# Konfigurasi deployment Modal.com
│   ├── feature_cols.pkl	# Kolom fitur hasil preprocessing
│   ├── scaler_X.pkl    	# Scaler input fitur
│   └── scaler_y.pkl    	# Scaler output target
├── components/         	# Komponen React/Next.js
├── context/            	# State management (React Context)
├── hooks/              	# Custom React hooks
├── lib/                	# Koneksi Firebase & utilities
├── research/           	# Jupyter Notebooks, evaluasi model, eksperimen arsitektur AI
├── tests/             	 	# Skrip verifikasi akurasi model AI
├── .env.example        	# Template environment variables
├── database.rules.json 	# Firebase Realtime Database rules
├── firestore.rules     	# Firestore security rules
├── notebook.ipynb      	# Berkas eksperimen utama (Jupyter Notebook) yang memuat rekam jejak riset pemodelan AI
├── SmartPark_Technical_Report.md # Laporan teknis komprehensif proyek
├── open-next.config.ts 	# Konfigurasi OpenNext (Cloudflare deployment)
├── wrangler.toml       	# Konfigurasi Cloudflare Workers
└── README.md           	# Dokumentasi proyek 
```

---

## 🚀 Panduan Memulai (Getting Started)

### Prasyarat
- Node.js (v18+)
- Python (v3.9+)

### Instalasi & Menjalankan Development Server (Frontend)
1. Clone repository:
   ```bash
   git clone https://github.com/anwarrohmadi2006/smart-parking-opennext.git
   cd smart-parking-opennext
   ```
2. Instal dependensi:
   ```bash
   npm install
   ```
3. Konfigurasi Environment:
   Salin file `.env.example` menjadi `.env.local` dan isi konfigurasi untuk menghubungkan ke Firebase dan endpoint AI Anda.
4. Jalankan server:
   ```bash
   npm run dev
   ```

### Deployment AI API (Modal.com)
```bash
cd backend
modal deploy modal_api.py
```

---

## 📊 Hasil Pengembangan & Perbandingan

### Keunggulan Diferensiatif
SmartPark AI menggunakan arsitektur **Bidirectional LSTM (BiDir)** yang mampu mempelajari tren pergerakan kendaraan dari dua arah waktu (masa lalu dan masa depan simulasi). Hasilnya, model ini mencapai **margin error hanya 1,4%**—jauh melampaui sistem CCTV konvensional dalam hal akurasi dan ketahanan terhadap gangguan visual (*shadow/occlusion*).

### Perbandingan Fitur
| Fitur | SmartPark AI | Sistem Konvensional | Sensor per Slot | Kamera Biasa |
|-------|--------------|---------------------|-----------------|--------------|
| Status Parkir Real-Time | ✅ | ❌ | ✅ | Terbatas |
| Prediksi 30 Menit ke Depan | ✅ | ❌ | ❌ | ❌ |
| Dashboard Analitik & KPI | ✅ | ❌ | ❌ | ❌ |
| AI Recommendation Engine | ✅ | ❌ | ❌ | ❌ |
| Tahan Gangguan Visual | ✅ | N/A | N/A | ❌ |
| Hemat Biaya & Serverless | ✅ | Sebagian | ❌ | Sebagian |

### Dokumentasi Eksperimen dan Riset Pemodelan
Proses rekayasa fitur (*feature engineering*), komparasi arsitektur jaringan saraf tiruan (termasuk *Hybrid Self-Attention*, *Bidirectional LSTM*, dan *Weighted Ensemble*), serta tahapan pengujian model secara menyeluruh didokumentasikan di dalam berkas eksperimen *Jupyter Notebook* (`notebook.ipynb`). Guna memfasilitasi peninjauan dan replikasi pengujian oleh evaluator atau pihak eksternal, seluruh ekosistem riset tersebut telah dipublikasikan secara terpusat pada platform [Google Colab](https://colab.research.google.com/drive/1V2brg3_K2bH1EtTdeJO3vQALBESH9d2G?usp=sharing). Pendekatan ini merupakan wujud komitmen tim terhadap transparansi metodologi analitik serta jaminan reprodusibilitas (*reproducibility*) dari metrik performa model yang diajukan.

---

## 🔮 Rencana Implementasi & Evaluasi

### Rencana ke Depan (Roadmap)
- **Jangka Pendek:** Simulasi prediksi real-time dan uji ketahanan pada berbagai kondisi cuaca ekstrem (cerah, mendung, hujan) menggunakan subset dataset CNRPark+EXT.
- **Jangka Menengah:** Integrasi CCTV *live stream* dan pengembangan aplikasi mobile untuk pengendara agar dapat melihat rekomendasi area parkir sebelum tiba di lokasi.
- **Jangka Panjang:** Implementasi *Dynamic Pricing* berbasis prediksi AI untuk otomatisasi tarif pada jam sibuk, dan ekspansi integrasi ratusan kamera skala *enterprise*.

### Analisis SWOT
- **Strengths:** Margin error rendah (1,4%), arsitektur serverless efisien, real-time dashboard dengan Firebase, pipeline data sains komprehensif, ekosistem teknologi modern.
- **Weaknesses:** Masih bergantung pada dataset historis statis, belum integrasi IoT fisik secara utuh, dan ketergantungan pada platform pihak ketiga (Modal/Firebase).
- **Opportunities:** Ekspansi ke skala kota/gedung lain, implementasi *dynamic pricing*, pengembangan aplikasi *mobile* pengguna akhir.
- **Threats:** Cuaca ekstrem pada penerapan *live-data* mungkin berdampak, kompetisi dari solusi vendor komersial, perubahan kebijakan platform pihak ketiga.

### Perubahan dari Rencana Awal (Project Plan)
1. **Arsitektur Backend:** Beralih dari Flask server konvensional ke Modal.com (Python Serverless API) + Next.js API Routes demi skalabilitas, efisiensi biaya, dan *best practice* industri modern.
2. **Fokus MVP Berbasis Software:** Mengubah fokus awal dari mengimplementasikan IoT Hardware fisik (ESP32, Sensor, RFID) menjadi pengembangan perangkat lunak murni (*software-only* MVP) yang robust dan mudah didemonstrasikan.
3. **Peningkatan Tech Stack Frontend:** Rencana awal HTML/CSS/JS diganti menjadi Next.js (TypeScript) + Tailwind CSS dan deployment menggunakan OpenNext ke Cloudflare Workers.
4. **Eksplorasi Ekstensif AI:** Penambahan eksplorasi tiga arsitektur Deep Learning (Stacked GRU-LSTM, CLSTAN, dan Bidirectional LSTM) untuk mencari margin error terbaik (berhasil mencapai target 1,4% pada BiDir).

Seluruh perubahan ini meningkatkan kualitas akhir produk agar dapat berfungsi maksimal sebagai sistem analitik data dan prediksi.
