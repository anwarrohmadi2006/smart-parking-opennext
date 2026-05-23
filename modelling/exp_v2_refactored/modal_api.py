import os
import modal

# Define the Modal App
app = modal.App("smartpark-api")

# Define the container image with CPU support and necessary python packages.
# We mount all required scaler and model artifacts into the container's /root directory.
api_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi",
        "uvicorn",
        "numpy<2.0",
        "pandas",
        "scikit-learn",
        "google-generativeai",
        "tensorflow"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/best_clstan.keras",
        remote_path="/root/best_clstan.keras"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/scaler_X.pkl",
        remote_path="/root/scaler_X.pkl"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/scaler_y.pkl",
        remote_path="/root/scaler_y.pkl"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/feature_cols.pkl",
        remote_path="/root/feature_cols.pkl"
    )
    .add_local_file(
        local_path="C:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/smartpark_api.py",
        remote_path="/root/smartpark_api.py"
    )
)

@app.function(
    image=api_image,
    secrets=[modal.Secret.from_dict({
        "GEMINI_API_KEY": os.environ.get("GEMINI_API_KEY", "YOUR_GEMINI_API_KEY_HERE")
    })]
)
@modal.asgi_app()
def web_app():
    import sys
    sys.path.append("/root")
    
    # Import and serve the FastAPI application from smartpark_api.py
    from smartpark_api import app as fastapi_app
    return fastapi_app
