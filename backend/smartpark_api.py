"""
SmartPark AI — FastAPI REST API (Standalone & Refactored)
Endpoints:
  GET  /health          — Health check
  POST /predict         — Predict occupancy (accepts last N observations)
  GET  /dashboard       — Latest full recommendation (admin card)
  GET  /metrics         — Model performance metrics
  POST /feedback        — Log admin feedback on recommendation
"""

import os
import json
import pickle
import datetime
import re
import random
import numpy as np
import pandas as pd
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import groq

# Setup current working directory path for loading files
BASE_DIR = Path(__file__).resolve().parent

# ─ Setup Generative AI (Groq) ───────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
if GROQ_API_KEY:
    groq_client = groq.Groq(api_key=GROQ_API_KEY)
else:
    groq_client = None

# ── Load artifacts ─────────────────────────────────────────────────────────
try:
    with open(BASE_DIR / 'scaler_X.pkl', 'rb') as f:
        scaler_X = pickle.load(f)
    with open(BASE_DIR / 'scaler_y.pkl', 'rb') as f:
        scaler_y = pickle.load(f)
    with open(BASE_DIR / 'feature_cols.pkl', 'rb') as f:
        FEATURE_COLS = pickle.load(f)
except Exception as e:
    raise RuntimeError(f"Gagal memuat file scalers/features. Pastikan file pkl ada di {BASE_DIR}. Error: {e}")

WINDOW_SIZE = 18
N_FEATURES  = len(FEATURE_COLS)

import tensorflow as tf

@tf.keras.utils.register_keras_serializable()
class TemporalAttention(tf.keras.layers.Layer):
    def __init__(self, **kwargs):
        super(TemporalAttention, self).__init__(**kwargs)
        self.score = tf.keras.layers.Dense(1, name='score')

    def call(self, x):
        # We don't know if tanh was used before the dense layer or inside it.
        # But Dense has linear activation by default.
        # Wait, if Dense has linear, maybe it was just self.score(x)?
        # I'll just use self.score(x) first.
        e = self.score(x)
        a = tf.keras.activations.softmax(e, axis=1)
        output = x * a
        return tf.keras.backend.sum(output, axis=1)

# Lazy-load TF to keep startup fast
_models = {}
def get_model(name='bidir'):
    if name not in _models:
        p = BASE_DIR / "best_bidir.keras" if name == 'bidir' else BASE_DIR / f'best_{name}.keras'
        if p.exists():
            _models[name] = tf.keras.models.load_model(str(p), custom_objects={
                'TemporalAttention': TemporalAttention,
                'Orthogonal': tf.keras.initializers.Orthogonal,
                'GlorotUniform': tf.keras.initializers.GlorotUniform,
                'Zeros': tf.keras.initializers.Zeros,
                'Ones': tf.keras.initializers.Ones
            }, compile=False)
        else:
            # Fallback if specific file name is requested but only best_bidir is present
            alt_p = BASE_DIR / "best_bidir.keras"
            print(f"Loading {name} from {alt_p}...")
            _models[name] = tf.keras.models.load_model(str(alt_p), custom_objects={
                'TemporalAttention': TemporalAttention,
                'Orthogonal': tf.keras.initializers.Orthogonal,
                'GlorotUniform': tf.keras.initializers.GlorotUniform,
                'Zeros': tf.keras.initializers.Zeros,
                'Ones': tf.keras.initializers.Ones
            }, compile=False)
            print(f"Loaded {name} successfully.")
    return _models.get(name)

# ── Custom Logic ────────────────────────────────────────────────
def compute_confidence_score(pred_occ: float, recent_std: float) -> dict:
    """Compute confidence and translate to human language for admin."""
    base_conf = max(0.5, 1.0 - min(recent_std * 5, 0.5))
    if pred_occ < 0.05 or pred_occ > 0.98: 
        base_conf *= 0.85
    conf_pct = round(base_conf * 100, 1)
    conf_lvl = 'TINGGI' if conf_pct >= 85 else ('SEDANG' if conf_pct >= 65 else 'RENDAH')
    return {'confidence_pct': conf_pct, 'confidence_level': conf_lvl}

