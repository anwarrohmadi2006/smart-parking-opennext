# %% [markdown]
# # 🚗 SmartPark AI — Admin Intelligence System
# **End-to-End Deep Learning Pipeline | CNRPark+EXT Dataset**
# 
# Team: CC26-PRU436 | Coding Camp 2026 powered by DBS Foundation
# 
# ---
# ### 🎯 Objectives
# - Prediksi okupansi parkir 30 menit ke depan (**MAE ≤ 0.02**, **Accuracy ≥ 85%**)
# - Custom Training Loop via `tf.GradientTape`
# - TensorBoard Monitoring
# - FastAPI REST API (mandiri)
# - Generative AI (Gemini) untuk saran aksi admin
# - Confidence Score + Human-Readable Insight
# - Edge-Case Handling & Adaptive Recommendations
# 

# %%
# ── 1. Install Dependencies ──────────────────────────────────────────────────
!pip install -q tensorflow==2.15.0 scikit-learn pandas matplotlib seaborn scipy xgboost fastapi uvicorn nest-asyncio pyngrok google-generativeai statsmodels

import os, re, json, warnings, gc, pickle, datetime
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
from collections import Counter
from datetime import datetime, timedelta
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import TimeSeriesSplit
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model, callbacks
from scipy import stats

warnings.filterwarnings('ignore')
np.random.seed(42)
tf.random.set_seed(42)

print(f"✅ TensorFlow  : {tf.__version__}")
print(f"✅ GPU         : {len(tf.config.list_physical_devices('GPU')) > 0}")
print(f"✅ All deps OK")


# %% [markdown]
# ## 2️⃣ Data Acquisition — CNRPark+EXT

# %%
!pip install -q kaggle
ZIP_PATH     = '/content/cnrpark-ext.zip'
EXTRACT_PATH = Path('/content/cnrpark_data')
OUTPUT_DIR   = Path('/content/smartpark_outputs')
LOG_DIR      = Path('/content/smartpark_logs')
for d in [OUTPUT_DIR, LOG_DIR]: d.mkdir(parents=True, exist_ok=True)

if not os.path.exists(ZIP_PATH):
    !kaggle datasets download -d ddsshubham/cnrpark-ext
    print("✅ Download selesai!")
else:
    print(f"✅ ZIP sudah ada ({os.path.getsize(ZIP_PATH)/1024**3:.2f} GB)")

if not EXTRACT_PATH.exists():
    EXTRACT_PATH.mkdir(parents=True, exist_ok=True)
    !unzip -q {ZIP_PATH} -d {EXTRACT_PATH}
    print("✅ Extract selesai!")
else:
    print(f"✅ Sudah ter-extract: {EXTRACT_PATH}")


# %% [markdown]
# ## 3️⃣ Data Wrangling

# %%
PREFIX_WEATHER = {'S': 'SUNNY', 'C': 'OVERCAST', 'R': 'RAINY'}
TOTAL_SLOTS   = 164

# ── Phase 1: Label Lookup ─────────────────────────────────────────────────────
def build_label_lookup(base_path):
    txt_lup, csv_lup = {}, {}
    for root, _, files in os.walk(base_path):
        for fname in files:
            fpath = Path(root) / fname
            if fname.lower().endswith('.txt'):
                try:
                    with open(fpath, 'r', encoding='utf-8', errors='ignore') as f:
                        for line in f:
                            parts = line.strip().rsplit(None, 1)
                            if len(parts) == 2:
                                try: txt_lup[os.path.basename(parts[0])] = int(parts[1])
                                except: pass
                except: pass
            elif fname.lower().endswith('.csv'):
                try:
                    df_c = pd.read_csv(fpath, low_memory=False)
                    df_c.columns = [c.strip().lower() for c in df_c.columns]
                    pc = next((c for c in df_c.columns if any(k in c for k in ['path','image','file','img'])), None)
                    lc = next((c for c in df_c.columns if any(k in c for k in ['label','class','occ','busy','status'])), None)
                    if pc and lc:
                        for _, row in df_c[[pc, lc]].dropna().iterrows():
                            try: csv_lup[os.path.basename(str(row[pc]))] = int(row[lc])
                            except: pass
                except: pass
    return {**csv_lup, **txt_lup}

# ── Phase 2: Parse Patches ────────────────────────────────────────────────────
def parse_patches(base_path, label_lookup):
    records, skip_lbl, skip_ts = [], 0, 0
    for root, _, files in os.walk(base_path):
        for fname in files:
            if not fname.lower().endswith(('.jpg','.jpeg','.png')): continue
            fp   = Path(root) / fname
            rel  = os.path.relpath(fp, base_path).replace('\\','/')
            parts= rel.split('/')
            name = os.path.splitext(fname)[0]
            # Label
            lbl = label_lookup.get(fname, -1)
            if lbl == -1:
                par = parts[-2].upper() if len(parts)>=2 else ''
                if par in {'0','FREE','EMPTY'}: lbl = 0
                elif par in {'1','BUSY','OCCUPIED'}: lbl = 1
            if lbl == -1: skip_lbl += 1; continue
            # Timestamp
            dt = None
            for pat, fmt in [
                (r'(\d{4}-\d{2}-\d{2})_(\d{2})\.(\d{2})', '%Y-%m-%d %H %M'),
                (r'(\d{4}-\d{2}-\d{2})_(\d{2}):(\d{2})',   '%Y-%m-%d %H %M'),
                (r'(\d{8})(\d{2})(\d{2})',                   '%Y%m%d %H %M'),
            ]:
                m = re.search(pat, name)
                if m:
                    try: dt = datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", fmt); break
                    except: pass
            if dt is None: skip_ts += 1; continue
            # Weather / Camera
            wx = PREFIX_WEATHER.get(name[0].upper(), 'UNKNOWN') if name else 'UNKNOWN'
            if wx == 'UNKNOWN':
                for p in parts:
                    pu = p.upper()
                    if 'SUNNY' in pu: wx='SUNNY'; break
                    if 'OVERCAST' in pu or 'CLOUDY' in pu: wx='OVERCAST'; break
                    if 'RAINY' in pu: wx='RAINY'; break
            mc = re.search(r'C(\d{1,2})', name)
            cam = f"CAMERA{int(mc.group(1))}" if mc else 'UNKNOWN'
            ms = re.search(r'_(\d{1,3})$', name)
            slot = int(ms.group(1)) if ms else None
            records.append({'timestamp':dt,'camera_id':cam,'weather':wx,'slot_id':slot,'label':int(lbl),'filename':fname})
    return pd.DataFrame(records), {'parsed':len(records),'skip_lbl':skip_lbl,'skip_ts':skip_ts}

print("🔍 Building label lookup...")
label_lookup = build_label_lookup(EXTRACT_PATH)
print(f"   {len(label_lookup):,} entries found")

print("🔍 Parsing patches...")
df_patches, stats_parse = parse_patches(EXTRACT_PATH, label_lookup)
print(f"   ✅ Parsed   : {stats_parse['parsed']:,}")
print(f"   ❌ No label : {stats_parse['skip_lbl']:,}")
print(f"   ❌ No ts    : {stats_parse['skip_ts']:,}")
if not df_patches.empty:
    print(f"   Date range : {df_patches['timestamp'].min()} → {df_patches['timestamp'].max()}")


# %% [markdown]
# ## 4️⃣ Aggregation, EDA & Feature Engineering

# %%
# ── Aggregate to Time-Series ──────────────────────────────────────────────────
df_agg = df_patches[df_patches['label'].isin([0,1])].copy()
df_agg = df_agg.sort_values('timestamp').drop_duplicates()

df_ts = (
    df_agg.groupby('timestamp')
    .agg(
        occupied_slots=('label','sum'),
        total_patches=('label','count'),
        weather=('weather', lambda x: x.mode().iloc[0] if not x.mode().empty else 'UNKNOWN')
    ).reset_index()
)
df_ts['occupancy_rate'] = (df_ts['occupied_slots'] / df_ts['total_patches']).clip(0,1)
df_ts = df_ts.set_index('timestamp')

