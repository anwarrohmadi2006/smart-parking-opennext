import { NextRequest, NextResponse } from "next/server";
import { collection, query, orderBy, limit, getDocs } from "firebase/firestore/lite";
import { db } from "@/lib/firebase-lite";

// URL FastAPI server (lokal default atau dideploy di Modal.com)
const FASTAPI_URL = process.env.FASTAPI_URL || "https://anwarrohmadi111--smartpark-api-web-app.modal.run/predict";

// In-memory cache variables to throttle requests and save reads/computations
let lastFetchTime = 0;
let cachedResponse: any = null;
let cachedPayloadHash: string = "";

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();

    // 1. Ambil data historis dari Firestore collection "occupancy_history"
    const historyRef = collection(db, "occupancy_history");
    const q = query(historyRef, orderBy("timestamp", "desc"), limit(18));
    const querySnapshot = await getDocs(q);

    let observations: any[] = [];
    querySnapshot.forEach((doc) => {
      observations.push(doc.data());
    });

    // Karena di-query descending (terbaru dahulu), kita reverse agar urut kronologis
    observations.reverse();

    // 2. Fallback / Backfill jika data historis belum mencukupi 18 baris
    if (observations.length < 18) {
      console.log(`[Proxy Predict] Data historis hanya ada ${observations.length}, melakukan backfill...`);
      
      // Ambil occupancy saat ini dari activeVehicles untuk baseline
      let currentOccupancyRate = 0.0;
      try {
        const activeVehiclesSnap = await getDocs(collection(db, "activeVehicles"));
        currentOccupancyRate = Math.min(1.0, activeVehiclesSnap.size / 24.0);
      } catch (err) {
        console.error("Gagal mengambil activeVehicles:", err);
      }

      // Lengkapi sisa observations ke 18 baris (mundur ke belakang per 10 menit)
      const needed = 18 - observations.length;
      const baseTime = observations.length > 0 ? observations[0].timestamp : Date.now();
      const backfilled: any[] = [];

      for (let i = needed; i > 0; i--) {
        const mockTime = baseTime - i * 10 * 60 * 1000; // 10 menit lalu
        const date = new Date(mockTime);
        
        // Simulasikan fluktuasi kecil di sekitar occupancy rate saat ini
        const noise = (Math.random() - 0.5) * 0.08;
        const mockRate = Math.max(0.0, Math.min(1.0, currentOccupancyRate + noise));

        backfilled.push({
          timestamp: mockTime,
          occupancy_rate: mockRate,
          hour: date.getHours(),
          day_of_week: date.getDay(),
          is_weekend: date.getDay() === 0 || date.getDay() === 6 ? 1 : 0,
          weather: "SUNNY",
        });
      }
      
      observations = [...backfilled, ...observations];
    }

    // 3. Format observations sesuai skema input model
    const payload = {
      observations: observations.map((obs) => ({
        occupancy_rate: Number(obs.occupancy_rate),
        hour: Number(obs.hour),
        day_of_week: Number(obs.day_of_week),
        is_weekend: Number(obs.is_weekend),
        weather: String(obs.weather || "SUNNY").toUpperCase(),
      })),
      internet_ok: true,
      use_ensemble: false, // Default to CLSTAN best single model
    };

    // Check in-memory cache to prevent excessive API calls and database reads
    const payloadHash = JSON.stringify(payload.observations);
    const timeLimit = 2000; // 2 seconds minimum throttle
    if (cachedResponse && (cachedPayloadHash === payloadHash || now - lastFetchTime < timeLimit)) {
      return NextResponse.json(cachedResponse);
    }

    // 4. Kirim ke FastAPI ML Server
    try {
      const response = await fetch(FASTAPI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`FastAPI returned status ${response.status}`);
      }

      const data = await response.json();
      data.source = "Modal.com Cloud ML";

      const current_occ = data.current_occupancy;
      const pred_30 = data.predicted_occupancy_30min;

      const pred_10 = current_occ + (pred_30 - current_occ) * (1 / 3);
      const pred_20 = current_occ + (pred_30 - current_occ) * (2 / 3);

      data.predicted_occupancy_10min = Number(pred_10.toFixed(4));
      data.predicted_occupancy_20min = Number(pred_20.toFixed(4));
      data.predicted_pct_10min = `${(pred_10 * 100).toFixed(1)}%`;
      data.predicted_pct_20min = `${(pred_20 * 100).toFixed(1)}%`;
      
      // Update cache
      cachedResponse = data;
      cachedPayloadHash = payloadHash;
      lastFetchTime = now;

      return NextResponse.json(data);
    } catch (apiError: any) {
      console.warn("⚠️ Gagal koneksi ke FastAPI server, menggunakan rule-based fallback...");
      
      // Rule-based fallback untuk menjaga stabilitas UI jika FastAPI mati
      const currentRate = observations[observations.length - 1].occupancy_rate;
      const pct = Math.round(currentRate * 100);
      let urgency = "NORMAL";
      let actions = ["Tidak ada tindakan khusus diperlukan"];
      let summary = `Kondisi normal (${pct}%).`;

      if (currentRate >= 0.95) {
        urgency = "KRITIS";
        actions = ["Tutup gate masuk segera", "Aktifkan petugas arahkan ke Parkir B"];
        summary = `★ Parkir HAMPIR PENUH (${pct}%).`;
      } else if (currentRate >= 0.85) {
        urgency = "TINGGI";
        actions = ["Siapkan petugas tambahan di pintu masuk", "Pertimbangkan kenaikan tarif 20%"];
        summary = `☆ Parkir mendekati penuh (${pct}%).`;
      }

      const fallbackData = {
        prediction_id: `fallback_${Date.now()}`,
        timestamp: new Date().toISOString(),
        current_occupancy: currentRate,
        predicted_occupancy_30min: currentRate,
        predicted_pct: `${pct}%`,
        predicted_occupancy_10min: currentRate,
        predicted_occupancy_20min: currentRate,
        predicted_pct_10min: `${pct}%`,
        predicted_pct_20min: `${pct}%`,
        confidence: { confidence_pct: 80, confidence_level: "SEDANG" },
        recommendation: {
          urgency,
          actions,
          status_flag: "Menggunakan fallback lokal (FastAPI Offline)",
          human_summary: summary,
        },
        ai_narrative: `[Lokal Fallback] Tingkat hunian parkir saat ini terpantau ${pct}%. ${summary} Silakan lakukan penyesuaian operasional lapangan jika diperlukan.`,
        source: "Local Rule-based Fallback (Modal Offline)"
      };

      // Update cache
      cachedResponse = fallbackData;
      cachedPayloadHash = payloadHash;
      lastFetchTime = now;

      return NextResponse.json(fallbackData);
    }
  } catch (error: any) {
    console.error("Error in AI predict API route:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
