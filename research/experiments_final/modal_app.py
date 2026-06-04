import os
import sqlite3
import pickle
import requests
import datetime as dt
from typing import List, Optional

import modal
from pydantic import BaseModel, Field

# --- Modal Setup ---
LOCAL_MODEL_DIR = r"C:\Users\user\Downloads\next js on opennext github action\modelling\exp_final\SmartPark_Capstone_Final_Package (1)\smartpark_outputs"
REMOTE_MODEL_DIR = "/models"
DB_PATH = "/data/parking.db"

app = modal.App("smartpark-occupancy-api")
db_volume = modal.Volume.from_name("smartpark-db", create_if_missing=True)

image = (
    modal.Image.debian_slim()
    .pip_install(
        "tensorflow~=2.15.0",
        "pandas",
        "scikit-learn",
        "fastapi",
        "pydantic",
        "numpy",
        "requests"
    )
)

# --- FastAPI Setup ---
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

web_app = FastAPI(title='SmartPark RESTful API with Generative AI', version='2.0')
web_app.add_middleware(
    CORSMiddleware, 
    allow_origins=['*'], 
    allow_credentials=True, 
    allow_methods=['*'], 
    allow_headers=['*']
)

# --- Global State ---
_models = {}
_scalers = {}

# --- Pydantic Schemas ---
class Observation(BaseModel):
    occupancy_rate: float = Field(..., ge=0, le=1)
    hour: int = Field(..., ge=0, le=23)
    day_of_week: int = Field(..., ge=0, le=6)
    weather: Optional[str] = 'UNKNOWN'

class PredictRequest(BaseModel):
    observations: List[Observation]

class InsightRequest(BaseModel):
    prediction_id: int