# Resample to 10-min
df_uni = df_ts.resample('10min').agg({
    'occupied_slots':'mean','total_patches':'sum',
    'weather': lambda x: x.mode().iloc[0] if len(x.dropna()) else np.nan,
    'occupancy_rate':'mean'
}).reset_index()
df_uni['occupancy_rate'] = df_uni['occupancy_rate'].interpolate(limit_direction='both').clip(0,1)
df_uni['weather']        = df_uni['weather'].ffill().bfill().fillna('UNKNOWN')
df_uni['hour']           = df_uni['timestamp'].dt.hour
df_uni['day_of_week']    = df_uni['timestamp'].dt.dayofweek
df_uni['is_weekend']     = (df_uni['day_of_week']>=5).astype(int)
df_uni['month']          = df_uni['timestamp'].dt.month
df = df_uni.dropna(subset=['occupancy_rate']).reset_index(drop=True)
print(f"✅ Time-series: {df.shape}")

# ── Feature Engineering ───────────────────────────────────────────────────────
weather_map = {'SUNNY':0,'OVERCAST':1,'RAINY':2,'UNKNOWN':0}
df['weather_encoded'] = df['weather'].map(weather_map).fillna(0).astype(int)
df['hour_sin'] = np.sin(2*np.pi*df['hour']/24)
df['hour_cos'] = np.cos(2*np.pi*df['hour']/24)
df['dow_sin']  = np.sin(2*np.pi*df['day_of_week']/7)
df['dow_cos']  = np.cos(2*np.pi*df['day_of_week']/7)
df['is_morning_peak'] = df['hour'].between(8,11).astype(int)
df['is_evening_peak'] = df['hour'].between(16,19).astype(int)
df['is_rush_hour']    = df['hour'].isin([7,8,9,16,17,18]).astype(int)
for lag in [1,2,3,6,12,24,48]: df[f'lag_{lag}'] = df['occupancy_rate'].shift(lag)
for w in [3,6,12,24,48]:
    df[f'roll_mean_{w}'] = df['occupancy_rate'].rolling(w,min_periods=1).mean()
    df[f'roll_std_{w}']  = df['occupancy_rate'].rolling(w,min_periods=1).std().fillna(0)
df['momentum']     = df['occupancy_rate'].diff().fillna(0)
df['acceleration'] = df['momentum'].diff().fillna(0)
df['ema_01'] = df['occupancy_rate'].ewm(alpha=0.1).mean()
df['ema_03'] = df['occupancy_rate'].ewm(alpha=0.3).mean()
TARGET_HORIZON = 3
df['target_occ'] = df['occupancy_rate'].shift(-TARGET_HORIZON)
df_clean = df.dropna().reset_index(drop=True)
print(f"✅ Model-ready: {df_clean.shape}")
print(f"   Target = occupancy {TARGET_HORIZON*10} min ahead")


# %%
fig, axes = plt.subplots(2,2,figsize=(15,10))
hourly = df.groupby('hour')['occupancy_rate'].agg(['mean','std'])
axes[0,0].hist(df['occupancy_rate'],bins=50,color='#2E86AB',alpha=0.7,edgecolor='black')
axes[0,0].axvline(df['occupancy_rate'].mean(),color='red',ls='--',lw=2,label=f"Mean {df['occupancy_rate'].mean():.2%}")
axes[0,0].set_title('Occupancy Distribution',fontweight='bold'); axes[0,0].legend(); axes[0,0].grid(axis='y',alpha=0.3)
axes[0,1].plot(hourly.index,hourly['mean'],marker='o',color='#2E86AB',lw=2)
axes[0,1].fill_between(hourly.index,hourly['mean']-hourly['std'],hourly['mean']+hourly['std'],alpha=0.3,color='#2E86AB')
axes[0,1].set_title('Hourly Occupancy',fontweight='bold'); axes[0,1].grid(alpha=0.3)
wknd = df.groupby('is_weekend')['occupancy_rate'].mean()
axes[1,0].bar(['Weekday','Weekend'],wknd.values,color=['#2E86AB','#A23B72'],edgecolor='black')
axes[1,0].set_title('Weekday vs Weekend',fontweight='bold'); axes[1,0].grid(axis='y',alpha=0.3)
smp = df.iloc[:min(2000,len(df))]
axes[1,1].plot(smp['timestamp'],smp['occupancy_rate'],lw=1,color='#2E86AB',alpha=0.8)
axes[1,1].set_title('Occupancy Trend',fontweight='bold'); axes[1,1].grid(alpha=0.3)
axes[1,1].tick_params(axis='x',rotation=45)
plt.tight_layout(); plt.savefig(str(OUTPUT_DIR/'eda_overview.png'),dpi=100); plt.show()
print(f"✅ Peak hour: {hourly['mean'].idxmax():02d}:00 ({hourly['mean'].max():.2%})")


# %% [markdown]
# ## 5️⃣ Sequence Preparation

# %%
WINDOW_SIZE = 18  # 180 minutes context

FEATURE_COLS = [
    'occupancy_rate','hour_sin','hour_cos','dow_sin','dow_cos',
    'is_weekend','weather_encoded','is_morning_peak','is_evening_peak','is_rush_hour',
    'lag_1','lag_2','lag_3','lag_6','lag_12','lag_24',
    'roll_mean_3','roll_std_3','roll_mean_6','roll_std_6','roll_mean_12','roll_std_12',
    'momentum','acceleration','ema_01','ema_03'
]
FEATURE_COLS = [c for c in FEATURE_COLS if c in df_clean.columns]
N_FEATURES = len(FEATURE_COLS)

scaler_X = StandardScaler()
scaler_y = StandardScaler()

df_sc = df_clean.copy()
df_sc[FEATURE_COLS] = scaler_X.fit_transform(df_clean[FEATURE_COLS])
y_raw = df_clean['target_occ'].values.reshape(-1,1)
y_scaled = scaler_y.fit_transform(y_raw).flatten()

def create_sequences(data_feat, y_vals, window):
    X, y = [], []
    for i in range(len(data_feat)-window):
        X.append(data_feat[FEATURE_COLS].iloc[i:i+window].values)
        y.append(y_vals[i+window])
    return np.array(X,dtype=np.float32), np.array(y,dtype=np.float32)

X_seq, y_seq = create_sequences(df_sc, y_scaled, WINDOW_SIZE)
y_seq_raw = y_raw[WINDOW_SIZE:].flatten()  # unscaled for eval

n = len(X_seq)
train_end = int(0.70*n); val_end = int(0.85*n)
X_train,y_train         = X_seq[:train_end], y_seq[:train_end]
X_val,  y_val           = X_seq[train_end:val_end], y_seq[train_end:val_end]
X_test, y_test          = X_seq[val_end:], y_seq[val_end:]
y_test_raw              = y_seq_raw[val_end:]

print(f"✅ N_FEATURES={N_FEATURES}, WINDOW={WINDOW_SIZE}")
print(f"   Train {X_train.shape} | Val {X_val.shape} | Test {X_test.shape}")

# Persist scalers for API
import pickle
with open(str(OUTPUT_DIR/'scaler_X.pkl'),'wb') as f: pickle.dump(scaler_X, f)
with open(str(OUTPUT_DIR/'scaler_y.pkl'),'wb') as f: pickle.dump(scaler_y, f)
with open(str(OUTPUT_DIR/'feature_cols.pkl'),'wb') as f: pickle.dump(FEATURE_COLS, f)
print("✅ Scalers saved")


# %% [markdown]
# ## 6️⃣ Custom Components (Layer, Callback, Loss)

