"""
Script: export_wandb_to_tensorboard.py
Tujuan:
  1. Mengambil history metrik (loss, unscaled_val_mae, scaled_val_mae, dll) 
     dari setiap run W&B yang sudah selesai secara dinamis dari project baru.
  2. Mengonversi metrics tersebut ke file TensorBoard event 
     (events.out.tfevents.*) di folder tensorboard_logs/<run_name>/.
  3. Upload folder TensorBoard logs tersebut ke W&B sebagai Artifact 
     di masing-masing run yang bersangkutan.
"""

import os
import wandb
import numpy as np

# ── Config ───────────────────────────────────────────────────────────────────
WANDB_API_KEY = "YOUR_WANDB_API_KEY_HERE"
PROJECT_PATH  = "anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Capstone Projek CC26-PRU436"
OUTPUT_DIR    = "tensorboard_logs"

os.environ["WANDB_API_KEY"] = WANDB_API_KEY

# ── Import TensorFlow Summary Writer ─────────────────────────────────────────
try:
    import tensorflow as tf
    USE_TF = True
    print("[OK] TensorFlow tersedia, menggunakan tf.summary writer.")
except ImportError:
    USE_TF = False
    print("[WARN] TensorFlow tidak tersedia, pakai fallback struct binary writer.")

def write_tf_events(log_dir, history_rows):
    """Tulis TensorBoard events menggunakan tf.summary."""
    os.makedirs(log_dir, exist_ok=True)
    writer = tf.summary.create_file_writer(log_dir)
    
    metric_keys = ["loss", "scaled_train_mae", "scaled_val_mae", "unscaled_val_mae",
                   "best_unscaled_val_mae", "best_unscaled_val_mae_final",
                   "test_mae", "test_rmse", "test_r2", "test_accuracy_5pct"]
    
    with writer.as_default():
        for idx, row in enumerate(history_rows):
            # Gunakan index sebagai fallback jika epoch NaN
            raw_epoch = row.get("epoch", idx)
            try:
                epoch = int(float(raw_epoch)) if raw_epoch is not None and not (isinstance(raw_epoch, float) and np.isnan(raw_epoch)) else idx
            except (ValueError, TypeError):
                epoch = idx

            for key in metric_keys:
                if key in row and row[key] is not None:
                    val = row[key]
                    try:
                        fval = float(val)
                        if not np.isnan(fval):
                            tf.summary.scalar(key, fval, step=epoch)
                    except (ValueError, TypeError):
                        pass
        writer.flush()


def write_fallback_events(log_dir, history_rows):
    """
    Fallback: Tulis TensorBoard event file menggunakan struct binary format.
    """
    import struct
    import time

    os.makedirs(log_dir, exist_ok=True)
    fname = os.path.join(log_dir, f"events.out.tfevents.{int(time.time())}.smartpark")
    
    def masked_crc32c(data):
        import crcmod
        crc_fn = crcmod.predefined.mkCrcFun('crc-32c')
        crc = crc_fn(data)
        return (((crc >> 15) | (crc << 17)) + 0xa282ead8) & 0xffffffff

    def write_record(f, data):
        len_bytes = struct.pack('Q', len(data))
        len_masked_crc = struct.pack('I', masked_crc32c(len_bytes))
        data_masked_crc = struct.pack('I', masked_crc32c(data))
        f.write(len_bytes + len_masked_crc + data + data_masked_crc)

    metric_keys = ["loss", "scaled_train_mae", "scaled_val_mae", "unscaled_val_mae",
                   "best_unscaled_val_mae", "test_mae", "test_rmse", "test_accuracy_5pct"]

    with open(fname, 'wb') as f:
        for row in history_rows:
            epoch = int(row.get("epoch", 0))
            for key in metric_keys:
                if key in row and row[key] is not None:
                    val = row[key]
                    if isinstance(val, (int, float)):
                        try:
                            if not np.isnan(float(val)):
                                # Encode as a minimal TF Summary proto
                                tag_bytes = key.encode('utf-8')
                                val_bytes = struct.pack('f', float(val))
                                step_bytes = struct.pack('q', epoch)
                                # Build Summary proto manually (simplified)
                                summary_value = b'\n' + bytes([len(tag_bytes)]) + tag_bytes + b'\x15' + val_bytes
                                summary_proto = b'\n' + bytes([len(summary_value)]) + summary_value
                                # Build Event proto
                                event_proto = b'\x11' + step_bytes + b'\x1a' + bytes([len(summary_proto)]) + summary_proto
                                write_record(f, event_proto)
                        except (ValueError, struct.error):
                            pass
    return fname

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    api = wandb.Api()
    print(f"\n[INFO] Menghubungkan ke W&B project: {PROJECT_PATH}")
    runs = api.runs(PROJECT_PATH)
    
    total_processed = 0
    for run_obj in runs:
        run_id = run_obj.id
        run_name = run_obj.name
        
        print(f"\n[INFO] Memproses: {run_name} (ID: {run_id})")
        
        # Ambil history dari W&B
        try:
            history = run_obj.history(samples=500, pandas=True)
            history_rows = history.to_dict(orient='records')
            print(f"   Baris history diambil: {len(history_rows)}")
        except Exception as e:
            print(f"   [ERROR] Gagal mengambil history: {e}")
            continue
        
        if len(history_rows) == 0:
            # Jika run ensemble (Run 10) tidak memiliki epoch history, gunakan summary
            summary = dict(run_obj.summary)
            history_rows = [{"epoch": 1, **summary}]
            print(f"   [INFO] Menggunakan summary saja.")
        
        # Tulis TensorBoard events
        log_dir = os.path.join(OUTPUT_DIR, run_name)
        try:
            if USE_TF:
                write_tf_events(log_dir, history_rows)
            else:
                write_fallback_events(log_dir, history_rows)
            print(f"   [OK] TensorBoard log disimpan ke: {log_dir}")
        except Exception as e:
            print(f"   [ERROR] Gagal menulis TensorBoard log: {e}")
            continue
        
        # Upload folder sebagai W&B Artifact di run tersebut
        try:
            resumed_run = wandb.init(
                project="Capstone Projek CC26-PRU436",
                entity="anwarrohmadi111-universitas-islam-negeri-raden-mas-said-",
                id=run_id,
                resume="must",
            )
            artifact = wandb.Artifact(
                name=f"tensorboard-{run_name}",
                type="tensorboard-logs",
                description=f"TensorBoard training logs untuk {run_name}"
            )
            artifact.add_dir(log_dir, name=f"tensorboard/{run_name}")
            resumed_run.log_artifact(artifact)
            resumed_run.finish()
            print(f"   [OK] Artifact 'tensorboard-{run_name}' berhasil diupload ke W&B.")
        except Exception as e:
            print(f"   [WARN] Gagal upload artifact ke W&B (log lokal tetap ada): {e}")
        
        total_processed += 1
    
    print(f"\n[DONE] Selesai! {total_processed} run diproses.")
    print(f"[DONE] Semua TensorBoard logs tersedia di folder: ./{OUTPUT_DIR}/")
    print(f"\nUntuk membuka TensorBoard, jalankan:")
    print(f"   tensorboard --logdir {OUTPUT_DIR}")

if __name__ == "__main__":
    main()
