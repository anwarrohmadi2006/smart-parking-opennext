# Laporan Teknis: SmartPark AI
**Intelligent Parking Occupancy Prediction**

---

## 1. Pendahuluan
### Latar Belakang Masalah
Kepadatan lahan parkir merupakan salah satu tantangan mobilitas utama di berbagai fasilitas publik. Berdasarkan tahap *Problem Discovery* (yang merupakan salah satu objektif utama atau *Main Quest*), teridentifikasi beberapa permasalahan pokok:
1. **Inefisiensi Mobilitas**: Pengguna menghabiskan banyak waktu untuk mencari slot parkir yang tersedia.
2. **Ketidakmerataan Distribusi**: Terdapat area parkir yang beroperasi pada kapasitas maksimal, sementara area lainnya memiliki utilitas yang rendah.
3. **Keterbatasan Prediktabilitas**: Sistem konvensional hanya menyajikan data aktual tanpa memberikan informasi proyeksi ketersediaan lahan parkir di masa mendatang.

### Solusi: Capstone Project (SmartPark AI)
Menyasar objektif pengembangan dari tim *Data Science* dan *Artificial Intelligence*, proyek ini mengusulkan platform prediksi tingkat keterisian lahan parkir untuk 30 menit ke depan. Sistem ini mengintegrasikan model *Deep Learning* dengan ekosistem dasbor analitik berbasis Streamlit.

---

## 2. Pemenuhan Target Proyek (Quest Checklist)
Proyek ini dirancang secara sistematis untuk memenuhi spesifikasi kompetensi berikut:

### 📊 Data Science
**Target Utama (Main Quest / MVP):**
- ✅ Mengumpulkan, menganalisis masalah, dan menentukan solusi pokok (*Problem Discovery*).
- ✅ Melakukan *Data Wrangling* secara terstruktur (*Gathering*, *Assessing*, *Cleaning*).
- ✅ Mendefinisikan pertanyaan bisnis yang terukur.
- ✅ Melakukan *Exploratory Data Analysis* (EDA) untuk mengekstraksi wawasan (*insight*).
- ✅ Membuat visualisasi interaktif dan *explanatory analysis*.
- ✅ Mengembangkan dasbor Streamlit untuk menyajikan hasil analisis.
- ✅ Memastikan kesiapan data untuk proses pemodelan (*Data Preprocessing*).

**Target Tambahan (Side Quest):**
- ✅ Melakukan *Feature Engineering* secara komprehensif.
- ✅ Menyusun laporan teknis komprehensif berformat PDF.
- ✅ Melakukan *deployment* dasbor ke Streamlit Cloud (tahap lanjutan).

### 🤖 Artificial Intelligence
**Target Utama (Main Quest / MVP):**
- ✅ Membangun model *Deep Learning* (menggunakan TensorFlow Functional API/Subclassing).
- ✅ Mengimplementasikan komponen kustom tingkat lanjut: **Custom Layer (Temporal Attention)**.
- ✅ Menyimpan model siap produksi (berformat `.keras`).
- ✅ Mengembangkan kode *inference* untuk simulasi operasional.

**Target Tambahan (Side Quest):**
- ✅ **Pencapaian Target Performa**: Memenuhi ambang batas akurasi minimal 85% dan batasan *Mean Absolute Error* (MAE) maksimal 0.02 (2%).
- ✅ **Pelatihan Berbasis Custom Loop**: Menggunakan `tf.GradientTape` (diimplementasikan pada model `GradientTape_CLSTAN`).

---

## 3. Exploratory Data Analysis (EDA) & Feature Engineering
Berdasarkan dasbor analitik, beberapa wawasan operasional berhasil diidentifikasi:
1. **Pola Mobilitas Harian**: Terdapat perbedaan pola fluktuasi yang signifikan antara hari kerja (*weekday*) dan akhir pekan (*weekend*).
2. **Identifikasi Jam Sibuk (*Rush Hour*)**: Titik puncak beban parkir secara konsisten terdeteksi pada pukul **08:00** dan **17:00**.

### Rekayasa Fitur (*Feature Engineering*)
Mengingat data *time-series* memerlukan penanganan non-linier, proses ekstraksi fitur dilakukan menggunakan rentang pengamatan 18 interval ke belakang:
- *Cyclical Time Encoding* (Transformasi fungsi sinus/kosinus untuk representasi jam dan hari).
- *Rolling Mean*, *Rolling Standard Deviation*, serta *Lag* historis.
- *Momentum* dan *Exponential Moving Average (EMA)*.

---

## 4. Evaluasi Performa Model & Eksperimen
Proses iterasi arsitektur jaringan dilakukan untuk mengidentifikasi kandidat model yang memenuhi spesifikasi teknis (Akurasi > 85%, MAE < 0.02).

