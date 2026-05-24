const fs = require('fs');
const path = require('path');

// URL FastAPI server di Modal.com
const FASTAPI_URL = "https://anwarrohmadi111--smartpark-api-web-app.modal.run/predict";

// Lokasi berkas dataset replay
const REPLAY_DATA_PATH = path.join(__dirname, '..', 'public', 'data', 'replay_data.json');

async function runDeviationCheck() {
  console.log('================================================================');
  console.log('🧪 VERIFIKASI AKURASI MANDIRI: EVALUASI DEVIASI AKTUAL VS PREDIKSI');
  console.log('================================================================');
  
  if (!fs.existsSync(REPLAY_DATA_PATH)) {
    console.error(`❌ Gagal: File dataset replay tidak ditemukan di ${REPLAY_DATA_PATH}`);
    process.exit(1);
  }

  const replayData = JSON.parse(fs.readFileSync(REPLAY_DATA_PATH, 'utf-8'));
  console.log(`📊 Dataset replay berhasil dimuat. Total data point: ${replayData.length}`);
  
  // Kita uji sebanyak 50 frame berturut-turut
  // Kita mulai dari indeks 0 (awal hari) untuk melihat transisi dinamis penuh
  const START_INDEX = 0;
  const NUM_FRAMES = 50;
  
  console.log(`🤖 Mengevaluasi ${NUM_FRAMES} frame simulasi berturut-turut (Indeks ${START_INDEX} s/d ${START_INDEX + NUM_FRAMES - 1})...`);
  console.log(`🛰️  Memanggil Cloud ML Serverless di Modal.com secara real-time...\n`);
  
  let absoluteErrors = [];
  let actuals = [];
  let predictions = [];
  let count = 0;

  console.log(`| Frame | Jam Virtual | Aktual (+30m) | Prediksi (+30m) | Simpangan (Abs Error) | Status |`);
  console.log(`|-------|-------------|---------------|-----------------|-----------------------|--------|`);

  for (let i = 0; i < NUM_FRAMES; i++) {
    const currentIndex = START_INDEX + i;
    const currentRecord = replayData[currentIndex];
    
    // Ambil data aktual 30 menit ke depan (+3 indeks ke depan)
    const targetIndex = currentIndex + 3;
    if (targetIndex >= replayData.length) break;
    
    const targetRecord = replayData[targetIndex];
    const actualFutureOcc = targetRecord.global_occupancy; // Nilai desimal (0.0 s.d 1.0)
    
    // Bangun 18 sequence observasi historis ke belakang
    const observations = [];
    for (let j = 17; j >= 0; j--) {
      const historyIndex = currentIndex - j;
      const historyRecord = replayData[historyIndex] || currentRecord;
      
      const date = new Date(historyRecord.timestamp.replace(/-/g, "/"));
      
      observations.push({
        occupancy_rate: Number(historyRecord.global_occupancy),
        hour: date.getHours(),
        day_of_week: date.getDay(),
        is_weekend: date.getDay() === 0 || date.getDay() === 6 ? 1 : 0,
        weather: String(historyRecord.weather || "SUNNY").toUpperCase(),
      });
    }

    // Siapkan payload ke FastAPI
    const payload = {
      observations: observations,
      internet_ok: true,
      use_ensemble: false,
    };

    try {
      const response = await fetch(FASTAPI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`FastAPI returned status ${response.status}`);
      }

      const data = await response.json();
      const predictedFutureOcc = data.predicted_occupancy_30min; // desimal dari model

      const absError = Math.abs(actualFutureOcc - predictedFutureOcc);
      absoluteErrors.push(absError);
      actuals.push(actualFutureOcc);
      predictions.push(predictedFutureOcc);
      count++;

      const actualPct = (actualFutureOcc * 100).toFixed(2) + '%';
      const predPct = (predictedFutureOcc * 100).toFixed(2) + '%';
      const errorPct = (absError * 100).toFixed(2) + '%';
      const status = absError <= 0.05 ? '🟢 SANGAT BAIK' : (absError <= 0.10 ? '🟡 BAIK' : '🔴 PENYIMPANGAN');

      console.log(`| #${(i+1).toString().padStart(2, '0')}  | ${currentRecord.timestamp} | ${actualPct.padStart(13)} | ${predPct.padStart(15)} | ${errorPct.padStart(21)} | ${status} |`);
      
      // Delay sedikit agar tidak memicu rate limiting ekstrem pada cloud server
      await new Promise(r => setTimeout(r, 150));
    } catch (err) {
      console.log(`| #${(i+1).toString().padStart(2, '0')}  | ${currentRecord.timestamp} | ERROR: Gagal mengambil prediksi |`);
    }
  }

  if (absoluteErrors.length === 0) {
    console.error("\n❌ Gagal mengevaluasi data, tidak ada respon sukses dari cloud server.");
    process.exit(1);
  }

  // Hitung Metrik Statistik Akhir
  const sumError = absoluteErrors.reduce((a, b) => a + b, 0);
  const mae = sumError / absoluteErrors.length;
  const maxError = Math.max(...absoluteErrors);
  
  // Hitung Akurasi (Simpangan <= 5% kapasitas parkir)
  const accuratePredictions = absoluteErrors.filter(err => err <= 0.05).length;
  const accuracyPct = (accuratePredictions / absoluteErrors.length) * 100;

  // Hitung Mean Squared Error (MSE) & R-Squared (R²)
  const meanActual = actuals.reduce((a, b) => a + b, 0) / actuals.length;
  let totalSumSquares = 0;
  let residualSumSquares = 0;
  for (let idx = 0; idx < actuals.length; idx++) {
    totalSumSquares += Math.pow(actuals[idx] - meanActual, 2);
    residualSumSquares += Math.pow(actuals[idx] - predictions[idx], 2);
  }
  const r2Score = 1 - (residualSumSquares / totalSumSquares);

  console.log('\n================================================================');
  console.log('📊 LAPORAN KINERJA MODEL DEEP LEARNING SMARTPARK AI (CLSTAN)');
  console.log('================================================================');
  console.log(`📈 Total Frame Dievaluasi : ${count} virtual frames (500 virtual minutes)`);
  console.log(`🎯 Mean Absolute Error (MAE): ${(mae * 100).toFixed(4)}% kapasitas parkir`);
  console.log(`🔥 Maximum Absolute Error   : ${(maxError * 100).toFixed(4)}% kapasitas parkir`);
  console.log(`🎯 Akurasi Prediksi (Simpangan <= 5%): ${accuracyPct.toFixed(2)}%`);
  console.log(`📉 R-Squared (R²) Score     : ${r2Score.toFixed(5)} (Korelasi Aktual vs Prediksi)`);
  console.log('================================================================');
  
  if (mae <= 0.03) {
    console.log('🏆 KESIMPULAN: Model LSTM + Attention Anda SANGAT AKURAT!');
    console.log('   Rata-rata simpangan meleset hanya di bawah 3% kapasitas.');
  } else if (mae <= 0.05) {
    console.log('✅ KESIMPULAN: Model Anda sangat layak digunakan untuk industri.');
    console.log('   Simpangan rata-rata di bawah 5% batas toleransi akademik.');
  } else {
    console.log('⚠️ KESIMPULAN: Model menunjukkan simpangan yang melebihi 5%.');
  }
  console.log('================================================================\n');
}

runDeviationCheck();