# %%
# ── Custom Layer ──────────────────────────────────────────────────────────────
class TemporalAttention(layers.Layer):
    """Custom Temporal Attention Layer"""
    def __init__(self, **kw): super().__init__(**kw); self.score = layers.Dense(1)
    def call(self, x):
        w = tf.nn.softmax(self.score(x), axis=1)
        return tf.reduce_sum(x * w, axis=1)
    def get_config(self): return super().get_config()

# ── Custom Loss ───────────────────────────────────────────────────────────────
def weighted_huber_loss(delta=0.3, high_w=2.0):
    def loss(y_true, y_pred):
        err = y_true - y_pred
        h = tf.where(tf.abs(err)<=delta, 0.5*tf.square(err), delta*(tf.abs(err)-0.5*delta))
        w = tf.where(y_true > 0.5, high_w, 1.0)
        return tf.reduce_mean(h * w)
    return loss

# ── Custom Callback ───────────────────────────────────────────────────────────
class SmartParkMonitor(callbacks.Callback):
    def __init__(self, target_mae=0.02):
        super().__init__()
        self.target_mae = target_mae
        self.best_mae   = float('inf')
    def on_epoch_end(self, epoch, logs=None):
        vm = logs.get('val_mae', float('inf'))
        if vm < self.best_mae:
            self.best_mae = vm
        if (epoch+1) % 10 == 0:
            flag = '✅' if vm <= self.target_mae else '⏳'
            print(f"  {flag} E{epoch+1:03d} | loss={logs.get('loss',0):.4f} | val_mae={vm:.4f} | best={self.best_mae:.4f}")

print("✅ TemporalAttention, SmartParkMonitor, weighted_huber_loss ready")


# %% [markdown]
# ## 7️⃣ Model Architectures

# %%
def build_clstan(shape):
    """CNN-LSTM-Attention Network (CLSTAN) — Best for spatial-temporal patterns"""
    inp = layers.Input(shape=shape, name='input')
    x   = layers.Conv1D(128, 3, padding='same', activation='relu')(inp)
    x   = layers.BatchNormalization()(x)
    x   = layers.Conv1D(64,  3, padding='same', activation='relu')(x)
    x   = layers.BatchNormalization()(x)
    x   = layers.Bidirectional(layers.GRU(128, return_sequences=True))(x)
    x   = layers.Dropout(0.25)(x)
    x   = layers.Bidirectional(layers.LSTM(64, return_sequences=True))(x)
    x   = layers.Dropout(0.2)(x)
    x   = TemporalAttention(name='attention')(x)
    x   = layers.Dense(128, activation='relu')(x)
    x   = layers.BatchNormalization()(x)
    x   = layers.Dropout(0.2)(x)
    x   = layers.Dense(64, activation='relu')(x)
    x   = layers.Dense(32, activation='relu')(x)
    out = layers.Dense(1, name='prediction')(x)
    return Model(inp, out, name='CLSTAN')

def build_bidir_gru_lstm(shape):
    """Bidirectional GRU-LSTM"""
    inp = layers.Input(shape=shape)
    x   = layers.Bidirectional(layers.GRU(256, return_sequences=True))(inp)
    x   = layers.Dropout(0.3)(x)
    x   = layers.Bidirectional(layers.LSTM(128, return_sequences=True))(x)
    x   = layers.Dropout(0.3)(x)
    x   = TemporalAttention(name='attention')(x)
    x   = layers.Dense(128, activation='relu')(x)
    x   = layers.BatchNormalization()(x)
    x   = layers.Dense(64, activation='relu')(x)
    out = layers.Dense(1, name='prediction')(x)
    return Model(inp, out, name='BiDir_GRU_LSTM')

def build_baseline(shape):
    inp = layers.Input(shape=shape)
    x   = layers.Flatten()(inp)
    x   = layers.Dense(256, activation='relu')(x)
    x   = layers.Dropout(0.3)(x)
    x   = layers.Dense(128, activation='relu')(x)
    out = layers.Dense(1)(x)
    return Model(inp, out, name='Baseline')

shape = (WINDOW_SIZE, N_FEATURES)
print(f"✅ All architectures defined | input shape: {shape}")


# %% [markdown]
# ## 8️⃣ TensorBoard Setup

# %%
%load_ext tensorboard
import datetime as dt

TB_ROOT = Path('/content/smartpark_logs/tensorboard')
TB_ROOT.mkdir(parents=True, exist_ok=True)

