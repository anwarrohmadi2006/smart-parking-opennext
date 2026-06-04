# -----------------------------------------------------------------------------
# 20. Optional FastAPI Export
# -----------------------------------------------------------------------------
# File API ini bersifat opsional untuk demonstrasi deployment.
# Endpoint /predict menggunakan model dan scaler yang sudah diekspor dari notebook.
# Struktur fitur pada API harus tetap konsisten dengan pipeline training.

import pickle
import datetime as dt
from pathlib import Path
from typing import List, Optional

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

OUTPUT_DIR = Path('/content/smartpark_outputs')
WINDOW_SIZE = 18

with open(OUTPUT_DIR / 'scaler_X.pkl', 'rb') as f:
    scaler_X = pickle.load(f)
with open(OUTPUT_DIR / 'scaler_y.pkl', 'rb') as f:
    scaler_y = pickle.load(f)
with open(OUTPUT_DIR / 'feature_cols.pkl', 'rb') as f:
    FEATURE_COLS = pickle.load(f)

N_FEATURES = len(FEATURE_COLS)
weather_map = {'SUNNY': 0, 'OVERCAST': 1, 'RAINY': 2, 'UNKNOWN': 0, 'S': 0, 'C': 1, 'R': 2}

app = FastAPI(title='SmartPark Occupancy Forecasting API', version='1.0')
app.add_middleware(CORSMiddleware, allow_origins=['*'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

_models = {}

def load_model():
    import tensorflow as tf
    if 'model' not in _models:
        model_path = OUTPUT_DIR / 'CLSTAN_Original.keras'
        if not model_path.exists():
            model_path = OUTPUT_DIR / 'Baseline.keras'
        if not model_path.exists():
            raise FileNotFoundError('Model file is not available in OUTPUT_DIR.')
        _models['model'] = tf.keras.models.load_model(str(model_path), compile=False)
    return _models['model']

class Observation(BaseModel):
    occupancy_rate: float = Field(..., ge=0, le=1)
    hour: int = Field(..., ge=0, le=23)
    day_of_week: int = Field(..., ge=0, le=6)
    weather: Optional[str] = 'UNKNOWN'

class PredictRequest(BaseModel):
    observations: List[Observation]


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
    data[FEATURE_COLS] = data[FEATURE_COLS].bfill().ffill().fillna(0)
    return data

@app.get('/health')
def health():
    return {'status': 'ok', 'timestamp': dt.datetime.now().isoformat()}

@app.post('/predict')
def predict(request: PredictRequest):
    if len(request.observations) < WINDOW_SIZE:
        raise HTTPException(status_code=400, detail=f'Minimum {WINDOW_SIZE} observations are required.')

    obs = [item.dict() for item in request.observations]
    features = build_features(obs).tail(WINDOW_SIZE)
    X = scaler_X.transform(features[FEATURE_COLS]).reshape(1, WINDOW_SIZE, N_FEATURES).astype(np.float32)

    model = load_model()
    pred_scaled = model.predict(X, verbose=0).flatten()[0]
    pred_raw = scaler_y.inverse_transform(np.array([[pred_scaled]])).flatten()[0]
    pred_raw = float(np.clip(pred_raw, 0, 1))

    return {
        'predicted_occupancy_30min': round(pred_raw, 4),
        'predicted_pct': f'{pred_raw * 100:.1f}%',
        'timestamp': dt.datetime.now().isoformat()
    }
