import os
import json
import pandas as pd
import numpy as np

def main():
    csv_path = "c:/Users/user/Downloads/next js on opennext github action/modelling/exp_v2_refactored/CNRParkEXT (1).csv"
    output_dir = "c:/Users/user/Downloads/next js on opennext github action/public/data"
    output_file = os.path.join(output_dir, "replay_data.json")
    
    os.makedirs(output_dir, exist_ok=True)
    
    print("Reading CSV...")
    df = pd.read_csv(csv_path, low_memory=False)
    print("CSV read successfully.")
    
    # 1. Clean datetime and convert to pandas datetime object
    dt_series = df['datetime'].astype(str)\
        .str.replace('_', ' ', regex=False)\
        .str.replace('.', ':', regex=False)
    df['timestamp_parsed'] = pd.to_datetime(dt_series, format='mixed', errors='coerce')
    
    df = df.dropna(subset=['timestamp_parsed'])
    df['weather_clean'] = df['weather'].map({'S': 'SUNNY', 'C': 'OVERCAST', 'R': 'RAINY'}).fillna('SUNNY')
    
    # 2. Select 9-Day range (Saturday 2015-11-14 to Sunday 2015-11-22)
    start_date = "2015-11-14 00:00:00"
    end_date = "2015-11-22 23:59:59"
    df_filtered = df[(df['timestamp_parsed'] >= start_date) & (df['timestamp_parsed'] <= end_date)].copy()
    print(f"Filtered date range from {start_date} to {end_date}. Rows: {len(df_filtered)}")
    
    # 3. Get all unique slots and cameras for mapping
    # We want a static mapping of slot_id to camera_id so the frontend knows which slot belongs to which camera
    slot_to_camera = {}
    unique_slots_df = df_filtered.dropna(subset=['slot_id', 'camera']).drop_duplicates('slot_id')
    for _, row in unique_slots_df.iterrows():
        slot_to_camera[str(int(row['slot_id']))] = str(row['camera']).strip()
        
    print(f"Found {len(slot_to_camera)} unique slot mappings.")
    
    # Save the slot-to-camera mapping first to a separate JSON file for easy loading
    mapping_file = os.path.join(output_dir, "slot_camera_mapping.json")
    with open(mapping_file, "w") as f:
        json.dump(slot_to_camera, f, indent=2)
    print(f"Slot-camera mapping saved to {mapping_file}")

    # 4. Resample to 10-minute intervals
    df_filtered = df_filtered.set_index('timestamp_parsed')
    
    # We will resample and group by 10-minute intervals
    resampled = df_filtered.resample('10min')
    
    replay_records = []
    
    # Get a list of all unique slot IDs
    all_slot_ids = sorted(list(slot_to_camera.keys()))
    
    # Maintain state of slots to carry forward if a slot is not updated in a specific 10-minute window
    current_slot_states = {sid: 0 for sid in all_slot_ids}
    
    # Count the number of slots
    total_slots = len(all_slot_ids)
    
    # Get indices
    groups = list(resampled)
    print(f"Generating {len(groups)} replay intervals...")
    
    for idx, (timestamp, group_df) in enumerate(groups):
        if group_df.empty:
            # If the group is empty, carry forward the previous states
            global_occ = sum(current_slot_states.values()) / max(1, total_slots)
            weather = "SUNNY" if len(replay_records) == 0 else replay_records[-1]['weather']
        else:
            # Get weather (majority or first)
            weather = group_df['weather_clean'].iloc[0]
            
            # Update current states with values present in this window
            for _, row in group_df.iterrows():
                try:
                    sid = str(int(row['slot_id']))
                    if sid in current_slot_states:
                        current_slot_states[sid] = int(row['occupancy'])
                except (ValueError, TypeError):
                    continue
            
            global_occ = sum(current_slot_states.values()) / max(1, total_slots)
            
        # Format the record
        record = {
            "timestamp": timestamp.strftime("%Y-%m-%d %H:%M"),
            "weather": weather,
            "global_occupancy": round(float(global_occ), 4),
            "slots": current_slot_states.copy()
        }
        replay_records.append(record)
        
    print(f"Saving {len(replay_records)} replay records to {output_file}...")
    with open(output_file, "w") as f:
        json.dump(replay_records, f)
        
    print("Replay data generation complete!")

if __name__ == "__main__":
    main()