def make_tb_callback(name):
    log_dir = str(TB_ROOT / name / dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
    return callbacks.TensorBoard(
        log_dir=log_dir,
        histogram_freq=1,
        write_graph=True,
        write_images=False,
        update_freq='epoch',
        profile_batch=0
    )

print(f"✅ TensorBoard log root: {TB_ROOT}")


# %% [markdown]
# ## 9️⃣ Standard Training (with Callbacks)

# %%
EPOCHS = 150
BATCH  = 32

def get_callbacks(name, target_mae=0.02, use_lr_schedule=False):
    cbs = [
        callbacks.EarlyStopping(monitor='val_mae', patience=25, restore_best_weights=True, verbose=0),
        callbacks.ModelCheckpoint(str(OUTPUT_DIR/f'best_{name}.keras'), monitor='val_mae',
                                  save_best_only=True, mode='min', verbose=0),
        SmartParkMonitor(target_mae=target_mae),
        make_tb_callback(name),
    ]
    if not use_lr_schedule: # Only add ReduceLROnPlateau if not using a learning rate schedule
        cbs.insert(1, callbacks.ReduceLROnPlateau(monitor='val_mae', factor=0.5, patience=10, min_lr=1e-7, verbose=0))
    return cbs

lr_schedule = tf.keras.optimizers.schedules.CosineDecay(1e-3, decay_steps=5000, alpha=1e-6)

# ─ Baseline ─
print("="*60)
print("🚀 Training Baseline...")
baseline = build_baseline(shape)
baseline.compile(optimizer='adam', loss='mse', metrics=['mae'])
h_base = baseline.fit(X_train, y_train, validation_data=(X_val,y_val),
                      epochs=EPOCHS, batch_size=BATCH, callbacks=get_callbacks('baseline', use_lr_schedule=False), verbose=0)

# ─ CLSTAN ─
print("\n🚀 Training CLSTAN...")
model_b = build_clstan(shape)
model_b.compile(optimizer=keras.optimizers.Adam(lr_schedule),
                loss=weighted_huber_loss(), metrics=['mae'])
h_b = model_b.fit(X_train, y_train, validation_data=(X_val,y_val),
                  epochs=EPOCHS, batch_size=BATCH, callbacks=get_callbacks('clstan', use_lr_schedule=True), verbose=0)

# ─ BiDir ─
print("\n🚀 Training BiDir GRU-LSTM...")
model_a = build_bidir_gru_lstm(shape)
model_a.compile(optimizer=keras.optimizers.Adam(lr_schedule),
                loss=weighted_huber_loss(), metrics=['mae'])
h_a = model_a.fit(X_train, y_train, validation_data=(X_val,y_val),
                  epochs=EPOCHS, batch_size=BATCH, callbacks=get_callbacks('bidir_gru_lstm', use_lr_schedule=True), verbose=0)

print("\n✅ ALL MODELS TRAINED")
for nm, h in [('Baseline',h_base),('CLSTAN',h_b),('BiDir',h_a)]:
    print(f"   {nm}: best val_mae = {min(h.history['val_mae']):.5f}")

# %% [markdown]
# ## 🔟 Custom Training Loop via `tf.GradientTape`
# Implementasi training loop kustom dari awal tanpa menggunakan `.fit()`.
# 

# %%
# Build fresh CLSTAN for GradientTape training
model_tape = build_clstan(shape)
optimizer_tape  = keras.optimizers.Adam(1e-3)
loss_fn         = weighted_huber_loss()
mae_metric      = keras.metrics.MeanAbsoluteError()

# TensorBoard writer for custom loop
tape_log_dir = str(TB_ROOT / 'gradient_tape' / dt.datetime.now().strftime('%Y%m%d-%H%M%S'))
tape_writer  = tf.summary.create_file_writer(tape_log_dir)

@tf.function
def train_step(x_batch, y_batch):
    with tf.GradientTape() as tape:
        y_pred = model_tape(x_batch, training=True)
        loss   = loss_fn(tf.reshape(y_batch,(-1,1)), y_pred)
    grads = tape.gradient(loss, model_tape.trainable_variables)
    optimizer_tape.apply_gradients(zip(grads, model_tape.trainable_variables))
    mae_metric.update_state(y_batch, tf.squeeze(y_pred))
    return loss

@tf.function
def val_step(x_batch, y_batch):
    y_pred = model_tape(x_batch, training=False)
    return tf.reduce_mean(tf.abs(y_batch - tf.squeeze(y_pred)))

# ─ Dataset ─
BATCH_TAPE  = 32
EPOCHS_TAPE = 80
ds_train = tf.data.Dataset.from_tensor_slices((X_train, y_train)).shuffle(5000).batch(BATCH_TAPE)
ds_val   = tf.data.Dataset.from_tensor_slices((X_val,   y_val)).batch(BATCH_TAPE)

best_val_mae, patience_cnt = float('inf'), 0
PATIENCE_TAPE = 15
best_tape_weights = None
tape_history = {'loss':[], 'val_mae':[]}

print("🚀 Custom GradientTape Training Loop")
print("-"*55)
for epoch in range(EPOCHS_TAPE):
    mae_metric.reset_state()
    epoch_loss = []
    for xb, yb in ds_train:
        loss_val = train_step(xb, yb)
        epoch_loss.append(float(loss_val))
    train_mae = float(mae_metric.result())

    val_maes  = [float(val_step(xb, yb)) for xb, yb in ds_val]
    val_mae   = float(np.mean(val_maes))

    tape_history['loss'].append(np.mean(epoch_loss))
    tape_history['val_mae'].append(val_mae)

    # TensorBoard logging
    with tape_writer.as_default():
        tf.summary.scalar('loss',           np.mean(epoch_loss), step=epoch)
        tf.summary.scalar('train_mae',      train_mae,           step=epoch)
        tf.summary.scalar('val_mae',        val_mae,             step=epoch)
        tf.summary.scalar('target_mae_02',  0.02,                step=epoch)

    if val_mae < best_val_mae:
        best_val_mae   = val_mae
        best_tape_weights = [v.numpy().copy() for v in model_tape.trainable_variables]
        patience_cnt   = 0
    else:
        patience_cnt  += 1

    if (epoch+1) % 10 == 0:
        flag = '✅' if val_mae <= 0.02 else '⏳'
        print(f"  {flag} E{epoch+1:03d} | loss={np.mean(epoch_loss):.4f} | val_mae={val_mae:.4f} | best={best_val_mae:.4f}")

    if patience_cnt >= PATIENCE_TAPE:
        print(f"  Early stopping at epoch {epoch+1}")
        break

# Restore best weights
if best_tape_weights:
    for v, w in zip(model_tape.trainable_variables, best_tape_weights):
        v.assign(w)

print(f"\n✅ GradientTape best val_mae: {best_val_mae:.5f}")
model_tape.save(str(OUTPUT_DIR/'model_tape_clstan.keras'))


# %% [markdown]
# ## 1️⃣1️⃣ Evaluation & A/B Testing

# %%
# Load best saved models
custom_objs = {'TemporalAttention': TemporalAttention, 'loss': weighted_huber_loss()}
best_base = keras.models.load_model(str(OUTPUT_DIR/'best_baseline.keras'))
best_b    = keras.models.load_model(str(OUTPUT_DIR/'best_clstan.keras'),      custom_objects=custom_objs)
best_a    = keras.models.load_model(str(OUTPUT_DIR/'best_bidir_gru_lstm.keras'), custom_objects=custom_objs)

def predict_and_unscale(model, X):
    p = model.predict(X, verbose=0).flatten()
    return scaler_y.inverse_transform(p.reshape(-1,1)).flatten().clip(0,1)

yp_base  = predict_and_unscale(best_base,  X_test)
yp_b     = predict_and_unscale(best_b,     X_test)
yp_a     = predict_and_unscale(best_a,     X_test)
yp_tape  = predict_and_unscale(model_tape, X_test)

# Ensemble
yp_ens = 0.25*yp_base + 0.35*yp_b + 0.25*yp_a + 0.15*yp_tape
yp_ens = yp_ens.clip(0,1)

def compute_metrics(yt, yp, name):
    mae  = mean_absolute_error(yt, yp)
    rmse = np.sqrt(mean_squared_error(yt, yp))
    r2   = r2_score(yt, yp)
    mape = np.mean(np.abs((yt-yp)/(yt+1e-8)))*100
    acc  = np.mean(np.abs(yt-yp) <= 0.05)*100   # within 5% = correct
    return {'Model':name,'MAE':mae,'RMSE':rmse,'R²':r2,'MAPE%':mape,'Acc(±5%)%':acc}

results_df = pd.DataFrame([
    compute_metrics(y_test_raw, yp_base, 'Baseline'),
    compute_metrics(y_test_raw, yp_b,    'CLSTAN'),
    compute_metrics(y_test_raw, yp_a,    'BiDir GRU-LSTM'),
    compute_metrics(y_test_raw, yp_tape, 'GradTape CLSTAN'),
    compute_metrics(y_test_raw, yp_ens,  'Ensemble'),
])
print("📊 Evaluation Results:")
print(results_df.to_string(index=False))

best_row = results_df.sort_values('MAE').iloc[0]
print(f"\n🏆 Best Model : {best_row['Model']}")
print(f"   MAE        : {best_row['MAE']:.5f}  {'✅ TARGET MET' if best_row['MAE']<=0.02 else '⚠️ Gap: '+str(round(best_row['MAE']-0.02,5))}")
print(f"   Accuracy   : {best_row['Acc(±5%)%']:.2f}%  {'✅' if best_row['Acc(±5%)%']>=85 else '⚠️'}")
results_df.to_csv(str(OUTPUT_DIR/'evaluation_results.csv'), index=False)


# %% [markdown]
# ### Binary Classification (Occupied / Free)

# %%
def build_clstan_classifier(shape):
    inp = layers.Input(shape=shape)
    x   = layers.Conv1D(64,3,padding='same',activation='relu')(inp)
    x   = layers.BatchNormalization()(x)
    x   = layers.GRU(64, return_sequences=True)(x)
    x   = layers.Dropout(0.25)(x)
    x   = layers.LSTM(32, return_sequences=True)(x)
    x   = layers.Dropout(0.2)(x)
    x   = TemporalAttention(name='attn')(x)
    x   = layers.Dense(64, activation='relu')(x)
    out = layers.Dense(1, activation='sigmoid')(x)
    return Model(inp, out, name='CLSTAN_Classifier')

y_train_bin = (y_train > 0).astype(np.float32)
y_val_bin   = (y_val   > 0).astype(np.float32)
y_test_bin  = (y_test_raw > 0.3).astype(int)   # >30% = occupied

clf = build_clstan_classifier(shape)
clf.compile(optimizer=keras.optimizers.Adam(1e-3),
            loss='binary_crossentropy', metrics=['accuracy'])
clf.fit(X_train, y_train_bin, validation_data=(X_val, y_val_bin),
        epochs=60, batch_size=32,
        callbacks=[callbacks.EarlyStopping(patience=12, restore_best_weights=True),
                   make_tb_callback('classifier')],
        verbose=0)

y_pred_clf = (clf.predict(X_test, verbose=0).flatten() > 0.5).astype(int)
clf_acc = accuracy_score(y_test_bin, y_pred_clf)
print(f"✅ Classification Accuracy: {clf_acc:.2%}  {'✅ ≥85%' if clf_acc>=0.85 else '⚠️'}")
print(classification_report(y_test_bin, y_pred_clf, target_names=['Free','Occupied']))
clf.save(str(OUTPUT_DIR/'clstan_classifier.keras'))


# %% [markdown]
# ### Time-Series Cross-Validation

# %%
from sklearn.model_selection import TimeSeriesSplit
tscv = TimeSeriesSplit(n_splits=5)
X_cv = np.concatenate([X_train, X_val])
y_cv = np.concatenate([y_train, y_val])
cv_maes = []
for fold, (tri, tei) in enumerate(tscv.split(X_cv), 1):
    m = build_clstan(shape)
    m.compile(optimizer='adam', loss=weighted_huber_loss(), metrics=['mae'])
    m.fit(X_cv[tri], y_cv[tri], epochs=15, batch_size=32, verbose=0)
    sc = m.evaluate(X_cv[tei], y_cv[tei], verbose=0)
    cv_maes.append(sc[1])
    print(f"  Fold {fold} MAE: {sc[1]:.5f}")
print(f"  CV Mean MAE: {np.mean(cv_maes):.5f} ±{np.std(cv_maes):.5f}")


# %% [markdown]
# ## 1️⃣2️⃣ Confidence Score & Human-Readable Engine

# %%
def compute_confidence_score(pred_occ: float, recent_std: float, model_name: str = 'CLSTAN') -> dict:
    """Compute confidence and translate to human language for admin."""
    # Base confidence from variance (lower std → higher confidence)
    base_conf = max(0.5, 1.0 - min(recent_std * 5, 0.5))

    # Penalty for extreme predictions
    if pred_occ < 0.05 or pred_occ > 0.98: base_conf *= 0.85

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
    pct = round(pred_occ * 100, 1) # Calculate pct early

    # Edge Case: low confidence
    if not internet_ok:
        return {'urgency':'WARNING', 'actions':['Gunakan data manual, prediksi tidak ditampilkan'],
                'status_flag':'Koneksi tidak stabil — menggunakan estimasi',
                'human_summary':'Data tidak dapat diverifikasi karena koneksi bermasalah.',
                'predicted_pct': pct} # Added predicted_pct
    if conf_pct < 60:
        return {'urgency':'INFO', 'actions':['Periksa sensor parkir, data kurang akurat'],
                'status_flag':'Data sedang diproses — confidence rendah',
                'human_summary':f'Confidence {conf_pct}% — prediksi kurang dapat diandalkan. Validasi manual disarankan.',
                'predicted_pct': pct} # Added predicted_pct

    # Minutes to full (approx)
    if pred_occ >= 1.0 or occupancy_change_rate <= 0:
        mins_to_full = 0 if pred_occ >= 0.95 else None
    else:
        remaining = 1.0 - pred_occ
        mins_to_full = int(remaining / (occupancy_change_rate + 1e-9) * 10)

    # Decision rules
    if pred_occ >= 0.95:
        urgency = 'KRITIS'
        actions = ['Tutup gate masuk segera','Aktifkan petugas arahkan ke Parkir B','Kirim notifikasi ke pengendara']
        human_summary = f'★ Parkir HAMPIR PENUH ({pct}%). Ambil tindakan segera!'
    elif pred_occ >= 0.85 and conf_pct >= 80:
        urgency = 'TINGGI'
        actions = ['Siapkan petugas tambahan di pintu masuk','Aktifkan tanda peringatan kapasitas',
                   'Pertimbangkan kenaikan tarif 20% untuk kurangi arus masuk']
        human_summary = f'☆ Parkir mendekati penuh ({pct}%). Prediksi penuh dalam ~{mins_to_full} menit.'
    elif pred_occ >= 0.70:
        urgency = 'SEDANG'
        actions = ['Pantau arus masuk secara aktif','Persiapkan rencana pengalihan jika naik >85%']
        human_summary = f'★ Tingkat kunjungan tinggi ({pct}%). Waspadai peningkatan.'
    elif pred_occ <= 0.20:
        urgency = 'RENDAH'
        actions = ['Kurangi tarif 10% untuk menarik pengendara','Matikan sebagian lampu area kosong (hemat energi)']
        human_summary = f'★ Parkir sangat sepi ({pct}%). Pertimbangkan promo tarif.'
    else:
        urgency = 'NORMAL'
        actions = ['Tidak ada tindakan khusus diperlukan']
        human_summary = f'★ Kondisi normal ({pct}%). Operasional berjalan baik.'

    # Anomaly detection
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

# Demo
demo_pred = 0.87
demo_rec  = generate_action_recommendation(
    pred_occ=demo_pred, confidence={'confidence_pct':92},
    occupancy_change_rate=0.05, internet_ok=True)
print("📋 Demo Admin Recommendation Card:")
print(json.dumps(demo_rec, indent=2, ensure_ascii=False))

# %% [markdown]
# ## 1️⃣3️⃣ Generative AI Integration (Google Gemini)
# Menggunakan Gemini untuk menghasilkan saran aksi yang lebih kontekstual dan naratif untuk admin parkir.
# 

# %%
import google.generativeai as genai

# ─ Setup Gemini ──────────────────────────────────────────────────────────────
# CATATAN: Ganti dengan API key Anda dari https://aistudio.google.com/app/apikey
GEMINI_API_KEY = "aistudio.google.com"  # <--- GANTI INI

GEMINI_AVAILABLE = False
try:
    if GEMINI_API_KEY and GEMINI_API_KEY != "YOUR_GEMINI_API_KEY_HERE":
        genai.configure(api_key=GEMINI_API_KEY)
        gemini_model = genai.GenerativeModel('gemini-1.5-flash')
        GEMINI_AVAILABLE = True
        print("✅ Gemini API siap digunakan")
    else:
        print("⚠️  Gemini API key belum diset — akan menggunakan fallback rule-based")
except Exception as e:
    print(f"⚠️  Gemini error: {e} — menggunakan fallback")
    GEMINI_AVAILABLE = False # Ensure GEMINI_AVAILABLE is false on error

def generate_ai_narrative(pred_occ: float, rec: dict,
                           weather: str = 'SUNNY', hour: int = 10) -> str:
    """Hasilkan narasi admin menggunakan Gemini atau fallback."""
    predicted_pct_str = f"{rec.get('predicted_pct', 'N/A')}"

    if not GEMINI_AVAILABLE:
        # Fallback: rule-based narrative (bahasa Indonesia)
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
- Confidence model: {rec.get('confidence_human','N/A')}
- Saran sistem: {'; '.join(rec['actions'][:2])}

Narasi harus: praktis, mudah dipahami admin lapangan, tidak teknis, dan actionable."""

    try:
        resp = gemini_model.generate_content(prompt)
        return resp.text.strip()
    except Exception as e:
        return f"[Gemini error: {e}] {rec['human_summary']}"

# Demo
demo_narrative = generate_ai_narrative(0.87, demo_rec, weather='SUNNY', hour=14)
print("\n📝 AI Narrative for Admin:")
print(demo_narrative)

# %% [markdown]
# ## 1️⃣4️⃣ Full Inference Pipeline

# %%
def predict_and_advise(recent_df: pd.DataFrame,
                       model=None,
                       internet_ok: bool = True,
                       use_ensemble: bool = True) -> dict:
    """Complete prediction + recommendation pipeline for admin dashboard."""
    import time; t0 = time.time()

    # --- Data quality checks ---
    if recent_df is None or len(recent_df) < WINDOW_SIZE:
        return {'error': 'Insufficient data', 'status_flag': 'Data sedang diproses', 'urgency': 'WARNING'}

    # Check for anomalies (sensor error = sudden 0 occupancy after >0.5)
    last_occ = recent_df['occupancy_rate'].iloc[-1]
    prev_occ = recent_df['occupancy_rate'].iloc[-3:-1].mean()
    sensor_anomaly = (last_occ == 0 and prev_occ > 0.5)
    if sensor_anomaly:
        return {'error': 'Sensor anomaly detected', 'status_flag': 'Sensor error — data tidak valid',
                'urgency': 'WARNING', 'human_summary': '⚠️ Sensor mendeteksi nilai 0% setelah >50%. Kemungkinan sensor error.'}

    # --- Feature prep ---
    df_feat = recent_df.copy()
    weather_map = {'SUNNY':0,'OVERCAST':1,'RAINY':2,'UNKNOWN':0}
    for col in FEATURE_COLS:
        if col not in df_feat.columns:
            df_feat[col] = 0.0  # safe default for missing cols

    df_scaled_inf = df_feat.copy()
    df_scaled_inf[FEATURE_COLS] = scaler_X.transform(df_feat[FEATURE_COLS])
    seq = df_scaled_inf[FEATURE_COLS].iloc[-WINDOW_SIZE:].values.reshape(1, WINDOW_SIZE, N_FEATURES)

    # --- Prediction ---
    if use_ensemble:
        preds = []
        for m in [best_base, best_b, best_a, model_tape]:
            try:
                p = scaler_y.inverse_transform(m.predict(seq, verbose=0)).flatten()[0]
                preds.append(np.clip(p, 0, 1))
            except: pass
        pred_occ = float(np.mean(preds)) if preds else float(last_occ)
    else:
        m = model or best_b
        pred_occ = float(np.clip(scaler_y.inverse_transform(m.predict(seq,verbose=0)).flatten()[0], 0, 1))

    # --- Confidence ---
    recent_std = float(recent_df['occupancy_rate'].tail(12).std())
    confidence = compute_confidence_score(pred_occ, recent_std)

    # --- Rate of change ---
    occ_vals  = recent_df['occupancy_rate'].tail(6).values
    change_rt = float(np.polyfit(range(len(occ_vals)), occ_vals, 1)[0]) if len(occ_vals)>1 else 0.0

    # --- Recommendation ---
    rec = generate_action_recommendation(pred_occ, confidence, change_rt, internet_ok)

    # --- AI Narrative ---
    hr  = int(recent_df['hour'].iloc[-1]) if 'hour' in recent_df.columns else datetime.now().hour
    wx  = recent_df['weather'].iloc[-1]   if 'weather' in recent_df.columns else 'UNKNOWN'
    narrative = generate_ai_narrative(pred_occ, rec, weather=wx, hour=hr)

    return {
        'timestamp': datetime.now().isoformat(),
        'current_occupancy': round(float(last_occ), 4),
        'predicted_occupancy_30min': round(pred_occ, 4),
        'predicted_pct': f"{pred_occ*100:.1f}%",
        'confidence': confidence,
        'recommendation': rec,
        'ai_narrative': narrative,
        'change_rate_per_interval': round(change_rt, 4),
        'latency_ms': round((time.time()-t0)*1000, 1),
    }

# Test
sample_df = df_clean.tail(WINDOW_SIZE + 10).copy()
result = predict_and_advise(sample_df)
print("\n📍 SmartPark AI — Admin Intelligence Output:")
print(json.dumps({k:v for k,v in result.items() if k!='ai_narrative'}, indent=2, default=str))
print(f"\n📝 AI Narrative:\n{result['ai_narrative']}")


# %% [markdown]
# ## 1️⃣5️⃣ FastAPI REST API

# %%
%%writefile /content/smartpark_api.py
"""
SmartPark AI — FastAPI REST API
Endpoints:
  GET  /health          — Health check
  POST /predict         — Predict occupancy (accepts last N observations)
  GET  /dashboard       — Latest full recommendation (admin card)
  GET  /metrics         — Model performance metrics
  POST /feedback        — Log admin feedback on recommendation
"""

import os, json, pickle, datetime, re
import numpy as np
import pandas as pd
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
import uvicorn
import google.generativeai as genai

OUTPUT_DIR = Path('/content/smartpark_outputs')

# ─ Setup Gemini ──────────────────────────────────────────────────────────────
# CATATAN: Ganti dengan API key Anda dari https://aistudio.google.com/app/apikey
GEMINI_API_KEY = "aistudio.google.com" # "YOUR_GEMINI_API_KEY_HERE" # Keep this as placeholder to remind user

GEMINI_AVAILABLE = False
try:
    if GEMINI_API_KEY and GEMINI_API_KEY != "YOUR_GEMINI_API_KEY_HERE":
        genai.configure(api_key=GEMINI_API_KEY)
        gemini_model = genai.GenerativeModel('gemini-1.5-flash')
        GEMINI_AVAILABLE = True
        # print("✅ Gemini API siap digunakan") # Removed print for API stability
    # else:
        # print("⚠️  Gemini API key belum diset — akan menggunakan fallback rule-based")
except Exception as e:
    # print(f"⚠️  Gemini error: {e} — menggunakan fallback") # Removed print for API stability
    GEMINI_AVAILABLE = False # Ensure GEMINI_AVAILABLE is false on error

# ── Load artifacts ─────────────────────────────────────────────────────────
with open(str(OUTPUT_DIR/'scaler_X.pkl'),'rb') as f: scaler_X = pickle.load(f)
with open(str(OUTPUT_DIR/'scaler_y.pkl'),'rb') as f: scaler_y = pickle.load(f)
with open(str(OUTPUT_DIR/'feature_cols.pkl'),'rb') as f: FEATURE_COLS = pickle.load(f)
WINDOW_SIZE = 18
N_FEATURES  = len(FEATURE_COLS)

# Lazy-load TF to keep startup fast
_models = {}
def get_model(name='clstan'):
    import tensorflow as tf
    if name not in _models:
        p = OUTPUT_DIR / f'best_{name}.keras'
        if p.exists():
            _models[name] = tf.keras.models.load_model(str(p), compile=False)
    return _models.get(name)

# ── Custom Logic from Notebook ────────────────────────────────────────────────
def compute_confidence_score(pred_occ: float, recent_std: float, model_name: str = 'CLSTAN') -> dict:
    """Compute confidence and translate to human language for admin."""
    # Base confidence from variance (lower std → higher confidence)
    base_conf = max(0.5, 1.0 - min(recent_std * 5, 0.5))

    # Penalty for extreme predictions
    if pred_occ < 0.05 or pred_occ > 0.98: base_conf *= 0.85

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
    pct = round(pred_occ * 100, 1) # Calculate pct early

    # Edge Case: low confidence
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

    # Minutes to full (approx)
    mins_to_full = None
    if pred_occ < 1.0 and occupancy_change_rate > 0:
        remaining = 1.0 - pred_occ
        mins_to_full = int(remaining / (occupancy_change_rate + 1e-9) * 10)
    elif pred_occ >= 0.95:
        mins_to_full = 0

    # Decision rules
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

    # Anomaly detection
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
    """Hasilkan narasi admin menggunakan Gemini atau fallback."""
    predicted_pct_str = f"{rec.get('predicted_pct', 'N/A')}"

    if not GEMINI_AVAILABLE:
        # Fallback: rule-based narrative (bahasa Indonesia)
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
- Confidence model: {rec.get('confidence_human','N/A')}
- Saran sistem: {'; '.join(rec['actions'][:2])}

Narasi harus: praktis, mudah dipahami admin lapangan, tidak teknis, dan actionable."""

    try:
        resp = gemini_model.generate_content(prompt)
        return resp.text.strip()
    except Exception as e:
        return f"[Gemini error: {e}] {rec['human_summary']}"


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
    weather_map = {'SUNNY':0,'OVERCAST':1,'RAINY':2,'UNKNOWN':0}
    rows = []
    for o in obs_list:
        rows.append({
            'occupancy_rate':o.occupancy_rate,'hour':o.hour,
            'day_of_week':o.day_of_week,'is_weekend':o.is_weekend,
            'weather_encoded': weather_map.get(o.weather.upper(), 0),
            'hour_sin': np.sin(2*np.pi*o.hour/24),
            'hour_cos': np.cos(2*np.pi*o.hour/24),
            'dow_sin':  np.sin(2*np.pi*o.day_of_week/7),
            'dow_cos':  np.cos(2*np.pi*o.day_of_week/7),
        })
    df = pd.DataFrame(rows)
    # Fill extra features with rolling from occupancy_rate
    for lag in [1,2,3,6,12,24]:
        df[f'lag_{lag}'] = df['occupancy_rate'].shift(lag).fillna(df['occupancy_rate'].mean() if not df['occupancy_rate'].empty else 0.0)
    for w in [3,6,12,24,48]:
        df[f'roll_mean_{w}'] = df['occupancy_rate'].rolling(w,min_periods=1).mean()
        df[f'roll_std_{w}']  = df['occupancy_rate'].rolling(w,min_periods=1).std().fillna(0)
    df['momentum']     = df['occupancy_rate'].diff().fillna(0)
    df['acceleration'] = df['momentum'].diff().fillna(0)
    df['ema_01'] = df['occupancy_rate'].ewm(alpha=0.1).mean()
    df['ema_03'] = df['occupancy_rate'].ewm(alpha=0.3).mean()
    df['is_morning_peak'] = df['hour'].between(8,11).astype(int)
    df['is_evening_peak'] = df['hour'].between(16,19).astype(int)
    df['is_rush_hour']    = df['hour'].isin([7,8,9,16,17,18]).astype(int)
    # Ensure all FEATURE_COLS present
    for c in FEATURE_COLS:
        if c not in df.columns: df[c] = 0.0
    return df

@app.get("/health")
def health():
    return {"status":"ok","version":"2.0","timestamp":datetime.datetime.now().isoformat()}

@app.post("/predict")
def predict(req: PredictRequest):
    obs = req.observations
    if len(obs) < WINDOW_SIZE:
        raise HTTPException(400, f"Need ≥{WINDOW_SIZE} observations, got {len(obs)}")
    df = build_features(obs)

    # --- Feature prep ---
    df_scaled_inf = df.copy()
    df_scaled_inf[FEATURE_COLS] = scaler_X.transform(df[FEATURE_COLS])
    seq = df_scaled_inf[FEATURE_COLS].iloc[-WINDOW_SIZE:].values.reshape(1,WINDOW_SIZE,N_FEATURES)

    # --- Prediction ---
    pred_occ = 0.0
    if req.use_ensemble:
        preds = []
        # Dynamically load models. Note: model_tape not saved as 'best_model_tape.keras'
        # but as 'model_tape_clstan.keras' - ensure consistency or load it separately.
        # For now, just using best_clstan, best_bidir_gru_lstm, best_baseline for ensemble if they are available
        model_names_for_ensemble = ['clstan', 'bidir_gru_lstm', 'baseline'] # Assume these are models saved with 'best_' prefix
        loaded_models = []
        for nm in model_names_for_ensemble:
            m = get_model(nm)
            if m: loaded_models.append(m)

        if loaded_models:
            # Need to get actual models to predict. get_model is lazy, so predict will call TF load
            individual_preds = []
            for m in loaded_models:
                try:
                    p = scaler_y.inverse_transform(m.predict(seq, verbose=0)).flatten()[0]
                    individual_preds.append(np.clip(p, 0, 1))
                except Exception as e:
                    print(f"Error predicting with model {m.name}: {e}")
            if individual_preds:
                # Placeholder weights for ensemble, adjust if specific weights are determined
                weights = np.ones(len(individual_preds)) / len(individual_preds)
                pred_occ = float(np.average(individual_preds, weights=weights))
            else:
                pred_occ = float(obs[-1].occupancy_rate)
        else:
            # Fallback if no models loaded for ensemble
            pred_occ = float(obs[-1].occupancy_rate)
    else:
        # Default to CLSTAN if not using ensemble or specific model isn't requested
        m = get_model('clstan')
        if m:
            pred_occ = float(np.clip(scaler_y.inverse_transform(m.predict(seq,verbose=0)).flatten()[0], 0, 1))
        else:
            pred_occ = float(obs[-1].occupancy_rate)

    # --- Confidence ---
    recent_df_for_std = pd.DataFrame([o.dict() for o in obs])
    recent_std = float(recent_df_for_std['occupancy_rate'].tail(12).std())
    confidence = compute_confidence_score(pred_occ, recent_std)

    # --- Rate of change ---
    occ_vals  = [o.occupancy_rate for o in obs[-6:]]
    change_rt = float(np.polyfit(range(len(occ_vals)),occ_vals,1)[0]) if len(occ_vals)>1 else 0.0

    # --- Recommendation ---
    rec = generate_action_recommendation(pred_occ, confidence, change_rt, req.internet_ok)

    # --- AI Narrative ---
    hr = obs[-1].hour if obs else datetime.datetime.now().hour
    wx = obs[-1].weather if obs else 'UNKNOWN'
    narrative = generate_ai_narrative(pred_occ, rec, weather=wx, hour=hr)

    pid = f"pred_{datetime.datetime.now().strftime('%Y%m%d%H%M%S%f')}"
    result = {
        'prediction_id': pid,
        'timestamp': datetime.datetime.now().isoformat(),
        'current_occupancy': round(obs[-1].occupancy_rate, 4),
        'predicted_occupancy_30min': round(pred_occ, 4),
        'predicted_pct': f"{pred_occ*100:.1f}%",
        'confidence': confidence,
        'recommendation': rec,
        'ai_narrative': narrative, # Include AI narrative
        'change_rate_per_interval': round(change_rt, 4),
    }
    prediction_cache[pid] = result
    return result

@app.get("/dashboard")
def dashboard():
    if not prediction_cache:
        return {"message":"No predictions yet. POST to /predict first.", "status_flag": "No data", "urgency": "INFO", "human_summary": "No prediction data available. Please make a POST request to /predict first.", "actions": [], "confidence_human": "N/A", "predicted_pct": "N/A"}
    latest_key = sorted(prediction_cache.keys())[-1]
    return prediction_cache[latest_key]

@app.get("/metrics")
def model_metrics():
    metrics_path = OUTPUT_DIR / 'evaluation_results.csv'
    if metrics_path.exists():
        df = pd.read_csv(str(metrics_path))
        return {"metrics": df.to_dict(orient='records')}
    return {"message": "Run evaluation cell first"}

@app.post("/feedback")
def feedback(req: FeedbackRequest):
    entry = req.dict()
    entry['logged_at'] = datetime.datetime.now().isoformat()
    feedback_log.append(entry)
    return {"status":"logged","total_feedback": len(feedback_log)}

@app.get("/logs")
def get_logs():
    return {"total": len(feedback_log), "entries": feedback_log[-10:]}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)