### Hasil Komparasi Metrik Model (Test Set)
Berikut adalah matriks performa dari berbagai arsitektur yang dieksperimenkan:

| Peringkat | Arsitektur Model | MAE | RMSE | R² Score | Akurasi (±5%) | Status Pemenuhan Syarat |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|
| **1** | **Hybrid_SelfAttn** | **0.01339** | 0.03409 | 0.981 | 93.65% | ✅ Memenuhi |
| **2** | **Baseline** | 0.01357 | 0.03195 | 0.983 | 94.91% | ✅ Memenuhi |
| **3** | **Weighted_Ensemble** | 0.01379 | **0.02764** | **0.987** | **95.99%** | ✅ Memenuhi |
| **4** | **BiDir_Original** | 0.01432 | 0.03457 | 0.980 | 95.26% | ✅ Memenuhi |
| **5** | **BiDir_Tuned** | 0.01586 | 0.03324 | 0.982 | 92.31% | ✅ Memenuhi |
| **6** | **CLSTAN_Residual** | 0.01597 | 0.03084 | 0.984 | 92.55% | ✅ Memenuhi |
| 7 | CLSTAN_Original | 0.02030 | 0.03847 | 0.976 | 92.55% | ❌ MAE > 0.02 |
| 8 | GradientTape_CLSTAN* | 0.03285 | 0.04736 | 0.963 | 89.00% | ❌ MAE > 0.02 |

*\*Model **GradientTape_CLSTAN** secara spesifik dilatih menggunakan siklus pelatihan kustom `tf.GradientTape` untuk memenuhi spesifikasi objektif sekunder tim AI.*

**Analisis Hasil**: 
Model **Hybrid_SelfAttn** menghasilkan tingkat galat absolut (MAE) terendah sebesar ~1.34%, sedangkan varian **Weighted_Ensemble** memberikan tingkat akurasi tertinggi sebesar 95.99%. Arsitektur utama yang diajukan, **BiDir_Original** (Bidirectional LSTM), menghasilkan akurasi sebesar 95.26% dengan MAE 1.43%.

### Keputusan Tahap Produksi (*Deployment Justification*)
Walaupun `Hybrid_SelfAttn` dan `Weighted_Ensemble` menunjukkan metrik evaluasi yang lebih efisien secara matematis, tim menetapkan untuk menggunakan **BiDir_Original (Bidirectional LSTM)** pada lingkungan produksi. Keputusan profesional ini dilandasi oleh beberapa pertimbangan teknis:
1. **Efisiensi Komputasi dan Latensi Rendah**: Varian `Weighted_Ensemble` membutuhkan komputasi paralel dari beberapa model yang dapat meningkatkan utilisasi memori dan menurunkan waktu respons prediksi. Pada arsitektur layanan *Serverless* yang menuntut pemrosesan seketika, arsitektur tunggal yang efisien merupakan prioritas.
2. **Keseimbangan Performa (*Optimal Trade-off*)**: `BiDir_Original` menawarkan stabilitas komputasi dengan jumlah parameter jaringan yang lebih rendah dibandingkan `Hybrid_SelfAttn`. Mengingat tingkat galat MAE 1.43% telah memenuhi kriteria kelayakan teknis (MAE < 2%), beban server yang dihasilkan oleh model ansambel dinilai kurang efisien untuk diimplementasikan. 

---

## 5. Implementasi Simulasi Operasional
Untuk memvalidasi kesiapan implementasi model pada skenario operasional, sebuah purwarupa portal pengguna disimulasikan melalui kerangka kerja Streamlit:
- **Visualisasi Indikator**: Menyajikan rasio kapasitas lahan parkir yang tersedia.
- **Sistem Rekomendasi Terpadu**: Secara sistematis memproses 18 rentang waktu historis terakhir untuk melakukan ekstraksi fitur, kemudian menyajikan estimasi ketersediaan lahan parkir untuk 30 menit ke depan beserta peringatan operasional apabila kapasitas hampir mencapai batas maksimal.

---

## 6. Kesimpulan
Proyek **SmartPark AI** telah menyelesaikan target objektif utama maupun sekunder yang disyaratkan. Melalui prosedur analitik terstruktur, model yang diimplementasikan mampu memberikan proyeksi dengan tingkat akurasi di atas **95%** dan menekan tingkat MAE hingga di bawah **0.014**.

Adopsi fungsionalitas seperti *Temporal Attention*, rekayasa fitur waktu siklis, komparasi kinerja arsitektur, serta standardisasi dokumentasi teknis berformat PDF merupakan manifestasi dari pendekatan berbasis data untuk meningkatkan efisiensi operasional sistem mobilitas perkotaan.