def generate_action_recommendation(pred_occ: float, confidence: dict,
                                    occupancy_change_rate: float = 0.0,
                                    internet_ok: bool = True) -> dict:
    """Core AI logic: generate admin action recommendations."""
    conf_pct = confidence['confidence_pct']
    actions  = []
    urgency  = 'NORMAL'
    pct = round(pred_occ * 100, 1)

    if not internet_ok:
        return {'urgency':'WARNING', 'actions':['Gunakan data manual, prediksi tidak ditampilkan'],
                'status_flag':'Koneksi tidak stabil — menggunakan estimasi',
                'human_summary':'Data tidak dapat diverifikasi karena koneksi bermasalah.',
                'predicted_pct': pct}
    if conf_pct < 60:
        return {'urgency':'INFO', 'actions':['Periksa sensor parkir, data kurang akurat'],
                'status_flag':'Data sedang diproses — confidence rendah',
                'human_summary':f'Confidence {conf_pct}% — prediksi kurang dapat diandalkan. Validasi manual disarankan.',
                'predicted_pct': pct}

    mins_to_full = None
    if pred_occ < 1.0 and occupancy_change_rate > 0:
        remaining = 1.0 - pred_occ
        mins_to_full = int(remaining / (occupancy_change_rate + 1e-9) * 10)
    elif pred_occ >= 0.95:
        mins_to_full = 0

    if pred_occ >= 0.95:
        urgency = 'KRITIS'
        actions = ['Tutup gate masuk segera','Aktifkan petugas arahkan ke Parkir B','Kirim notifikasi ke pengendara']
        human_summary = f'★ Parkir HAMPIR PENUH ({pct}%). Ambil tindakan segera!'
    elif pred_occ >= 0.85 and conf_pct >= 80:
        urgency = 'TINGGI'
        actions = ['Siapkan petugas tambahan di pintu masuk','Aktifkan tanda peringatan kapasitas',
                   'Pertimbangkan kenaikan tarif 20% untuk kurangi arus masuk']
        human_summary = f'☆ Parkir mendekati penuh ({pct}%). Prediksi penuh dalam ~{mins_to_full} menit.' if mins_to_full is not None else f'☆ Parkir mendekati penuh ({pct}%).'
    elif pred_occ >= 0.70:
        urgency = 'SEDANG'
        actions = ['Pantau arus masuk secara aktif','Persiapkan rencana pengalihan jika naik >85%']
        human_summary = f'★ Tingkat kunjungan tinggi ({pct}%). Waspada peningkatan.'
    elif pred_occ <= 0.20:
        urgency = 'RENDAH'
        actions = ['Kurangi tarif 10% untuk menarik pengendara','Matikan sebagian lampu area kosong (hemat energi)']
        human_summary = f'★ Parkir sangat sepi ({pct}%). Pertimbangkan promo tarif.'
    else:
        urgency = 'NORMAL'
        actions = ['Tidak ada tindakan khusus diperlukan']
        human_summary = f'★ Kondisi normal ({pct}%). Operasional berjalan baik.'

    if abs(occupancy_change_rate) > 0.15:
        actions.append(f'☑️ Perubahan drastis terdeteksi ({occupancy_change_rate*100:+.0f}%/interval) — cek sensor')
        human_summary += ' Lonjakan/penurunan tidak wajar terdeteksi.'

    status_flag = 'Data stabil' if conf_pct >= 85 else 'Data estimasi — validasi manual disarankan'
    confidence_human = (f'Confidence {conf_pct}% — prediksi dapat dipercaya' if conf_pct >= 80
                        else f'Confidence {conf_pct}% — data kurang stabil')

    return {
        'urgency': urgency,
        'actions': actions,
        'status_flag': status_flag,
        'human_summary': human_summary,
        'confidence_human': confidence_human,
        'mins_to_full': mins_to_full,
        'predicted_pct': pct,
    }