# %%
import nest_asyncio, uvicorn, threading, time, requests
nest_asyncio.apply()

def run_api():
    import subprocess
    # Use 'python -m uvicorn' to ensure FastAPI app is loaded correctly
    # and disable reload in production-like environments
    subprocess.Popen(['python', '-m', 'uvicorn', 'smartpark_api:app', '--host', '0.0.0.0', '--port', '8000', '--log-level', 'warning'])

print("🚀 Starting SmartPark FastAPI server...")
t = threading.Thread(target=run_api, daemon=True)
t.start()

# Implement a retry mechanism to wait for the API to be ready
MAX_RETRIES = 30 # Increased retries
RETRY_DELAY_SEC = 2
API_READY = False
for i in range(MAX_RETRIES):
    try:
        r = requests.get('http://localhost:8000/health', timeout=1)
        if r.status_code == 200 and r.json().get('status') == 'ok':
            print("✅ API Health:", r.json())
            API_READY = True
            break
    except requests.exceptions.ConnectionError:
        print(f"   ⏳ Attempt {i+1}/{MAX_RETRIES}: API not yet ready, retrying in {RETRY_DELAY_SEC}s...")
        time.sleep(RETRY_DELAY_SEC)
    except Exception as e:
        print(f"   ⚠️ Attempt {i+1}/{MAX_RETRIES}: Error during health check: {e}")
        time.sleep(RETRY_DELAY_SEC)

