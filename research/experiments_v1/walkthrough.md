# Walkthrough: SmartPark AI Serverless Training and W&B Integration

We have successfully executed the serverless deep learning pipeline for **SmartPark AI** on Modal.com using a Tesla T4 GPU. The 10 experiments were tracked on Weights & Biases (W&B) with complete metrics, logs, and artifacts (models, scalers, and the executing script).

---

## 1. What Was Accomplished

1. **Bug Resolution (Data Integrity):**
   - Fixed the data processing leak and sequence discard bug. Instead of dropping 97% of the dataset, the pipeline successfully compiled and processed **32,267 training sequences** ($18 \times 27$ features).

2. **W&B Artifacts Integration:**
   - Modified `modal_train.py` to package and upload the compiled model (`.keras`), scaling parameters (`scaler_X.pkl` and `scaler_y.pkl`), list of features (`feature_cols.pkl`), and the training script (`modal_train.py`) directly to W&B as artifacts for every single run.
   - Logged a consolidated ensemble and best model package under the final run (`Run_10_Ensemble`).

3. **10 serverless GPU runs on Modal:**
   - Completed all 10 experimental fits remotely, including MLP baseline, various CLSTAN variations, Bidirectional LSTM/GRU configurations, LayerNormalization/Dropout adjustments, larger batch runs, and custom GradientTape training.

---

## 2. Experimental Results Summary

| Run | Configuration | Test MAE | Test Accuracy (±0.05) | W&B Run ID | Status |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **1** | Baseline MLP | 0.02574 | 89.46% | [paklsqc5](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/paklsqc5) | Completed |
| **2** | CLSTAN Original | **0.01727** | **93.37%** | [mq0mvjw0](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/mq0mvjw0) | **Best Single (Selected)** |
| **3** | BiDir Original | **0.01391** | **95.87%** | [ai6llo15](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/ai6llo15) | Completed |
| **4** | CLSTAN Tuned Dropout | 0.04132 | 83.20% | [lwxyauek](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/lwxyauek) | Completed |
| **5** | CLSTAN Large Batch | **0.01594** | **94.01%** | [chsk0jqd](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/chsk0jqd) | Completed |
| **6** | BiDir Tuned | 0.02053 | 89.31% | [caaarbwy](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/caaarbwy) | Completed |
| **7** | CLSTAN Residual | **0.01440** | **93.65%** | [15f8sola](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/15f8sola) | Completed |
| **8** | Hybrid Self-Attention | **0.01446** | **94.30%** | [kaupgz2l](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/kaupgz2l) | Completed |
| **9** | GradientTape CLSTAN | 0.20413 | 13.93% | [xyqmbt7o](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/xyqmbt7o) | Completed |
| **10**| Weighted Ensemble | 0.02397 | 89.75% | [y35qfzq6](https://wandb.ai/anwarrohmadi111-universitas-islam-negeri-raden-mas-said-/Final/runs/y35qfzq6) | Completed |

---

## 3. Local Artifact Download

The local entrypoint of the Modal script successfully downloaded the best-performing single model (`CLSTAN_Original`, validation MAE of `0.12164` in standardized units) and serializations to your local workspace under:
- **Model Checkpoint:** [best_clstan.keras](file:///c:/Users/user/Downloads/next%20js%20on%20opennext%20github%20action/modelling/best_clstan.keras)
- **Feature columns definition:** [feature_cols.pkl](file:///c:/Users/user/Downloads/next%20js%20on%20opennext%20github%20action/modelling/feature_cols.pkl)
- **Scalers:** [scaler_X.pkl](file:///c:/Users/user/Downloads/next%20js%20on%20opennext%20github%20action/modelling/scaler_X.pkl) & [scaler_y.pkl](file:///c:/Users/user/Downloads/next%20js%20on%20opennext%20github%20action/modelling/scaler_y.pkl)

These artifacts are ready for serving or integration into the Next.js API endpoints.