def generate_ai_narrative(pred_occ: float, rec: dict,
                           weather: str = 'SUNNY', hour: int = 10) -> str:
    """Hasilkan narasi admin menggunakan Groq AI atau fallback."""
    predicted_pct_str = f"{rec.get('predicted_pct', 'N/A')}"

    if not groq_client:
        hour_ctx = 'pagi' if hour < 12 else ('siang' if hour < 15 else ('sore' if hour < 19 else 'malam'))
        weather_ctx = {'SUNNY':'cerah','OVERCAST':'mendung','RAINY':'hujan'}.get(weather,'tidak diketahui')
        return (f"[AI Narasi — Fallback] Pada {hour_ctx} ini dengan cuaca {weather_ctx}, "
                f"tingkat okupansi diprediksi {predicted_pct_str}%. "
                f"{rec['human_summary']} "
                f"Saran utama: {rec['actions'][0] if rec['actions'] else 'pantau situasi'}.")

    prompt = f"""Kamu adalah AI asisten untuk sistem manajemen parkir cerdas.
Berikan narasi singkat (2-3 kalimat) dalam Bahasa Indonesia untuk admin parkir berdasarkan data berikut:
- Prediksi okupansi 30 menit ke depan: {predicted_pct_str}%
- Status: {rec['urgency']}
- Cuaca: {weather}
- Jam: {hour:02d}:00
- Saran sistem: {'; '.join(rec['actions'][:2])}

Narasi harus praktis, mudah dipahami admin lapangan, tidak teknis, dan langsung berikan poin utama."""

    try:
        response = groq_client.chat.completions.create(
            messages=[{"role": "user", "content": prompt}],
            model="llama-3.1-8b-instant",
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        # Fallback to another model with high free tier limits
        try:
            fallback_response = groq_client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="qwen/qwen3-32b",
            )
            return fallback_response.choices[0].message.content.strip()
        except Exception as fallback_e:
            return f"[Groq API error: {fallback_e}] {rec['human_summary']}"


# ── Pydantic Schemas ───────────────────────────────────────────────────────
class ObsRow(BaseModel):
    occupancy_rate: float = Field(..., ge=0, le=1)
    hour: int = Field(..., ge=0, le=23)
    day_of_week: int = Field(..., ge=0, le=6)
    is_weekend: int = Field(0, ge=0, le=1)
    weather: str = 'SUNNY'

class PredictRequest(BaseModel):
    observations: List[ObsRow]
    internet_ok: bool = True
    use_ensemble: bool = True

class FeedbackRequest(BaseModel):
    prediction_id: str
    actual_occupancy: float
    admin_action_taken: Optional[str] = None
    correct: bool = True

# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="SmartPark AI API",
    description="Parking occupancy prediction + admin action recommendations",
    version="2.0.0"
)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

feedback_log = []
prediction_cache = {}

def build_features(obs_list):
    weather_map = {'SUNNY':0,'OVERCAST':1,'RAINY':2,'UNKNOWN':0,'S':0,'C':1,'R':2}
    rows = []
    for o in obs_list:
        # Convert JS day_of_week (0=Sun, 1=Mon) to Pandas day_of_week (0=Mon, 6=Sun)
        pd_dow = (o.day_of_week + 6) % 7
        
        rows.append({
            'occupancy_rate': o.occupancy_rate,
            'hour': o.hour,
            'day_of_week': pd_dow,
            'is_weekend': o.is_weekend,
            'weather_encoded': weather_map.get(o.weather.upper(), 0),
            'hour_sin': np.sin(2 * np.pi * o.hour / 24),
            'hour_cos': np.cos(2 * np.pi * o.hour / 24),
            'dow_sin':  np.sin(2 * np.pi * pd_dow / 7),
            'dow_cos':  np.cos(2 * np.pi * pd_dow / 7),
        })
    
    df = pd.DataFrame(rows)
    
    df['is_morning_peak'] = df['hour'].between(8, 11).astype(int)
    df['is_evening_peak'] = df['hour'].between(16, 19).astype(int)
    df['is_rush_hour']    = df['hour'].isin([7, 8, 9, 16, 17, 18]).astype(int)

    for lag in [1, 2, 3, 6, 12, 24, 48]:
        df[f'lag_{lag}'] = df['occupancy_rate'].shift(lag)
        
    for w in [3, 6, 12, 24, 48]:
        df[f'roll_mean_{w}'] = df['occupancy_rate'].rolling(w, min_periods=1).mean()
        df[f'roll_std_{w}']  = df['occupancy_rate'].rolling(w, min_periods=1).std().fillna(0)
        
    df['momentum']     = df['occupancy_rate'].diff().fillna(0)
    df['acceleration'] = df['momentum'].diff().fillna(0)
    df['ema_01']       = df['occupancy_rate'].ewm(alpha=0.1).mean()
    df['ema_03']       = df['occupancy_rate'].ewm(alpha=0.3).mean()
    
    # Ensure all features exist and match training fillna logic exactly
    for c in FEATURE_COLS:
        if c not in df.columns: 
            df[c] = 0.0
            
    df[FEATURE_COLS] = df[FEATURE_COLS].bfill().ffill().fillna(0)
    
    return df