if not API_READY:
    print(f"❌ API did not become ready after {MAX_RETRIES * RETRY_DELAY_SEC} seconds.")
else:
    print("🎉 FastAPI server is running!")

# %%
import requests, json

BASE = "http://localhost:8000"

# Build test payload from real data
obs_list = []
for _, row in df_clean.tail(WINDOW_SIZE + 5).iterrows():
    obs_list.append({
        "occupancy_rate": float(row['occupancy_rate']),
        "hour": int(row['hour']),
        "day_of_week": int(row['day_of_week']),
        "is_weekend": int(row['is_weekend']),
        "weather": str(row.get('weather','SUNNY'))
    })

payload = {"observations": obs_list[-WINDOW_SIZE:], "internet_ok": True, "use_ensemble": True}

print("📡 Testing POST /predict ...")
try:
    r = requests.post(f"{BASE}/predict", json=payload, timeout=30)
    print(f"Status: {r.status_code}")
    if r.status_code == 200:
        res = r.json()
        print(json.dumps(res, indent=2, ensure_ascii=False))
except Exception as e:
    print(f"Error: {e}")

print("\n📡 Testing GET /metrics ...")
try:
    r2 = requests.get(f"{BASE}/metrics", timeout=10)
    print(json.dumps(r2.json(), indent=2))
