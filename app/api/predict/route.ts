import { NextRequest, NextResponse } from "next/server";
import { collection, query, orderBy, limit, getDocs, where } from "firebase/firestore/lite";
import { db } from "@/lib/firebase-lite";

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// URL FastAPI server (lokal default atau dideploy di Modal.com)
const FASTAPI_URL = process.env.FASTAPI_URL || "https://anwarrohmadi111--smartpark-api-web-app.modal.run/predict";

// In-memory cache variables to throttle requests and save reads/computations
let lastFetchTime = 0;
let cachedResponse: any = null;
let cachedPayloadHash: string = "";

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
    const { searchParams } = new URL(request.url);
    const currentOccParam = searchParams.get("current_occ");
    const weatherParam = searchParams.get("weather");
    const hourParam = searchParams.get("hour");

    const queryCurrentOcc = currentOccParam !== null ? parseFloat(currentOccParam) : null;
    const queryWeather = weatherParam ? weatherParam.toUpperCase() : null;
    const queryHour = hourParam !== null ? parseInt(hourParam) : null;
    const dayOfWeekParam = searchParams.get("day_of_week");
    const queryDayOfWeek = dayOfWeekParam !== null ? parseInt(dayOfWeekParam) : null;
    const historyParam = searchParams.get("history");

    let observations: any[] = [];

    if (historyParam) {
      // Parse history from query parameter for simulation to bypass Firestore read conflicts
      const rates = historyParam.split(",").map((r) => parseFloat(r));
      const baseTime = Date.now();
      observations = rates.map((rate, idx) => {
        const offsetMins = (rates.length - 1 - idx) * 10;
        const mockTime = baseTime - offsetMins * 60 * 1000;
        const date = new Date(mockTime);
        
        return {
          timestamp: mockTime,
          occupancy_rate: rate,
          hour: date.getHours(),
          day_of_week: date.getDay(),
          is_weekend: date.getDay() === 0 || date.getDay() === 6 ? 1 : 0,
          weather: queryWeather || "SUNNY",
        };
      });
    } else {
      // 1. Ambil data historis dari Firestore collection "occupancy_history" (cegah data leak dari record masa depan simulasi)
      const historyRef = collection(db, "occupancy_history");
      const q = query(
        historyRef, 
        where("timestamp", "<=", now),
        orderBy("timestamp", "desc"), 
        limit(66)
      );
      const querySnapshot = await getDocs(q);

      querySnapshot.forEach((doc) => {
        observations.push(doc.data());
      });

      // Karena di-query descending (terbaru dahulu), kita reverse agar urut kronologis
      observations.reverse();
    }

    // 2. Fallback / Backfill jika data historis belum mencukupi 66 baris
    if (observations.length < 66) {
      console.log(`[Proxy Predict] Data historis hanya ada ${observations.length}, melakukan backfill...`);
      
      // Ambil occupancy saat ini dari activeVehicles atau parameter query untuk baseline
      let currentOccupancyRate = 0.0;
      if (queryCurrentOcc !== null) {
        currentOccupancyRate = queryCurrentOcc;
      } else {
        try {
          const activeVehiclesSnap = await getDocs(collection(db, "activeVehicles"));
          currentOccupancyRate = Math.min(1.0, activeVehiclesSnap.size / 164.0);
        } catch (err) {
          console.error("Gagal mengambil activeVehicles:", err);
        }
      }

      // Lengkapi sisa observations ke 66 baris (mundur ke belakang per 10 menit)
      const needed = 66 - observations.length;
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
          weather: queryWeather || "SUNNY",
        });
      }
      
      observations = [...backfilled, ...observations];
    }

    // Selalu sesuaikan data observasi agar data point terbaru tepat sama dengan data real-time saat ini
    if (queryCurrentOcc !== null && observations.length > 0) {
      const latestObsRate = observations[observations.length - 1].occupancy_rate;
      const diff = queryCurrentOcc - latestObsRate;

      observations = observations.map((obs, idx) => {
        let newRate = obs.occupancy_rate + diff;
        newRate = Math.max(0.0, Math.min(1.0, newRate));

        if (idx === observations.length - 1) {
          newRate = queryCurrentOcc;
        }

        let newWeather = obs.weather;
        if (queryWeather) {
          newWeather = queryWeather;
        }

        let newHour = obs.hour;
        let newDayOfWeek = obs.day_of_week;
        let newIsWeekend = obs.is_weekend;

        if (queryHour !== null) {
          const offsetMins = (observations.length - 1 - idx) * 10;
          const offsetHours = Math.floor(offsetMins / 60);
          const adjustedHour = (queryHour - offsetHours + 24) % 24;
          newHour = adjustedHour;

          if (queryDayOfWeek !== null) {
            const daysToShift = Math.floor((queryHour - offsetHours) / 24);
            let adjustedDay = (queryDayOfWeek + daysToShift) % 7;
            if (adjustedDay < 0) adjustedDay += 7;
            newDayOfWeek = adjustedDay;
            newIsWeekend = (adjustedDay === 0 || adjustedDay === 6) ? 1 : 0;
          }
        }

        return {
          ...obs,
          occupancy_rate: newRate,
          weather: newWeather,
          hour: newHour,
          day_of_week: newDayOfWeek,
          is_weekend: newIsWeekend,
        };
      });
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
      use_ensemble: false, // Default to BiDir best single model
    };

    // Check in-memory cache to prevent excessive API calls and database reads
    const payloadHash = JSON.stringify(payload.observations);
    const timeLimit = 2000; // 2 seconds minimum throttle
    if (cachedResponse && cachedPayloadHash === payloadHash && now - lastFetchTime < timeLimit) {
      return NextResponse.json(cachedResponse, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" }
      });
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
      
      // Override narasi dari Modal dengan Cloudflare LLaMA-3 (Hemat & Cepat)
      try {
        const { getCloudflareContext } = await import("@opennextjs/cloudflare");
        const { env } = getCloudflareContext() as { env: any };
        
        if (env && env.AI) {
          const prompt = `Anda adalah asisten cerdas pengelola parkir. Saat ini tingkat okupansi diprediksi ${data.predicted_pct}. Status: ${data.recommendation?.urgency || 'NORMAL'}. Tindakan: ${(data.recommendation?.actions || []).join(", ")}. Berikan satu atau maksimal dua kalimat notifikasi arahan yang sangat praktis dan jelas untuk petugas parkir di lapangan dalam bahasa Indonesia yang tegas.`;
          
          const cfResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [{ role: "user", content: prompt }]
          });
          
          if (cfResponse && cfResponse.response) {
            // Tulis ulang ai_narrative yang tadinya dari Modal
            data.ai_narrative = `[✨ Cloudflare Edge AI] ${cfResponse.response.trim()}`;
          }
        }
      } catch (cfNativeErr) {
        console.error("Cloudflare Native AI Override Error:", cfNativeErr);
      }

      // Update cache
      cachedResponse = data;
      cachedPayloadHash = payloadHash;
      lastFetchTime = now;

      return NextResponse.json(data, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" }
      });
    } catch (apiError: any) {
      console.warn("⚠️ Gagal koneksi ke FastAPI server, fallback ke Cloudflare Workers AI...");
      
      // Rule-based fallback metrics
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

      let ai_narrative = `[Lokal Fallback] Tingkat hunian parkir saat ini terpantau ${pct}%. ${summary} Silakan lakukan penyesuaian operasional lapangan jika diperlukan.`;

      // Menggunakan Cloudflare Workers AI Native Binding
      try {
        const { getCloudflareContext } = await import("@opennextjs/cloudflare");
        const { env } = getCloudflareContext() as { env: any };
        
        if (env && env.AI) {
          const prompt = `Anda adalah asisten cerdas pengelola parkir. Saat ini parkir terisi ${pct}%. Status: ${urgency}. Tindakan: ${actions.join(", ")}. Berikan pesan notifikasi singkat (2 kalimat) untuk petugas parkir dalam bahasa Indonesia.`;
          
          const cfResponse = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
            messages: [{ role: "user", content: prompt }]
          });
          
          if (cfResponse && cfResponse.response) {
            ai_narrative = `[Cloudflare Native Fallback] ${cfResponse.response.trim()}`;
          }
        } else {
          console.warn("Cloudflare env.AI binding not found in current context (e.g., local dev without wrangler).");
        }
      } catch (cfNativeErr) {
        console.error("Cloudflare Native AI Error:", cfNativeErr);
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
          status_flag: "Menggunakan fallback Cloudflare AI / Lokal",
          human_summary: summary,
        },
        ai_narrative,
        source: "Cloudflare Fallback AI (Modal Offline)"
      };

      // Update cache
      cachedResponse = fallbackData;
      cachedPayloadHash = payloadHash;
      lastFetchTime = now;

      return NextResponse.json(fallbackData, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" }
      });
    }
  } catch (error: any) {
    console.error("Error in AI predict API route:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 }
    );
  }
}