@app.get("/health")
def health():
    return {"status":"ok","version":"2.0","timestamp":datetime.datetime.now().isoformat()}

@app.post("/predict")
def predict(req: PredictRequest):
    import traceback
    try:
        obs = req.observations
        if len(obs) < WINDOW_SIZE:
            raise HTTPException(400, f"Need ≥{WINDOW_SIZE} observations, got {len(obs)}")
        df = build_features(obs)

        df_scaled_inf = df.copy()
        df_scaled_inf[FEATURE_COLS] = scaler_X.transform(df[FEATURE_COLS])
        seq = df_scaled_inf[FEATURE_COLS].iloc[-WINDOW_SIZE:].values.reshape(1,WINDOW_SIZE,N_FEATURES)

        # --- FORCE BIDIR MODEL FOR PRODUCTION ---
        model_version = "A_BIDIR"
        m = get_model('bidir')
        if m:
            pred_occ = float(np.clip(scaler_y.inverse_transform(m.predict(seq, verbose=0)).flatten()[0], 0, 1))
        else:
            pred_occ = float(obs[-1].occupancy_rate)
            model_version = "FALLBACK"
        # ----------------------------------

        recent_df_for_std = pd.DataFrame([o.model_dump() if hasattr(o, 'model_dump') else o.dict() for o in obs])
        recent_std = float(recent_df_for_std['occupancy_rate'].tail(12).std())
        confidence = compute_confidence_score(pred_occ, recent_std)

        occ_vals  = [o.occupancy_rate for o in obs[-6:]]
        change_rt = float(np.polyfit(range(len(occ_vals)),occ_vals,1)[0]) if len(occ_vals)>1 else 0.0

        rec = generate_action_recommendation(pred_occ, confidence, change_rt, req.internet_ok)

        hr = obs[-1].hour if obs else datetime.datetime.now().hour
        wx = obs[-1].weather if obs else 'UNKNOWN'
        narrative = generate_ai_narrative(pred_occ, rec, weather=wx, hour=hr)

        pid = f"pred_{datetime.datetime.now().strftime('%Y%m%d%H%M%S%f')}"
        result = {
            'prediction_id': pid,
            'model_version': model_version,
            'timestamp': datetime.datetime.now().isoformat(),
            'current_occupancy': round(obs[-1].occupancy_rate, 4),
            'predicted_occupancy_30min': round(pred_occ, 4),
            'predicted_pct': f"{pred_occ*100:.1f}%",
            'confidence': confidence,
            'recommendation': rec,
            'ai_narrative': narrative,
            'change_rate_per_interval': round(change_rt, 4),
            'source': "Modal.com Cloud ML" if model_version != "FALLBACK" else "Local Rule-based",
        }
        prediction_cache[pid] = result
        return result
    except Exception as e:
        return {"error": str(e), "traceback": traceback.format_exc()}

@app.get("/dashboard")
def dashboard():
    if not prediction_cache:
        return {"message":"No predictions yet. POST to /predict first.", "status_flag": "No data", "urgency": "INFO", "human_summary": "No prediction data available. Please make a POST request to /predict first.", "actions": [], "confidence_human": "N/A", "predicted_pct": "N/A"}
    latest_key = sorted(prediction_cache.keys())[-1]
    return prediction_cache[latest_key]

@app.post("/feedback")
def feedback(req: FeedbackRequest):
    entry = req.dict()
    entry['logged_at'] = datetime.datetime.now().isoformat()
    
    # Retrieve model_version from cache for A/B testing analysis
    if req.prediction_id in prediction_cache:
        entry['model_version'] = prediction_cache[req.prediction_id].get('model_version', 'UNKNOWN')
        
    feedback_log.append(entry)
    return {"status":"logged","total_feedback": len(feedback_log)}

@app.get("/logs")
def get_logs():
    return {"total": len(feedback_log), "entries": feedback_log[-10:]}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