except Exception as e:
    print(f"Error: {e}")


# %%
# ─ Optional: expose API via ngrok ─
# !pip install pyngrok -q
# from pyngrok import ngrok
# NGROK_TOKEN = "YOUR_NGROK_TOKEN"  # get free at https://ngrok.com
# ngrok.set_auth_token(NGROK_TOKEN)
# public_url = ngrok.connect(8000)
# print(f"✅ Public API URL: {public_url}")
# print(f"   Swagger UI   : {public_url}/docs")
print("💡 Uncomment above cells to expose API publicly via ngrok")
print("   API is running at: http://localhost:8000")
print("   Swagger UI       : http://localhost:8000/docs")


# %% [markdown]
# ## 1️⃣6️⃣ TensorBoard Visualization

# %%
%tensorboard --logdir /content/smartpark_logs/tensorboard --port 6006


# %% [markdown]
# ## 1️⃣7️⃣ Training Curves & Final Plots

# %%
fig, axes = plt.subplots(2, 3, figsize=(18, 10))
pairs = [('Baseline', h_base), ('CLSTAN', h_b), ('BiDir GRU-LSTM', h_a)]
for idx, (nm, h) in enumerate(pairs):
    axes[0,idx].plot(h.history['loss'],    lw=2, label='Train')
    axes[0,idx].plot(h.history['val_loss'],lw=2, label='Val')
    axes[0,idx].set_title(f'{nm} — Loss', fontweight='bold')
    axes[0,idx].legend(); axes[0,idx].grid(alpha=0.3)

    axes[1,idx].plot(h.history['mae'],     lw=2, label='Train MAE')
    axes[1,idx].plot(h.history['val_mae'], lw=2, label='Val MAE')
    axes[1,idx].axhline(0.02, color='red', ls='--', label='Target 0.02', alpha=0.7)
    axes[1,idx].set_title(f'{nm} — MAE', fontweight='bold')
    axes[1,idx].legend(); axes[1,idx].grid(alpha=0.3)

