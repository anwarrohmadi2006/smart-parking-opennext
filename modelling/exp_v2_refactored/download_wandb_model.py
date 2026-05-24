import os
import wandb
import shutil

WANDB_API_KEY = "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"
PROJECT_PATH  = "anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Capstone Projek CC26-PRU436"

os.environ["WANDB_API_KEY"] = WANDB_API_KEY

def main():
    print("Connecting to W&B...")
    api = wandb.Api()
    
    # Run 7 logs its artifact as model-CLSTAN_Residual
    artifact_name = f"{PROJECT_PATH}/model-CLSTAN_Residual:latest"
    print(f"Fetching artifact: {artifact_name}")
    
    artifact = api.artifact(artifact_name)
    download_dir = artifact.download()
    print(f"Artifact downloaded to: {download_dir}")
    
    # We copy the model and the scalers from Run 7
    files_to_copy = {
        "CLSTAN_Residual.keras": "best_clstan.keras", # Rename to match API expectation
        "scaler_X.pkl": "scaler_X.pkl",
        "scaler_y.pkl": "scaler_y.pkl",
        "feature_cols.pkl": "feature_cols.pkl"
    }
    
    for src_name, dst_name in files_to_copy.items():
        source_path = os.path.join(download_dir, src_name)
        if os.path.exists(source_path):
            shutil.copy2(source_path, dst_name)
            print(f"✅ Successfully copied {src_name} as {dst_name}")
        else:
            print(f"❌ Error: {src_name} not found in artifact!")

if __name__ == "__main__":
    main()
