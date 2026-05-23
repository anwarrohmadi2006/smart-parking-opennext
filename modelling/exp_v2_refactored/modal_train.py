import os
import re
import json
import warnings
import gc
import pickle
import zipfile
import datetime
import io
import numpy as np
import pandas as pd
from pathlib import Path

# Modal definition
import modal

app = modal.App("smartpark-training-v2")

# Define the container image with GPU support, necessary python packages,
# and add the local dataset directly into the image (Modal 1.0+ standard)
# We pin numpy<2.0 to ensure compatibility with TensorFlow 2.15.0.
tf_image = (
    modal.Image.from_registry("tensorflow/tensorflow:2.15.0-gpu")
    .pip_install("numpy<2.0", "scikit-learn", "pandas", "wandb", "scipy")
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/CNRParkEXT (1).csv",
        remote_path="/root/CNRParkEXT (1).csv"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/modal_train.py",
        remote_path="/root/modal_train.py"
    )
)

@app.function(
    image=tf_image,
    gpu="L4",                # ── Upgraded from T4 to L4 GPU ──
    secrets=[modal.Secret.from_dict({
        "WANDB_API_KEY": "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",
        "TF_ENABLE_ONEDNN_OPTS": "0"
    })],
    timeout=10800            # ── Extended to 3 hours for K-Fold ──
)
def run_experiments():
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers, Model, callbacks
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
    from sklearn.model_selection import TimeSeriesSplit
    import wandb

    # ── Global Reproducibility Seeds ─────────────────────────────────────────
    RANDOM_SEED = 42
    np.random.seed(RANDOM_SEED)
    tf.random.set_seed(RANDOM_SEED)

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

    # Vectorized datetime parsing (much faster than row-by-row)
    print("Parsing datetimes (vectorized)...")
    dt_series = df['datetime'].astype(str)\
        .str.replace('_', ' ', regex=False)\
        .str.replace('.', ':', regex=False)
    df['timestamp'] = pd.to_datetime(dt_series, format='mixed', errors='coerce')

    df['weather'] = df['weather'].map({'S': 'SUNNY', 'C': 'OVERCAST', 'R': 'RAINY'}).fillna('UNKNOWN')

    # Aggregate records to occupancy rate
    print("Aggregating records to time-series...")
    df_ts = (
        df.dropna(subset=['timestamp'])
        .groupby('timestamp')
        .agg(
            occupied_slots=('occupancy', 'sum'),
            total_patches=('occupancy', 'count'),
            weather=('weather', 'first')
        ).reset_index()
    )
    df_ts['occupancy_rate'] = (df_ts['occupied_slots'] / df_ts['total_patches']).clip(0, 1)
    df_ts = df_ts.set_index('timestamp')

    # Resample to 10-minute intervals
    df_uni = df_ts.resample('10min').agg({
        'weather': 'first',
        'occupancy_rate': 'mean'
    }).reset_index()

    # Interpolate occupancy and weather
    df_uni['occupancy_rate'] = df_uni['occupancy_rate'].interpolate(limit_direction='both').clip(0, 1)
    df_uni['weather']        = df_uni['weather'].ffill().bfill().fillna('UNKNOWN')
    df_uni['hour']           = df_uni['timestamp'].dt.hour
    df_uni['day_of_week']    = df_uni['timestamp'].dt.dayofweek
    df_uni['is_weekend']     = (df_uni['day_of_week'] >= 5).astype(int)
    df_uni['month']          = df_uni['timestamp'].dt.month

    # Feature Engineering (27 features)
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

    # ── 2. Data Splitting & Scaling (NO DATA LEAKAGE) ───────────────────────
    n = len(df_clean)
    train_end = int(0.70 * n)
    val_end   = int(0.85 * n)

    # Fit scalers STRICTLY on training partition
    scaler_X = StandardScaler()
    scaler_y = StandardScaler()

    print("Fitting Scalers strictly on Train set...")
    scaler_X.fit(df_clean.iloc[:train_end][FEATURE_COLS])
    scaler_y.fit(df_clean.iloc[:train_end]['target_occ'].values.reshape(-1, 1))

    # Transform entire dataset using train-fitted scalers
    df_sc = df_clean.copy()
    df_sc[FEATURE_COLS] = scaler_X.transform(df_clean[FEATURE_COLS])
    y_raw    = df_clean['target_occ'].values.reshape(-1, 1)
    y_scaled = scaler_y.transform(y_raw).flatten()

    # Save scalers
    scaler_X_path = "/tmp/scaler_X.pkl"
    scaler_y_path = "/tmp/scaler_y.pkl"
    features_path = "/tmp/feature_cols.pkl"
    with open(scaler_X_path, "wb") as f: pickle.dump(scaler_X, f)
    with open(scaler_y_path, "wb") as f: pickle.dump(scaler_y, f)
    with open(features_path, "wb") as f: pickle.dump(FEATURE_COLS, f)

    # Sequence Creation (Scaled)
    def create_sequences(data_feat, y_vals, window):
        X, y = [], []
        for i in range(len(data_feat) - window):
            X.append(data_feat[FEATURE_COLS].iloc[i:i+window].values)
            y.append(y_vals[i+window])
        return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)

    X_seq, y_seq = create_sequences(df_sc, y_scaled, WINDOW_SIZE)
    y_seq_raw    = y_raw[WINDOW_SIZE:].flatten()

    # Sequence Creation (Unscaled — for K-Fold)
    def create_sequences_raw(data_feat, y_vals_raw, window):
        X, y = [], []
        for i in range(len(data_feat) - window):
            X.append(data_feat[FEATURE_COLS].iloc[i:i+window].values)
            y.append(y_vals_raw[i+window])
        return np.array(X, dtype=np.float32), np.array(y, dtype=np.float32)

    X_seq_raw_kfold, y_seq_raw_kfold = create_sequences_raw(df_clean, y_raw.flatten(), WINDOW_SIZE)

    # Split
    train_end_seq = int(0.70 * len(X_seq))
    val_end_seq   = int(0.85 * len(X_seq))

    X_train, y_train = X_seq[:train_end_seq],          y_seq[:train_end_seq]
    X_val,   y_val   = X_seq[train_end_seq:val_end_seq], y_seq[train_end_seq:val_end_seq]
    X_test,  y_test  = X_seq[val_end_seq:],             y_seq[val_end_seq:]

    y_val_raw  = y_seq_raw[train_end_seq:val_end_seq]
    y_test_raw = y_seq_raw[val_end_seq:]

    print(f"Train: {X_train.shape} | Val: {X_val.shape} | Test: {X_test.shape}")

    # TensorBoard Logs Directory
    TB_LOG_ROOT = "/tmp/tensorboard_logs"
    os.makedirs(TB_LOG_ROOT, exist_ok=True)

    # ── 3. Custom Layers, Loss, & Callbacks ──────────────────────────────────
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
            h = tf.where(tf.abs(err) <= delta,
                         0.5 * tf.square(err),
                         delta * (tf.abs(err) - 0.5 * delta))
            w = tf.where(y_true > 0.5, high_w, 1.0)
            return tf.reduce_mean(h * w)
        return loss

    class SmartParkMonitor(callbacks.Callback):
        def __init__(self, X_val, y_val_raw, scaler_y, target_mae=0.02, run_name=""):
            super().__init__()
            self.X_val           = X_val
            self.y_val_raw       = y_val_raw
            self.scaler_y        = scaler_y
            self.target_mae      = target_mae
            self.best_unscaled_val_mae = float('inf')
            self.run_name        = run_name

        def on_epoch_end(self, epoch, logs=None):
            logs = logs or {}
            val_preds_sc = self.model.predict(self.X_val, verbose=0).flatten()
            val_preds    = self.scaler_y.inverse_transform(
                               val_preds_sc.reshape(-1, 1)).flatten().clip(0, 1)
            unscaled_val_mae = float(np.mean(np.abs(self.y_val_raw - val_preds)))
            if unscaled_val_mae < self.best_unscaled_val_mae:
                self.best_unscaled_val_mae = unscaled_val_mae

            wandb.log({
                "epoch":                epoch + 1,
                "loss":                 logs.get('loss', 0.0),
                "val_loss":             logs.get('val_loss', 0.0),
                "scaled_train_mae":     logs.get('mae', logs.get('mean_absolute_error', 0.0)),
                "scaled_val_mae":       logs.get('val_mae', logs.get('val_mean_absolute_error', 0.0)),
                "unscaled_val_mae":     unscaled_val_mae,
                "best_unscaled_val_mae": self.best_unscaled_val_mae
            })

    # W&B Setup
    WANDB_PROJECT = "Capstone Projek CC26-PRU436"
    WANDB_ENTITY  = "anwarrohmadi111-universitas-islam-negeri-raden-mas-said-"

    test_preds_dict = {}
    validation_maes = {}
    saved_models    = {}

    # ── Helper: upload TensorBoard logs as W&B artifact ──────────────────────
    def upload_tb_artifact(run_obj, config_name, log_dir):
        try:
            tb_artifact = wandb.Artifact(
                name=f"tensorboard-{config_name}",
                type="tensorboard-logs",
                description=f"TensorBoard training logs for {config_name}"
            )
            tb_artifact.add_dir(log_dir, name=f"tensorboard/{config_name}")
            run_obj.log_artifact(tb_artifact)
            print(f"   [TB] TensorBoard artifact uploaded for {config_name}")
        except Exception as e:
            print(f"   [TB][WARN] Could not upload TensorBoard artifact: {e}")

    # ── 4. Main Experiment Runner ─────────────────────────────────────────────
    def run_experiment(run_num, config_name, model_fn, loss_fn,
                       lr=1e-3, epochs=25, batch_size=32, scheduler=None):
        print(f"\n--- 🚀 Run {run_num}: {config_name} ---")

        run = wandb.init(
            project=WANDB_PROJECT,
            entity=WANDB_ENTITY,
            name=f"Run_{run_num}_{config_name}",
            config={
                "experiment_id":  run_num,
                "model_name":     config_name,
                "learning_rate":  lr,
                "epochs":         epochs,
                "batch_size":     batch_size,
                "optimizer":      "adam",
                "gpu":            "L4",
                "random_seed":    RANDOM_SEED,
                "window_size":    WINDOW_SIZE,
                "n_features":     N_FEATURES,
                "target_horizon": TARGET_HORIZON
            },
            reinit=True
        )

        model = model_fn()
        # Gradient clipping prevents exploding gradients in GRU/LSTM
        opt = keras.optimizers.Adam(
            learning_rate=scheduler if scheduler is not None else lr,
            clipnorm=1.0
        )
        model.compile(optimizer=opt, loss=loss_fn, metrics=['mae'])

        tb_log_dir = os.path.join(TB_LOG_ROOT, f"Run_{run_num}_{config_name}")
        os.makedirs(tb_log_dir, exist_ok=True)

        cbs = [
            callbacks.EarlyStopping(
                monitor='val_mae', patience=15,
                restore_best_weights=True, verbose=0),
            SmartParkMonitor(
                X_val=X_val, y_val_raw=y_val_raw,
                scaler_y=scaler_y, target_mae=0.02, run_name=config_name),
            callbacks.TensorBoard(
                log_dir=tb_log_dir,
                histogram_freq=0,
                write_graph=False,
                update_freq='epoch')
        ]

        model.fit(
            X_train, y_train,
            validation_data=(X_val, y_val),
            epochs=epochs,
            batch_size=batch_size,
            callbacks=cbs,
            verbose=0
        )

        # Evaluate on Test Set (Original Space)
        test_pred_sc = model.predict(X_test, verbose=0).flatten()
        test_pred    = scaler_y.inverse_transform(
                           test_pred_sc.reshape(-1, 1)).flatten().clip(0, 1)
        test_preds_dict[config_name] = test_pred

        mae  = mean_absolute_error(y_test_raw, test_pred)
        rmse = np.sqrt(mean_squared_error(y_test_raw, test_pred))
        r2   = r2_score(y_test_raw, test_pred)
        acc  = np.mean(np.abs(y_test_raw - test_pred) <= 0.05) * 100

        # Validation MAE in original space (unscaled)
        val_pred_sc = model.predict(X_val, verbose=0).flatten()
        val_pred    = scaler_y.inverse_transform(
                          val_pred_sc.reshape(-1, 1)).flatten().clip(0, 1)
        best_val    = mean_absolute_error(y_val_raw, val_pred)
        validation_maes[config_name] = best_val

        print(f"   Val MAE (unscaled): {best_val:.5f} | Test MAE: {mae:.5f} | Acc: {acc:.2f}%")

        wandb.log({
            "test_mae":                    mae,
            "test_rmse":                   rmse,
            "test_r2":                     r2,
            "test_accuracy_5pct":          acc,
            "best_unscaled_val_mae_final": best_val
        })

        model_save_path = f"/tmp/{config_name}.keras"
        model.save(model_save_path)
        saved_models[config_name] = model_save_path

        # W&B Artifact: model + scalers + script + TensorBoard logs
        artifact = wandb.Artifact(name=f"model-{config_name}", type="model")
        artifact.add_file(model_save_path,  name=f"{config_name}.keras")
        artifact.add_file(scaler_X_path,    name="scaler_X.pkl")
        artifact.add_file(scaler_y_path,    name="scaler_y.pkl")
        artifact.add_file(features_path,    name="feature_cols.pkl")
        if os.path.exists("/root/modal_train.py"):
            artifact.add_file("/root/modal_train.py", name="modal_train.py")
        run.log_artifact(artifact)

        upload_tb_artifact(run, config_name, tb_log_dir)
        run.finish()

    # ── 5. Model Architectures ───────────────────────────────────────────────
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
        x   = layers.Conv1D(64, 3, padding='same', activation='relu')(x)
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
        inp = layers.Input(shape=shape)
        x   = layers.Conv1D(128, 3, padding='same', activation='relu')(inp)
        x   = layers.LayerNormalization()(x)
        x   = layers.Conv1D(64, 3, padding='same', activation='relu')(x)
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
        inp = layers.Input(shape=shape)
        c1  = layers.Conv1D(128, 3, padding='same', activation='relu')(inp)
        c1  = layers.BatchNormalization()(c1)
        c2  = layers.Conv1D(128, 3, padding='same', activation='relu')(c1)
        c2  = layers.BatchNormalization()(c2)
        res = layers.add([c1, c2])
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
        x   = layers.Attention()([x, x])
        x   = layers.Flatten()(x)
        x   = layers.Dense(64, activation='relu')(x)
        out = layers.Dense(1)(x)
        return Model(inp, out, name='Hybrid_SelfAttn')

    # ── 6. Execute Runs 1–8 ──────────────────────────────────────────────────
    lr_schedule = tf.keras.optimizers.schedules.CosineDecay(
        1e-3, decay_steps=4000, alpha=1e-6)

    run_experiment(1,  "Baseline",            get_baseline,          'mse',                   lr=1e-3, epochs=20, batch_size=32)
    run_experiment(2,  "CLSTAN_Original",     get_clstan_orig,       weighted_huber_loss(0.3), epochs=30, batch_size=32, scheduler=lr_schedule)
    run_experiment(3,  "BiDir_Original",      get_bidir_orig,        weighted_huber_loss(0.3), epochs=30, batch_size=32, scheduler=lr_schedule)
    run_experiment(4,  "CLSTAN_Tuned_Dropout",get_clstan_tuned_dropout, weighted_huber_loss(0.2), lr=5e-4, epochs=30, batch_size=32)
    run_experiment(5,  "CLSTAN_Large_Batch",  get_clstan_orig,       weighted_huber_loss(0.3), epochs=30, batch_size=64, scheduler=lr_schedule)
    run_experiment(6,  "BiDir_Tuned",         get_bidir_tuned,       weighted_huber_loss(0.3), lr=8e-4, epochs=30, batch_size=32)
    run_experiment(7,  "CLSTAN_Residual",     get_clstan_residual,   weighted_huber_loss(0.3), lr=1e-3, epochs=30, batch_size=32)
    run_experiment(8,  "Hybrid_SelfAttn",     get_hybrid_attn,       weighted_huber_loss(0.25),lr=1e-3, epochs=30, batch_size=32)

    # ── 7. Run 9: Custom GradientTape Loop ───────────────────────────────────
    print("\n--- 🚀 Run 9: GradientTape CLSTAN ---")
    run9 = wandb.init(
        project=WANDB_PROJECT, entity=WANDB_ENTITY,
        name="Run_9_GradientTape_CLSTAN",
        config={"experiment_id": 9, "model_name": "GradientTape_CLSTAN",
                "learning_rate": 1e-3, "epochs": 25, "batch_size": 32,
                "gpu": "L4", "random_seed": RANDOM_SEED},
        reinit=True
    )

    model_tape = get_clstan_orig()
    opt_tape   = keras.optimizers.Adam(learning_rate=1e-3, clipnorm=1.0)
    loss_fn9   = weighted_huber_loss(0.3)

    # TensorBoard writer for Run 9
    tb_dir_run9 = os.path.join(TB_LOG_ROOT, "Run_9_GradientTape_CLSTAN")
    tb_writer9  = tf.summary.create_file_writer(tb_dir_run9)

    ds_train9 = tf.data.Dataset.from_tensor_slices(
        (X_train, y_train)).shuffle(5000, seed=RANDOM_SEED).batch(32)

    @tf.function
    def train_step9(xb, yb):
        with tf.GradientTape() as tape:
            y_pred = model_tape(xb, training=True)
            loss   = loss_fn9(tf.reshape(yb, (-1, 1)), y_pred)
        grads = tape.gradient(loss, model_tape.trainable_variables)
        # Clip gradients manually for GradientTape loop
        grads, _ = tf.clip_by_global_norm(grads, 1.0)
        opt_tape.apply_gradients(zip(grads, model_tape.trainable_variables))
        return loss

    best_val9    = float('inf')
    best_weights9 = None
    y_train_raw9 = y_seq_raw[:train_end_seq]

    for epoch in range(25):
        epoch_losses = [float(train_step9(xb, yb)) for xb, yb in ds_train9]
        epoch_loss   = float(np.mean(epoch_losses))

        val_sc   = model_tape.predict(X_val,   verbose=0).flatten()
        val_unsc = scaler_y.inverse_transform(val_sc.reshape(-1, 1)).flatten().clip(0, 1)
        val_mae  = float(np.mean(np.abs(y_val_raw - val_unsc)))

        tr_sc    = model_tape.predict(X_train, verbose=0).flatten()
        tr_unsc  = scaler_y.inverse_transform(tr_sc.reshape(-1, 1)).flatten().clip(0, 1)
        tr_mae   = float(np.mean(np.abs(y_train_raw9 - tr_unsc)))

        # TensorBoard logging for Run 9
        with tb_writer9.as_default():
            tf.summary.scalar("loss",                epoch_loss, step=epoch + 1)
            tf.summary.scalar("unscaled_train_mae",  tr_mae,     step=epoch + 1)
            tf.summary.scalar("unscaled_val_mae",    val_mae,    step=epoch + 1)
        tb_writer9.flush()

        wandb.log({
            "epoch": epoch + 1, "loss": epoch_loss,
            "unscaled_train_mae": tr_mae, "unscaled_val_mae": val_mae,
            "best_unscaled_val_mae": min(val_mae, best_val9)
        })

        if val_mae < best_val9:
            best_val9    = val_mae
            best_weights9 = [v.numpy().copy() for v in model_tape.trainable_variables]

    if best_weights9:
        for v, w in zip(model_tape.trainable_variables, best_weights9):
            v.assign(w)

    tape_path   = "/tmp/GradientTape_CLSTAN.keras"
    model_tape.save(tape_path)
    saved_models["GradientTape_CLSTAN"] = tape_path

    test_sc9 = model_tape.predict(X_test, verbose=0).flatten()
    test_p9  = scaler_y.inverse_transform(test_sc9.reshape(-1, 1)).flatten().clip(0, 1)
    test_preds_dict["GradientTape_CLSTAN"] = test_p9

    mae9  = mean_absolute_error(y_test_raw, test_p9)
    rmse9 = np.sqrt(mean_squared_error(y_test_raw, test_p9))
    r29   = r2_score(y_test_raw, test_p9)
    acc9  = np.mean(np.abs(y_test_raw - test_p9) <= 0.05) * 100
    validation_maes["GradientTape_CLSTAN"] = best_val9

    print(f"   Val MAE: {best_val9:.5f} | Test MAE: {mae9:.5f} | Acc: {acc9:.2f}%")

    wandb.log({"test_mae": mae9, "test_rmse": rmse9, "test_r2": r29,
               "test_accuracy_5pct": acc9, "best_unscaled_val_mae_final": best_val9})

    art9 = wandb.Artifact(name="model-GradientTape_CLSTAN", type="model")
    art9.add_file(tape_path, name="GradientTape_CLSTAN.keras")
    art9.add_file(scaler_X_path, name="scaler_X.pkl")
    art9.add_file(scaler_y_path, name="scaler_y.pkl")
    art9.add_file(features_path, name="feature_cols.pkl")
    if os.path.exists("/root/modal_train.py"):
        art9.add_file("/root/modal_train.py", name="modal_train.py")
    run9.log_artifact(art9)
    upload_tb_artifact(run9, "GradientTape_CLSTAN", tb_dir_run9)
    run9.finish()

    # ── 8. Run 10: Weighted Ensemble ─────────────────────────────────────────
    print("\n--- 🚀 Run 10: Weighted Ensemble ---")
    run10 = wandb.init(
        project=WANDB_PROJECT, entity=WANDB_ENTITY,
        name="Run_10_Ensemble",
        config={"experiment_id": 10, "model_name": "Weighted_Ensemble", "gpu": "L4"},
        reinit=True
    )

    active_models = list(test_preds_dict.keys())
    inv_vals  = [1.0 / (validation_maes[m] + 1e-8) for m in active_models]
    total_inv = sum(inv_vals)
    weights   = [v / total_inv for v in inv_vals]

    print("Ensemble weights:")
    for m, w in zip(active_models, weights):
        print(f"   {m}: {w:.4f}")

    yp_ens = sum(w * test_preds_dict[m] for m, w in zip(active_models, weights))
    yp_ens = yp_ens.clip(0, 1)

    ens_mae  = mean_absolute_error(y_test_raw, yp_ens)
    ens_rmse = np.sqrt(mean_squared_error(y_test_raw, yp_ens))
    ens_r2   = r2_score(y_test_raw, yp_ens)
    ens_acc  = np.mean(np.abs(y_test_raw - yp_ens) <= 0.05) * 100

    print(f"   Ensemble Test MAE: {ens_mae:.5f} | Acc: {ens_acc:.2f}%")
    wandb.log({"test_mae": ens_mae, "test_rmse": ens_rmse,
               "test_r2": ens_r2, "test_accuracy_5pct": ens_acc})

    best_single = min(validation_maes, key=validation_maes.get)
    art10 = wandb.Artifact(name="smartpark-ensemble-and-best-model", type="model")
    art10.add_file(saved_models[best_single], name="best_clstan.keras")
    art10.add_file(scaler_X_path, name="scaler_X.pkl")
    art10.add_file(scaler_y_path, name="scaler_y.pkl")
    art10.add_file(features_path, name="feature_cols.pkl")
    if os.path.exists("/root/modal_train.py"):
        art10.add_file("/root/modal_train.py", name="modal_train.py")
    run10.log_artifact(art10)
    run10.finish()

    # ── 9. Run 11: TimeSeriesSplit K-Fold Cross Validation ───────────────────
    print("\n--- 🚀 Run 11: TimeSeriesSplit K-Fold (CLSTAN_Original) ---")
    run11 = wandb.init(
        project=WANDB_PROJECT, entity=WANDB_ENTITY,
        name="Run_11_KFold_CLSTAN",
        config={
            "experiment_id": 11, "model_name": "CLSTAN_KFold",
            "n_splits": 5, "gap": 18, "test_size": 3000,
            "gpu": "L4", "random_seed": RANDOM_SEED
        },
        reinit=True
    )

    tb_dir_kfold = os.path.join(TB_LOG_ROOT, "Run_11_KFold_CLSTAN")
    os.makedirs(tb_dir_kfold, exist_ok=True)

    tscv = TimeSeriesSplit(n_splits=5, gap=18, test_size=3000)
    fold_results = []

    for fold_num, (train_idx, test_idx) in enumerate(tscv.split(X_seq_raw_kfold)):
        print(f"\n   Fold {fold_num + 1}/5 | train={len(train_idx)} | test={len(test_idx)}")

        # Extract raw (unscaled) sequences for this fold
        X_fold_tr_raw = X_seq_raw_kfold[train_idx]
        X_fold_te_raw = X_seq_raw_kfold[test_idx]
        y_fold_tr_raw = y_seq_raw_kfold[train_idx]
        y_fold_te_raw = y_seq_raw_kfold[test_idx]

        # Re-fit fresh scalers STRICTLY on this fold's training sequences
        fold_sc_X = StandardScaler()
        fold_sc_y = StandardScaler()
        fold_sc_X.fit(X_fold_tr_raw.reshape(-1, N_FEATURES))
        fold_sc_y.fit(y_fold_tr_raw.reshape(-1, 1))

        # Transform sequences using fold-specific scalers
        X_fold_tr = fold_sc_X.transform(
            X_fold_tr_raw.reshape(-1, N_FEATURES)).reshape(X_fold_tr_raw.shape)
        X_fold_te = fold_sc_X.transform(
            X_fold_te_raw.reshape(-1, N_FEATURES)).reshape(X_fold_te_raw.shape)
        y_fold_tr = fold_sc_y.transform(y_fold_tr_raw.reshape(-1, 1)).flatten()

        # Build fresh model for each fold
        tf.random.set_seed(RANDOM_SEED + fold_num)
        fold_model = get_clstan_orig()
        fold_opt   = keras.optimizers.Adam(
            learning_rate=tf.keras.optimizers.schedules.CosineDecay(
                1e-3, decay_steps=2000, alpha=1e-6),
            clipnorm=1.0
        )
        fold_model.compile(optimizer=fold_opt, loss=weighted_huber_loss(0.3), metrics=['mae'])

        tb_fold_dir = os.path.join(tb_dir_kfold, f"fold_{fold_num + 1}")
        os.makedirs(tb_fold_dir, exist_ok=True)

        # Val split within fold (last 15% of fold train)
        fold_val_start = int(0.85 * len(X_fold_tr))
        X_fold_val = X_fold_tr[fold_val_start:]
        y_fold_val = y_fold_tr[fold_val_start:]
        X_fold_tr2 = X_fold_tr[:fold_val_start]
        y_fold_tr2 = y_fold_tr[:fold_val_start]

        fold_cbs = [
            callbacks.EarlyStopping(
                monitor='val_mae', patience=10,
                restore_best_weights=True, verbose=0),
            callbacks.TensorBoard(
                log_dir=tb_fold_dir, histogram_freq=0,
                write_graph=False, update_freq='epoch')
        ]

        fold_model.fit(
            X_fold_tr2, y_fold_tr2,
            validation_data=(X_fold_val, y_fold_val),
            epochs=20, batch_size=32,
            callbacks=fold_cbs, verbose=0
        )

        # Evaluate in original space
        fold_pred_sc = fold_model.predict(X_fold_te, verbose=0).flatten()
        fold_pred    = fold_sc_y.inverse_transform(
                           fold_pred_sc.reshape(-1, 1)).flatten().clip(0, 1)

        fold_mae  = mean_absolute_error(y_fold_te_raw, fold_pred)
        fold_rmse = np.sqrt(mean_squared_error(y_fold_te_raw, fold_pred))
        fold_r2   = r2_score(y_fold_te_raw, fold_pred)
        fold_acc  = np.mean(np.abs(y_fold_te_raw - fold_pred) <= 0.05) * 100

        fold_results.append({
            "fold": fold_num + 1,
            "mae": fold_mae, "rmse": fold_rmse,
            "r2": fold_r2, "accuracy": fold_acc
        })

        print(f"   Fold {fold_num + 1} → MAE={fold_mae:.5f} | RMSE={fold_rmse:.5f} "
              f"| R²={fold_r2:.5f} | Acc={fold_acc:.2f}%")

        wandb.log({
            f"fold_{fold_num+1}_mae":      fold_mae,
            f"fold_{fold_num+1}_rmse":     fold_rmse,
            f"fold_{fold_num+1}_r2":       fold_r2,
            f"fold_{fold_num+1}_accuracy": fold_acc
        })

        del fold_model
        gc.collect()

    # Compute and log K-Fold summary statistics
    all_maes  = [r['mae']      for r in fold_results]
    all_rmses = [r['rmse']     for r in fold_results]
    all_r2s   = [r['r2']       for r in fold_results]
    all_accs  = [r['accuracy'] for r in fold_results]

    kfold_summary = {
        "kfold_mean_mae":      float(np.mean(all_maes)),
        "kfold_std_mae":       float(np.std(all_maes)),
        "kfold_mean_rmse":     float(np.mean(all_rmses)),
        "kfold_std_rmse":      float(np.std(all_rmses)),
        "kfold_mean_r2":       float(np.mean(all_r2s)),
        "kfold_std_r2":        float(np.std(all_r2s)),
        "kfold_mean_accuracy": float(np.mean(all_accs)),
        "kfold_std_accuracy":  float(np.std(all_accs)),
    }
    wandb.log(kfold_summary)

    print(f"\n   📊 K-Fold Summary (5 folds):")
    print(f"   MAE  : {kfold_summary['kfold_mean_mae']:.5f} ± {kfold_summary['kfold_std_mae']:.5f}")
    print(f"   RMSE : {kfold_summary['kfold_mean_rmse']:.5f} ± {kfold_summary['kfold_std_rmse']:.5f}")
    print(f"   R²   : {kfold_summary['kfold_mean_r2']:.5f} ± {kfold_summary['kfold_std_r2']:.5f}")
    print(f"   Acc  : {kfold_summary['kfold_mean_accuracy']:.2f}% ± {kfold_summary['kfold_std_accuracy']:.2f}%")

    upload_tb_artifact(run11, "KFold_CLSTAN", tb_dir_kfold)
    run11.finish()

    # ── 10. Retrieve Best Model ───────────────────────────────────────────────
    best_name  = min(validation_maes, key=validation_maes.get)
    best_score = validation_maes[best_name]
    print(f"\n🏆 Best Single Model: {best_name} (Val MAE: {best_score:.5f})")

    with open(saved_models[best_name], "rb") as f:
        best_model_bytes = f.read()

    # ── 11. Package All TensorBoard Logs into ZIP ─────────────────────────────
    print("\n📦 Zipping all TensorBoard logs...")
    tb_zip_path = "/tmp/tensorboard_logs.zip"
    with zipfile.ZipFile(tb_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for root, dirs, files in os.walk(TB_LOG_ROOT):
            for file in files:
                fp = os.path.join(root, file)
                zf.write(fp, os.path.relpath(fp, '/tmp'))
    with open(tb_zip_path, 'rb') as f:
        tb_bytes = f.read()
    print(f"   TensorBoard ZIP size: {len(tb_bytes) / 1024:.1f} KB")

    return (
        best_model_bytes,
        pickle.dumps(scaler_X),
        pickle.dumps(scaler_y),
        pickle.dumps(FEATURE_COLS),
        tb_bytes
    )


@app.local_entrypoint()
def main():
    print("🚀 Triggering remote execution on Modal L4 GPU...")
    best_model_bytes, scaler_x_bytes, scaler_y_bytes, features_bytes, tb_bytes = \
        run_experiments.remote()

    output_dir = Path("C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored")
    output_dir.mkdir(parents=True, exist_ok=True)

    print("\n💾 Writing model & scalers locally...")

    # Save best model
    with open(output_dir / "best_clstan.keras", "wb") as f:
        f.write(best_model_bytes)

    # Save scalers & feature list
    with open(output_dir / "scaler_X.pkl", "wb") as f: f.write(scaler_x_bytes)
    with open(output_dir / "scaler_y.pkl", "wb") as f: f.write(scaler_y_bytes)
    with open(output_dir / "feature_cols.pkl", "wb") as f: f.write(features_bytes)

    # Extract TensorBoard logs
    tb_zip_local = output_dir / "tensorboard_logs.zip"
    with open(tb_zip_local, "wb") as f:
        f.write(tb_bytes)

    import zipfile
    with zipfile.ZipFile(tb_zip_local, 'r') as zf:
        zf.extractall(output_dir)
    print(f"   TensorBoard logs extracted to: {output_dir / 'tensorboard_logs'}/")
    print(f"\n   👉 Open TensorBoard with:")
    print(f"      tensorboard --logdir \"{output_dir / 'tensorboard_logs'}\"")

    print("\n🎉 All artifacts downloaded! Ready for deployment.")