plt.tight_layout()
plt.savefig(str(OUTPUT_DIR/'training_curves.png'), dpi=100)
plt.show()

# GradientTape curve
fig2, ax = plt.subplots(1,2,figsize=(12,4))
ax[0].plot(tape_history['loss'], lw=2, color='#2E86AB'); ax[0].set_title('GradTape — Loss'); ax[0].grid(alpha=0.3)
ax[1].plot(tape_history['val_mae'], lw=2, color='#A23B72'); ax[1].axhline(0.02,color='red',ls='--',label='Target 0.02')
ax[1].set_title('GradTape — Val MAE'); ax[1].legend(); ax[1].grid(alpha=0.3)
plt.tight_layout()
plt.savefig(str(OUTPUT_DIR/'gradtape_curves.png'), dpi=100)
plt.show()


# %%
n_plot = min(300, len(y_test_raw))
fig, axes = plt.subplots(2, 2, figsize=(16, 10))
preds_plot = [('Baseline',yp_base),('CLSTAN',yp_b),('BiDir',yp_a),('Ensemble',yp_ens)]
for i, (nm, yp) in enumerate(preds_plot):
    ax = axes[i//2][i%2]
    ax.plot(y_test_raw[:n_plot], label='Actual', lw=2, color='black')
    ax.plot(yp[:n_plot], label=nm, lw=1.5, alpha=0.8)
    ax.axhline(0.02, color='green', ls=':', alpha=0.5, label='MAE Target')
    mae = mean_absolute_error(y_test_raw, yp)
    ax.set_title(f'{nm} | MAE={mae:.5f}', fontweight='bold')
    ax.legend(); ax.grid(alpha=0.3)
plt.tight_layout()
plt.savefig(str(OUTPUT_DIR/'prediction_plots.png'), dpi=100)
plt.show()


# %% [markdown]
# ## 1️⃣8️⃣ Model Export & Summary

# %%
# Export best model (ensemble not exportable — save CLSTAN + BiDir)
best_b.export(str(OUTPUT_DIR/'saved_model_clstan'))
best_a.export(str(OUTPUT_DIR/'saved_model_bidir'))
clf.save(str(OUTPUT_DIR/'clstan_classifier.keras'))
print("✅ Models exported")

# Summary
best_row = results_df.sort_values('MAE').iloc[0]
print("\n" + "="*65)
print("  🚗 SmartPark AI — Project Summary")
print("="*65)
print(f"  Dataset       : CNRPark+EXT (http://cnrpark.it)")
print(f"  Task          : Occupancy prediction 30 min ahead")
print(f"  Best model    : {best_row['Model']}")
print(f"  MAE           : {best_row['MAE']:.5f}  {'✅ ≤0.02' if best_row['MAE']<=0.02 else '⚠️ Gap: '+str(round(best_row['MAE']-0.02,5))}")
print(f"  Accuracy ±5%  : {best_row['Acc(±5%)%']:.2f}%  {'✅ ≥85%' if best_row['Acc(±5%)%']>=85 else '⚠️'}")
print(f"  R²            : {best_row['R²']:.4f}")

print("\n  ✅ CHECKLIST:")
items = [
    "Data Wrangling: Gathering / Assessing / Cleaning",
    "EDA + Visualizations",
    "Feature Engineering (26+ features)",
    "Baseline + CLSTAN + BiDir GRU-LSTM",
    "Custom Layer: TemporalAttention",
    "Custom Callback: SmartParkMonitor",
    "Custom Loss: weighted_huber_loss",
    "Custom Training Loop: tf.GradientTape (+ TensorBoard)",
    "TensorBoard: Training metrics + histogram",
    "Time-Series Cross-Validation (5-fold)",
    "Binary Classification (Occupied/Free)",
    "Ensemble Model",
    "Confidence Score Engine",
    "Human-Readable Admin Recommendations",
    "AI Narrative via Google Gemini",
    "Edge Case Handling (sensor error, low confidence)",
    "FastAPI REST API (mandiri)",
    "Model Export (.keras + SavedModel)",
]
for it in items:
    print(f"   ✅ {it}")
print("="*65)



