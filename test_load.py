import modal

app = modal.App("test-load")
image = modal.Image.debian_slim().pip_install("keras==3.14.1", "tensorflow==2.17.0", "h5py")

@app.function(image=image, mounts=[
    modal.Mount.from_local_file("C:/Users/user/Downloads/next js on opennext github action/backend/smartpark_api.py", remote_path="/root/smartpark_api.py"),
    modal.Mount.from_local_file("C:/Users/user/Downloads/next js on opennext github action/research/experiments_final/SmartPark_Capstone_Final_Package (1)/smartpark_outputs/BiDir_Original.keras", remote_path="/root/BiDir_Original.keras")
])
def load_and_test():
    import sys
    sys.path.append("/root")
    import smartpark_api
    import tensorflow as tf
    try:
        model = tf.keras.models.load_model("/root/BiDir_Original.keras", custom_objects={"TemporalAttention": smartpark_api.TemporalAttention})
        print("Model loaded successfully!")
    except Exception as e:
        print(f"Error: {e}")

@app.local_entrypoint()
def main():
    load_and_test.remote()
