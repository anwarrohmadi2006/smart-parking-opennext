import os
import re
import json
import warnings
import gc
import pickle
import datetime
import io
import numpy as np
import pandas as pd
from pathlib import Path

# Modal definition
import modal

app = modal.App("smartpark-training")

# Define the container image with GPU support, necessary python packages,
# and add the local dataset directly into the image (Modal 1.0+ standard)
# We pin numpy<2.0 to ensure compatibility with TensorFlow 2.15.0.
tf_image = (
    modal.Image.from_registry("tensorflow/tensorflow:2.15.0-gpu")
    .pip_install("numpy<2.0", "scikit-learn", "pandas", "wandb", "scipy")
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/CNRParkEXT (1).csv",
        remote_path="/root/CNRParkEXT (1).csv"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/modal_train.py",
        remote_path="/root/modal_train.py"
    )
)

@app.function(
    image=tf_image,
    gpu="T4",
    secrets=[modal.Secret.from_dict({
        "WANDB_API_KEY": "YOUR_WANDB_API_KEY_HERE",
        "TF_ENABLE_ONEDNN_OPTS": "0"
    })],
    timeout=7200  # 2 hours timeout
)
def run_experiments():
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers, Model, callbacks
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    import wandb
    
    print("Checking GPUs available:")
    gpus = tf.config.list_physical_devices('GPU')
    print("Num GPUs Available:", len(gpus))
    if len(gpus) > 0:
        print("Device name:", gpus[0])
    
    # ── 1. Read & Process CSV ────────────────────────────────────────────────
    csv_path = "/root/CNRParkEXT (1).csv"
    print(f"Reading CSV from: {csv_path}")
    df = pd.read_csv(csv_path, low_memory=False)
    print("Original CSV shape:", df.shape)
    
    def parse_dt(val):
        if not isinstance(val, str):
            return pd.NaT
        m = re.match(r'(\d{4}-\d{2}-\d{2})_(\d{2})[\.:](\d{2})', val)
        if m:
            try: return pd.to_datetime(f"{m.group(1)} {m.group(2)} {m.group(3)}", format='%Y-%m-%d %H %M')
            except: pass
        m2 = re.match(r'(\d{8})_(\d{2})(\d{2})', val)
        if m2:
            try: return pd.to_datetime(f"{m2.group(1)} {m2.group(2)} {m2.group(3)}", format='%Y%m%d %H %M')
            except: pass
        return pd.to_datetime(val, errors='coerce')

    print("Parsing datetimes...")
    df['timestamp'] = df['datetime'].apply(parse_dt)
    
    df['weather'] = df['weather'].map({'S': 'SUNNY', 'C': 'OVERCAST', 'R': 'RAINY'}).fillna('UNKNOWN')

    # Aggregate records to occupancy rate
    print("Aggregating records to time-series...")
    df_ts = (
        df.dropna(subset=['timestamp'])
        .groupby('timestamp')
        .agg(
            occupied_slots=('occupancy', 'sum'),
            total_patches=('occupancy', 'count'),
            weather=('weather', lambda x: x.mode().iloc[0] if not x.mode().empty else 'UNKNOWN')
        ).reset_index()
    )
    df_ts['occupancy_rate'] = (df_ts['occupied_slots'] / df_ts['total_patches']).clip(0, 1)
    df_ts = df_ts.set_index('timestamp')

    # Resample to 10-minute intervals
    df_uni = df_ts.resample('10min').agg({
        'weather': lambda x: x.mode().iloc[0] if len(x.dropna()) else np.nan,
        'occupancy_rate': 'mean'
    }).reset_index()

    # Interpolate occupancy and weather (fixing original dataset nan bugs)
    df_uni['occupancy_rate'] = df_uni['occupancy_rate'].interpolate(limit_direction='both').clip(0, 1)
    df_uni['weather']        = df_uni['weather'].ffill().bfill().fillna('UNKNOWN')
    df_uni['hour']           = df_uni['timestamp'].dt.hour
    df_uni['day_of_week']    = df_uni['timestamp'].dt.dayofweek
    df_uni['is_weekend']     = (df_uni['day_of_week'] >= 5).astype(int)
    df_uni['month']          = df_uni['timestamp'].dt.month

    # Feature Engineering (26 features)
    weather_map = {'SUNNY': 0, 'OVERCAST': 1, 'RAINY': 2, 'UNKNOWN': 0}
    df_uni['weather_encoded'] = df_uni['weather'].map(weather_map).fillna(0).astype(int)
    df_uni['hour_sin'] = np.sin(2 * np.pi * df_uni['hour'] / 24)
    df_uni['hour_cos'] = np.cos(2 * np.pi * df_uni['hour'] / 24)
    df_uni['dow_sin']  = np.sin(2 * np.pi * df_uni['day_of_week'] / 7)
    df_uni['dow_cos']  = np.cos(2 * np.pi * df_uni['day_of_week'] / 7)
    df_uni['is_morning_peak'] = df_uni['hour'].between(8, 11).astype(int)
    df_uni['is_evening_peak'] = df_uni['hour'].between(16, 19).astype(int)
    df_uni['is_rush_hour']    = df_uni['hour'].isin([7, 8, 9, 16, 17, 18]).astype(int)
    
    for lag in [1, 2, 3, 6, 12, 24, 48]:
        df_uni[f'lag_{lag}'] = df_uni['occupancy_rate'].shift(lag)
    for w in [3, 6, 12, 24, 48]:
        df_uni[f'roll_mean_{w}'] = df_uni['occupancy_rate'].rolling(w, min_periods=1).mean()
        df_uni[f'roll_std_{w}']  = df_uni['occupancy_rate'].rolling(w, min_periods=1).std().fillna(0)
    
    df_uni['momentum']     = df_uni['occupancy_rate'].diff().fillna(0)
    df_uni['acceleration'] = df_uni['momentum'].diff().fillna(0)
    df_uni['ema_01'] = df_uni['occupancy_rate'].ewm(alpha=0.1).mean()
    df_uni['ema_03'] = df_uni['occupancy_rate'].ewm(alpha=0.3).mean()
    
    TARGET_HORIZON = 3
    df_uni['target_occ'] = df_uni['occupancy_rate'].shift(-TARGET_HORIZON)
    
    # Drop rows containing NaNs in our required fields (avoiding dropping entire 97% of valid data!)
    FEATURE_COLS = [
        'occupancy_rate', 'hour_sin', 'hour_cos', 'dow_sin', 'dow_cos',
        'is_weekend', 'weather_encoded', 'is_morning_peak', 'is_evening_peak', 'is_rush_hour',
        'lag_1', 'lag_2', 'lag_3', 'lag_6', 'lag_12', 'lag_24', 'lag_48',
        'roll_mean_3', 'roll_std_3', 'roll_mean_6', 'roll_std_6', 'roll_mean_12', 'roll_std_12',
        'momentum', 'acceleration', 'ema_01', 'ema_03'
    ]
    
    df_clean = df_uni.dropna(subset=FEATURE_COLS + ['target_occ']).reset_index(drop=True)
    print(f"Cleaned time-series shape: {df_clean.shape}")
    N_FEATURES = len(FEATURE_COLS)
    WINDOW_SIZE = 18

    # Scaling
    scaler_X = StandardScaler()
    scaler_y = StandardScaler()
    
    df_sc = df_clean.copy()
    df_sc[FEATURE_COLS] = scaler_X.fit_transform(df_clean[FEATURE_COLS])
    y_raw = df_clean['target_occ'].values.reshape(-1, 1)
    y_scaled = scaler_y.fit_transform(y_raw).flatten()

    # Save scalers locally in container for uploading to Wandb
    scaler_X_path = "/tmp/scaler_X.pkl"
    scaler_y_path = "/tmp/scaler_y.pkl"
    features_path = "/tmp/feature_cols.pkl"
    with open(scaler_X_path, "wb") as f:
        pickle.dump(scaler_X, f)
    with open(scaler_y_path, "wb") as f:
        pickle.dump(scaler_y, f)
    with open(features_path, "wb") as f:
        pickle.dump(FEATURE_COLS, f)

    # Sequence Creation
    def create_sequences(data_feat, y_vals, window):
        X, y = [], []
        for i in range(len(data_feat) - window):
            X.append(data_feat[FEATURE_COLS].iloc[i:i+window].values)
            y.append(y_vals[i+window])
        return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)

    X_seq, y_seq = create_sequences(df_sc, y_scaled, WINDOW_SIZE)
    y_seq_raw = y_raw[WINDOW_SIZE:].flatten()

    # Splitting data
    n = len(X_seq)
    train_end = int(0.70 * n)
    val_end = int(0.85 * n)
    
    X_train, y_train = X_seq[:train_end], y_seq[:train_end]
    X_val, y_val     = X_seq[train_end:val_end], y_seq[train_end:val_end]
    X_test, y_test   = X_seq[val_end:], y_seq[val_end:]
    y_test_raw       = y_seq_raw[val_end:]
    
    print(f"Train: {X_train.shape} | Val: {X_val.shape} | Test: {X_test.shape}")

    # ── 2. Custom Neural Network Layers ──────────────────────────────────────
    class TemporalAttention(layers.Layer):
        def __init__(self, **kw): 
            super().__init__(**kw)
            self.score = layers.Dense(1)
        def call(self, x):
            w = tf.nn.softmax(self.score(x), axis=1)
            return tf.reduce_sum(x * w, axis=1)
        def get_config(self): 
            return super().get_config()

    def weighted_huber_loss(delta=0.3, high_w=2.0):
        def loss(y_true, y_pred):
            err = y_true - y_pred
            h = tf.where(tf.abs(err) <= delta, 0.5 * tf.square(err), delta * (tf.abs(err) - 0.5 * delta))
            w = tf.where(y_true > 0.5, high_w, 1.0)
            return tf.reduce_mean(h * w)
        return loss

    class SmartParkMonitor(callbacks.Callback):
        def __init__(self, target_mae=0.02, run_name=""):
            super().__init__()
            self.target_mae = target_mae
            self.best_mae = float('inf')
            self.run_name = run_name
        def on_epoch_end(self, epoch, logs=None):
            logs = logs or {}
            vm = logs.get('val_mae', logs.get('val_mean_absolute_error', float('inf')))
            if vm < self.best_mae:
                self.best_mae = vm
            # Log epoch metrics to W&B
            wandb.log({
                "epoch": epoch + 1,
                "loss": logs.get('loss', 0.0),
                "val_loss": logs.get('val_loss', 0.0),
                "mae": logs.get('mae', logs.get('mean_absolute_error', 0.0)),
                "val_mae": vm,
                "best_val_mae": self.best_mae
            })

    # W&B Login & Setup
    WANDB_PROJECT = "Final"
    WANDB_ENTITY = "anwarrohmadi111-universitas-islam-negeri-raden-mas-said-"
    
    # Store test predictions to perform Run 10 Ensemble
    test_preds_dict = {}
    validation_maes = {}
    saved_models = {}

    def run_experiment(run_num, config_name, model_fn, loss_fn, lr=1e-3, epochs=25, batch_size=32, scheduler=None):
        print(f"\n--- 🚀 Running Experiment {run_num}: {config_name} ---")
        
        # Initialize Wandb Run
        run = wandb.init(
            project=WANDB_PROJECT,
            entity=WANDB_ENTITY,
            name=f"Run_{run_num}_{config_name}",
            config={
                "experiment_id": run_num,
                "model_name": config_name,
                "learning_rate": lr,
                "epochs": epochs,
                "batch_size": batch_size,
                "optimizer": "adam"
            },
            reinit=True
        )
        
        # Build Model
        model = model_fn()
        opt = keras.optimizers.Adam(learning_rate=scheduler if scheduler is not None else lr)
        model.compile(optimizer=opt, loss=loss_fn, metrics=['mae'])
        
        # Callbacks
        cbs = [
            callbacks.EarlyStopping(monitor='val_mae', patience=15, restore_best_weights=True, verbose=0),
            SmartParkMonitor(target_mae=0.02, run_name=config_name)
        ]
        
        # Fit
        history = model.fit(
            X_train, y_train,
            validation_data=(X_val, y_val),
            epochs=epochs,
            batch_size=batch_size,
            callbacks=cbs,
            verbose=0
        )
        
        # Evaluate on Test Set
        test_pred_scaled = model.predict(X_test, verbose=0).flatten()
        test_pred = scaler_y.inverse_transform(test_pred_scaled.reshape(-1, 1)).flatten().clip(0, 1)
        test_preds_dict[config_name] = test_pred
        
        mae = mean_absolute_error(y_test_raw, test_pred)
        rmse = np.sqrt(mean_squared_error(y_test_raw, test_pred))
        r2 = r2_score(y_test_raw, test_pred)
        acc = np.mean(np.abs(y_test_raw - test_pred) <= 0.05) * 100
        
        # Get validation score (best reconstructed during training)
        val_mae_history = history.history.get('val_mae', history.history.get('val_mean_absolute_error', []))
        best_val = min(val_mae_history) if len(val_mae_history) > 0 else float('inf')
        validation_maes[config_name] = best_val
        
        print(f"   Validation MAE : {best_val:.5f}")
        print(f"   Test MAE       : {mae:.5f}")
        print(f"   Test Accuracy  : {acc:.2f}%")
        
        # Log final metrics to W&B
        wandb.log({
            "test_mae": mae,
            "test_rmse": rmse,
            "test_r2": r2,
            "test_accuracy_5pct": acc,
            "best_val_mae_final": best_val
        })
        
        # Save model locally in container
        model_save_path = f"/tmp/{config_name}.keras"
        model.save(model_save_path)
        saved_models[config_name] = model_save_path
        
        # Log model & scalers & running script artifacts to W&B
        artifact = wandb.Artifact(name=f"model-{config_name}", type="model")
        artifact.add_file(model_save_path, name=f"{config_name}.keras")
        artifact.add_file(scaler_X_path, name="scaler_X.pkl")
        artifact.add_file(scaler_y_path, name="scaler_y.pkl")
        artifact.add_file(features_path, name="feature_cols.pkl")
        if os.path.exists("/root/modal_train.py"):
            artifact.add_file("/root/modal_train.py", name="modal_train.py")
        run.log_artifact(artifact)
        
        run.finish()

    # ── 3. Define Architectures ──────────────────────────────────────────────
    shape = (WINDOW_SIZE, N_FEATURES)
    
    def get_baseline():
        inp = layers.Input(shape=shape)
        x   = layers.Flatten()(inp)
        x   = layers.Dense(256, activation='relu')(x)
        x   = layers.Dropout(0.3)(x)
        x   = layers.Dense(128, activation='relu')(x)
        out = layers.Dense(1)(x)
        return Model(inp, out, name='Baseline')

    def get_clstan_orig():
        inp = layers.Input(shape=shape)
        x   = layers.Conv1D(128, 3, padding='same', activation='relu')(inp)
        x   = layers.BatchNormalization()(x)
        x   = layers.Conv1D(64,  3, padding='same', activation='relu')(x)
        x   = layers.BatchNormalization()(x)
        x   = layers.Bidirectional(layers.GRU(128, return_sequences=True))(x)
        x   = layers.Dropout(0.25)(x)
        x   = layers.Bidirectional(layers.LSTM(64, return_sequences=True))(x)
        x   = layers.Dropout(0.2)(x)
        x   = TemporalAttention()(x)
        x   = layers.Dense(128, activation='relu')(x)
        x   = layers.BatchNormalization()(x)
        x   = layers.Dropout(0.2)(x)
        x   = layers.Dense(64, activation='relu')(x)
        x   = layers.Dense(32, activation='relu')(x)
        out = layers.Dense(1)(x)
        return Model(inp, out, name='CLSTAN_Original')

    def get_bidir_orig():
        inp = layers.Input(shape=shape)
        x   = layers.Bidirectional(layers.GRU(256, return_sequences=True))(inp)
        x   = layers.Dropout(0.3)(x)
        x   = layers.Bidirectional(layers.LSTM(128, return_sequences=True))(x)
        x   = layers.Dropout(0.3)(x)
        x   = TemporalAttention()(x)
        x   = layers.Dense(128, activation='relu')(x)
        x   = layers.BatchNormalization()(x)
        x   = layers.Dense(64, activation='relu')(x)
        out = layers.Dense(1)(x)
        return Model(inp, out, name='BiDir_Original')

    def get_clstan_tuned_dropout():
        # Tuned dropout and layer normalization instead of batch normalization
        inp = layers.Input(shape=shape)
        x   = layers.Conv1D(128, 3, padding='same', activation='relu')(inp)
        x   = layers.LayerNormalization()(x)
        x   = layers.Conv1D(64,  3, padding='same', activation='relu')(x)
        x   = layers.LayerNormalization()(x)
        x   = layers.Bidirectional(layers.GRU(128, return_sequences=True))(x)
        x   = layers.Dropout(0.15)(x)
        x   = layers.Bidirectional(layers.LSTM(64, return_sequences=True))(x)
        x   = layers.Dropout(0.15)(x)
        x   = TemporalAttention()(x)
        x   = layers.Dense(128, activation='relu')(x)
        x   = layers.LayerNormalization()(x)
        x   = layers.Dropout(0.15)(x)
        x   = layers.Dense(64, activation='relu')(x)
        out = layers.Dense(1)(x)
        return Model(inp, out, name='CLSTAN_Tuned_Dropout')

    def get_bidir_tuned():
        inp = layers.Input(shape=shape)
        x   = layers.Bidirectional(layers.GRU(128, return_sequences=True))(inp)
        x   = layers.LayerNormalization()(x)
        x   = layers.Bidirectional(layers.LSTM(64, return_sequences=True))(x)
        x   = layers.Dropout(0.2)(x)
        x   = TemporalAttention()(x)
        x   = layers.Dense(64, activation='relu')(x)
        out = layers.Dense(1)(x)
        return Model(inp, out, name='BiDir_Tuned')

    def get_clstan_residual():
        # Adds residual connection around Conv1D layers
        inp = layers.Input(shape=shape)
        c1  = layers.Conv1D(128, 3, padding='same', activation='relu')(inp)
        c1  = layers.BatchNormalization()(c1)
        c2  = layers.Conv1D(128, 3, padding='same', activation='relu')(c1)
        c2  = layers.BatchNormalization()(c2)
        res = layers.add([c1, c2]) # Skip connection
        x   = layers.Bidirectional(layers.GRU(64, return_sequences=True))(res)
        x   = layers.Dropout(0.2)(x)
        x   = TemporalAttention()(x)
        x   = layers.Dense(64, activation='relu')(x)
        out = layers.Dense(1)(x)
        return Model(inp, out, name='CLSTAN_Residual')

    def get_hybrid_attn():
        inp = layers.Input(shape=shape)
        x   = layers.Conv1D(64, 3, padding='same', activation='relu')(inp)
        x   = layers.Bidirectional(layers.LSTM(64, return_sequences=True))(x)
        x   = layers.Attention()([x, x]) # Self-Attention block
        x   = layers.Flatten()(x)
        x   = layers.Dense(64, activation='relu')(x)
        out = layers.Dense(1)(x)
        return Model(inp, out, name='Hybrid_SelfAttn')

    # ── 4. Execute Runs 1 to 8 (Standard Fits) ──────────────────────────────
    lr_schedule = tf.keras.optimizers.schedules.CosineDecay(1e-3, decay_steps=4000, alpha=1e-6)
    
    # Run 1: Baseline
    run_experiment(1, "Baseline", get_baseline, 'mse', lr=1e-3, epochs=20, batch_size=32)
    
    # Run 2: Original CLSTAN
    run_experiment(2, "CLSTAN_Original", get_clstan_orig, weighted_huber_loss(0.3), epochs=30, batch_size=32, scheduler=lr_schedule)
    
    # Run 3: Original BiDir
    run_experiment(3, "BiDir_Original", get_bidir_orig, weighted_huber_loss(0.3), epochs=30, batch_size=32, scheduler=lr_schedule)
    
    # Run 4: CLSTAN Tuned Dropout & LayerNorm
    run_experiment(4, "CLSTAN_Tuned_Dropout", get_clstan_tuned_dropout, weighted_huber_loss(0.2), lr=5e-4, epochs=30, batch_size=32)
    
    # Run 5: CLSTAN with Larger Batch Size
    run_experiment(5, "CLSTAN_Large_Batch", get_clstan_orig, weighted_huber_loss(0.3), epochs=30, batch_size=64, scheduler=lr_schedule)
    
    # Run 6: BiDir GRU-LSTM Tuned
    run_experiment(6, "BiDir_Tuned", get_bidir_tuned, weighted_huber_loss(0.3), lr=8e-4, epochs=30, batch_size=32)
    
    # Run 7: CLSTAN with Skip/Residual block
    run_experiment(7, "CLSTAN_Residual", get_clstan_residual, weighted_huber_loss(0.3), lr=1e-3, epochs=30, batch_size=32)
    
    # Run 8: Hybrid model with self-attention
    run_experiment(8, "Hybrid_SelfAttn", get_hybrid_attn, weighted_huber_loss(0.25), lr=1e-3, epochs=30, batch_size=32)

    # ── 5. Run 9: Custom GradientTape Loop ───────────────────────────────────
    print("\n--- 🚀 Running Experiment 9: GradientTape CLSTAN ---")
    run9 = wandb.init(
        project=WANDB_PROJECT,
        entity=WANDB_ENTITY,
        name="Run_9_GradientTape_CLSTAN",
        config={
            "experiment_id": 9,
            "model_name": "GradientTape_CLSTAN",
            "learning_rate": 1e-3,
            "epochs": 25,
            "batch_size": 32,
            "optimizer": "adam"
        },
        reinit=True
    )
    
    model_tape = get_clstan_orig()
    opt_tape = keras.optimizers.Adam(learning_rate=1e-3)
    loss_fn = weighted_huber_loss(0.3)
    mae_metric = keras.metrics.MeanAbsoluteError()
    
    ds_train = tf.data.Dataset.from_tensor_slices((X_train, y_train)).shuffle(5000).batch(32)
    ds_val   = tf.data.Dataset.from_tensor_slices((X_val,   y_val)).batch(32)
    
    @tf.function
    def train_step(xb, yb):
        with tf.GradientTape() as tape:
            y_pred = model_tape(xb, training=True)
            loss = loss_fn(tf.reshape(yb, (-1, 1)), y_pred)
        grads = tape.gradient(loss, model_tape.trainable_variables)
        opt_tape.apply_gradients(zip(grads, model_tape.trainable_variables))
        mae_metric.update_state(yb, tf.squeeze(y_pred))
        return loss

    @tf.function
    def val_step(xb, yb):
        y_pred = model_tape(xb, training=False)
        return tf.reduce_mean(tf.abs(yb - tf.squeeze(y_pred)))
    
    best_val_mae = float('inf')
    best_weights = None
    
    for epoch in range(25):
        mae_metric.reset_state()
        epoch_losses = []
        for xb, yb in ds_train:
            l = train_step(xb, yb)
            epoch_losses.append(float(l))
        
        train_mae = float(mae_metric.result())
        val_maes = [float(val_step(xb, yb)) for xb, yb in ds_val]
        val_mae = float(np.mean(val_maes))
        epoch_loss = float(np.mean(epoch_losses))
        
        # Log to Wandb per epoch
        wandb.log({
            "epoch": epoch + 1,
            "loss": epoch_loss,
            "mae": train_mae,
            "val_mae": val_mae
        })
        
        if val_mae < best_val_mae:
            best_val_mae = val_mae
            best_weights = [v.numpy().copy() for v in model_tape.trainable_variables]
            
    # Restore best weights
    if best_weights:
        for v, w in zip(model_tape.trainable_variables, best_weights):
            v.assign(w)
            
    # Save model and evaluate
    model_tape_path = "/tmp/GradientTape_CLSTAN.keras"
    model_tape.save(model_tape_path)
    saved_models["GradientTape_CLSTAN"] = model_tape_path
    
    test_pred_scaled = model_tape.predict(X_test, verbose=0).flatten()
    test_pred = scaler_y.inverse_transform(test_pred_scaled.reshape(-1, 1)).flatten().clip(0, 1)
    test_preds_dict["GradientTape_CLSTAN"] = test_pred
    
    mae = mean_absolute_error(y_test_raw, test_pred)
    rmse = np.sqrt(mean_squared_error(y_test_raw, test_pred))
    r2 = r2_score(y_test_raw, test_pred)
    acc = np.mean(np.abs(y_test_raw - test_pred) <= 0.05) * 100
    validation_maes["GradientTape_CLSTAN"] = best_val_mae
    
    print(f"   Validation MAE : {best_val_mae:.5f}")
    print(f"   Test MAE       : {mae:.5f}")
    print(f"   Test Accuracy  : {acc:.2f}%")
    
    wandb.log({
        "test_mae": mae,
        "test_rmse": rmse,
        "test_r2": r2,
        "test_accuracy_5pct": acc,
        "best_val_mae_final": best_val_mae
    })
    
    # Log model & scalers & running script artifacts to W&B
    artifact = wandb.Artifact(name="model-GradientTape_CLSTAN", type="model")
    artifact.add_file(model_tape_path, name="GradientTape_CLSTAN.keras")
    artifact.add_file(scaler_X_path, name="scaler_X.pkl")
    artifact.add_file(scaler_y_path, name="scaler_y.pkl")
    artifact.add_file(features_path, name="feature_cols.pkl")
    if os.path.exists("/root/modal_train.py"):
        artifact.add_file("/root/modal_train.py", name="modal_train.py")
    run9.log_artifact(artifact)
    
    run9.finish()

    # ── 6. Run 10: Weighted Ensemble Model ───────────────────────────────────
    print("\n--- 🚀 Running Experiment 10: Weighted Ensemble ---")
    run10 = wandb.init(
        project=WANDB_PROJECT,
        entity=WANDB_ENTITY,
        name="Run_10_Ensemble",
        config={
            "experiment_id": 10,
            "model_name": "Weighted_Ensemble"
        },
        reinit=True
    )
    
    # Calculate weighted prediction based on inverse validation MAE
    # lower validation MAE -> higher weight
    active_models = list(test_preds_dict.keys())
    inv_val_maes = [1.0 / (validation_maes[m] + 1e-8) for m in active_models]
    total_inv = sum(inv_val_maes)
    weights = [val / total_inv for val in inv_val_maes]
    
    print("Ensemble weights:")
    for m, w in zip(active_models, weights):
        print(f"   {m}: {w:.4f}")
        
    yp_ens = np.zeros_like(y_test_raw)
    for m, w in zip(active_models, weights):
        yp_ens += w * test_preds_dict[m]
    yp_ens = yp_ens.clip(0, 1)
    
    ens_mae = mean_absolute_error(y_test_raw, yp_ens)
    ens_rmse = np.sqrt(mean_squared_error(y_test_raw, yp_ens))
    ens_r2 = r2_score(y_test_raw, yp_ens)
    ens_acc = np.mean(np.abs(y_test_raw - yp_ens) <= 0.05) * 100
    
    print(f"   Ensemble Test MAE     : {ens_mae:.5f} (Target: ≤0.02)")
    print(f"   Ensemble Test Accuracy: {ens_acc:.2f}% (Target: ≥85%)")
    
    wandb.log({
        "test_mae": ens_mae,
        "test_rmse": ens_rmse,
        "test_r2": ens_r2,
        "test_accuracy_5pct": ens_acc
    })
    
    # Log the complete best model package (with scalers and running script) to Run 10
    best_single_model_name = min(validation_maes, key=validation_maes.get)
    best_model_file = saved_models[best_single_model_name]
    
    artifact = wandb.Artifact(name="smartpark-ensemble-and-best-model", type="model")
    artifact.add_file(best_model_file, name="best_clstan.keras")
    artifact.add_file(scaler_X_path, name="scaler_X.pkl")
    artifact.add_file(scaler_y_path, name="scaler_y.pkl")
    artifact.add_file(features_path, name="feature_cols.pkl")
    if os.path.exists("/root/modal_train.py"):
        artifact.add_file("/root/modal_train.py", name="modal_train.py")
    run10.log_artifact(artifact)
    
    run10.finish()

    # ── 7. Retrieve Best Performing Single Model ──────────────────────────────
    best_single_model_name = min(validation_maes, key=validation_maes.get)
    best_val_score = validation_maes[best_single_model_name]
    print(f"\n🏆 Best Single Model: {best_single_model_name} with Val MAE of {best_val_score:.5f}")
    
    # Read the best saved model as bytes to transfer locally
    best_model_file = saved_models[best_single_model_name]
    with open(best_model_file, "rb") as f:
        best_model_bytes = f.read()
        
    # Serialize scaler details
    scaler_x_bytes = pickle.dumps(scaler_X)
    scaler_y_bytes = pickle.dumps(scaler_y)
    features_bytes = pickle.dumps(FEATURE_COLS)
    
    return best_model_bytes, scaler_x_bytes, scaler_y_bytes, features_bytes

@app.local_entrypoint()
def main():
    print("🚀 Triggering remote execution on Modal T4 GPU...")
    best_model_bytes, scaler_x_bytes, scaler_y_bytes, features_bytes = run_experiments.remote()
    
    output_dir = Path("C:/Users/user/Downloads/next js on opennext github action/modelling")
    output_dir.mkdir(parents=True, exist_ok=True)
    
    print("\n💾 Remote execution finished. Writing models and scalers locally...")
    
    # Save the best model
    model_path = output_dir / "best_clstan.keras"
    with open(model_path, "wb") as f:
        f.write(best_model_bytes)
    print(f"   Saved best model to: {model_path}")
    
    # Save scalers
    with open(output_dir / "scaler_X.pkl", "wb") as f:
        f.write(scaler_x_bytes)
    with open(output_dir / "scaler_y.pkl", "wb") as f:
        f.write(scaler_y_bytes)
    with open(output_dir / "feature_cols.pkl", "wb") as f:
        f.write(features_bytes)
        
    print("🎉 All artifacts downloaded successfully! Ready for FastAPI deployment.")