# --- App Execution ---
@app.function(
    image=image, 
    mounts=[modal.Mount.from_local_dir(LOCAL_MODEL_DIR, remote_path=REMOTE_MODEL_DIR)],
    volumes={"/data": db_volume},
    secrets=[modal.Secret.from_name("cloudflare-api", required_keys=["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"])]
)
@modal.asgi_app()
def fastapi_app():
    import numpy as np
    import pandas as pd
    import tensorflow as tf

    WINDOW_SIZE = 18
    weather_map = {'SUNNY': 0, 'OVERCAST': 1, 'RAINY': 2, 'UNKNOWN': 0, 'S': 0, 'C': 1, 'R': 2}

    # 1. Custom Components
    class TemporalAttention(tf.keras.layers.Layer):
        def __init__(self, **kw):
            super().__init__(**kw)
            self.score = tf.keras.layers.Dense(1)

        def call(self, x):
            weights = tf.nn.softmax(self.score(x), axis=1)
            return tf.reduce_sum(x * weights, axis=1)

        def get_config(self):
            return super().get_config()

    def weighted_huber_loss(delta=0.3, high_w=2.0):
        def loss(y_true, y_pred):
            err = y_true - y_pred
            huber = tf.where(
                tf.abs(err) <= delta,
                0.5 * tf.square(err),
                delta * (tf.abs(err) - 0.5 * delta)
            )
            weights = tf.where(y_true > 0.5, high_w, 1.0)
            return tf.reduce_mean(huber * weights)
        return loss

    # 2. Setup Database
    def init_db():
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS predictions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                predicted_occupancy REAL NOT NULL,
                timestamp TEXT NOT NULL,
                insight_generated TEXT
            )
        ''')
        conn.commit()
        conn.close()

    init_db()

    # 3. Load Models & Scalers
    def load_resources():
        if 'model' not in _models:
            model_path = os.path.join(REMOTE_MODEL_DIR, 'BiDir_Original.keras')
            if not os.path.exists(model_path):
                raise FileNotFoundError(f"Model file {model_path} not found.")
            
            _models['model'] = tf.keras.models.load_model(
                model_path, 
                custom_objects={'TemporalAttention': TemporalAttention, 'loss': weighted_huber_loss()},
                compile=False
            )
            
            with open(os.path.join(REMOTE_MODEL_DIR, 'scaler_X.pkl'), 'rb') as f:
                _scalers['scaler_X'] = pickle.load(f)
            with open(os.path.join(REMOTE_MODEL_DIR, 'scaler_y.pkl'), 'rb') as f:
                _scalers['scaler_y'] = pickle.load(f)
            with open(os.path.join(REMOTE_MODEL_DIR, 'feature_cols.pkl'), 'rb') as f:
                _scalers['feature_cols'] = pickle.load(f)
                
    # 4. Feature Engineering logic
    def build_features(observations: List[dict]) -> pd.DataFrame:
        data = pd.DataFrame(observations)
        data['is_weekend'] = (data['day_of_week'] >= 5).astype(int)
        data['weather_encoded'] = data['weather'].map(weather_map).fillna(0).astype(int)
        data['hour_sin'] = np.sin(2 * np.pi * data['hour'] / 24)
        data['hour_cos'] = np.cos(2 * np.pi * data['hour'] / 24)
        data['dow_sin'] = np.sin(2 * np.pi * data['day_of_week'] / 7)
        data['dow_cos'] = np.cos(2 * np.pi * data['day_of_week'] / 7)
        data['is_morning_peak'] = data['hour'].between(8, 11).astype(int)
        data['is_evening_peak'] = data['hour'].between(16, 19).astype(int)
        data['is_rush_hour'] = data['hour'].isin([7, 8, 9, 16, 17, 18]).astype(int)

        for lag in [1, 2, 3, 6, 12, 24, 48]:
            data[f'lag_{lag}'] = data['occupancy_rate'].shift(lag)
        for window in [3, 6, 12, 24, 48]:
            data[f'roll_mean_{window}'] = data['occupancy_rate'].rolling(window, min_periods=1).mean()
            data[f'roll_std_{window}'] = data['occupancy_rate'].rolling(window, min_periods=1).std().fillna(0)

        data['momentum'] = data['occupancy_rate'].diff().fillna(0)
        data['acceleration'] = data['momentum'].diff().fillna(0)
        data['ema_01'] = data['occupancy_rate'].ewm(alpha=0.1).mean()
        data['ema_03'] = data['occupancy_rate'].ewm(alpha=0.3).mean()
        
        feature_cols = _scalers['feature_cols']
        data[feature_cols] = data[feature_cols].bfill().ffill().fillna(0)
        return data

    # 5. RESTful Endpoints
    @web_app.get('/health')
    def health():
        return {'status': 'ok', 'timestamp': dt.datetime.now().isoformat()}

    @web_app.post('/predictions', status_code=201)
    def create_prediction(request: PredictRequest):
        load_resources()
        
        if len(request.observations) < WINDOW_SIZE:
            raise HTTPException(status_code=400, detail=f'Minimum {WINDOW_SIZE} observations are required.')

        obs = [item.dict() for item in request.observations]
        features = build_features(obs).tail(WINDOW_SIZE)
        
        feature_cols = _scalers['feature_cols']
        scaler_X = _scalers['scaler_X']
        scaler_y = _scalers['scaler_y']
        model = _models['model']
        
        n_features = len(feature_cols)
        X = scaler_X.transform(features[feature_cols]).reshape(1, WINDOW_SIZE, n_features).astype(np.float32)

        pred_scaled = model.predict(X, verbose=0).flatten()[0]
        pred_raw = scaler_y.inverse_transform(np.array([[pred_scaled]])).flatten()[0]
        pred_raw = float(np.clip(pred_raw, 0, 1))
        
        timestamp = dt.datetime.now().isoformat()

        # Save to database
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            'INSERT INTO predictions (predicted_occupancy, timestamp) VALUES (?, ?)',
            (pred_raw, timestamp)
        )
        prediction_id = cursor.lastrowid
        conn.commit()
        conn.close()

        return {
            'id': prediction_id,
            'predicted_occupancy_30min': round(pred_raw, 4),
            'predicted_pct': f'{pred_raw * 100:.1f}%',
            'timestamp': timestamp,
            'message': 'Prediction saved successfully.'
        }

    @web_app.get('/predictions')
    def get_predictions(limit: int = 10):
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute(
            'SELECT id, predicted_occupancy, timestamp, insight_generated FROM predictions ORDER BY id DESC LIMIT ?', 
            (limit,)
        )
        rows = cursor.fetchall()
        conn.close()
        
        result = []
        for row in rows:
            result.append({
                'id': row[0],
                'predicted_occupancy': round(row[1], 4),
                'predicted_pct': f'{row[1] * 100:.1f}%',
                'timestamp': row[2],
                'insight_generated': row[3]
            })
        return {'data': result}

    @web_app.post('/insights')
    def generate_insight(request: InsightRequest):
        # Fetch the prediction from DB
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('SELECT predicted_occupancy FROM predictions WHERE id = ?', (request.prediction_id,))
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Prediction ID not found.")
            
        predicted_occ = row[0]
        predicted_pct = round(predicted_occ * 100, 1)
        
        # Check if already generated
        cursor.execute('SELECT insight_generated FROM predictions WHERE id = ?', (request.prediction_id,))
        existing_insight = cursor.fetchone()[0]
        if existing_insight:
            conn.close()
            return {'id': request.prediction_id, 'insight': existing_insight}

        # Call Cloudflare Workers AI
        account_id = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
        api_token = os.environ.get("CLOUDFLARE_API_TOKEN")
        
        if not account_id or not api_token:
            conn.close()
            raise HTTPException(status_code=500, detail="Cloudflare credentials not found in environment variables.")
            
        model_name = "@cf/meta/llama-3-8b-instruct"
        url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run/{model_name}"
        headers = {"Authorization": f"Bearer {api_token}"}
        
        prompt = (
            f"Tingkat keterisian parkir diprediksi mencapai {predicted_pct}% dalam 30 menit ke depan. "
            "Berikan 1 paragraf singkat (maksimal 3 kalimat) berupa rekomendasi operasional "
            "untuk satpam/petugas parkir dalam bahasa Indonesia."
        )
        
        payload = {
            "messages": [
                {"role": "system", "content": "Anda adalah asisten AI untuk manajemen parkir."},
                {"role": "user", "content": prompt}
            ]
        }
        
        response = requests.post(url, headers=headers, json=payload)
        
        if response.status_code != 200:
            conn.close()
            raise HTTPException(status_code=502, detail=f"Failed to fetch insight from AI: {response.text}")
            
        ai_data = response.json()
        insight_text = ai_data.get('result', {}).get('response', 'Tidak ada rekomendasi.')
        
        # Update database with the generated insight
        cursor.execute('UPDATE predictions SET insight_generated = ? WHERE id = ?', (insight_text, request.prediction_id))
        conn.commit()
        conn.close()
        
        return {
            'id': request.prediction_id,
            'predicted_pct': f'{predicted_pct}%',
            'insight': insight_text
        }

    return web_app

if __name__ == "__main__":
    print("Run `modal serve modal_app.py` or `modal deploy modal_app.py` to deploy to Modal.")
