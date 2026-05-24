import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "@/lib/firebase-rtdb";

const firebaseConfig = {
  projectId: "ultra-optics-428313-h6",
  appId: "1:75598703644:web:9fd773089c5c3e9ae3c3d9",
  storageBucket: "ultra-optics-428313-h6.firebasestorage.app",
  apiKey: "AIzaSyDm71ECAe6BBeEA-vGirguOMA6nkit2GeM",
  authDomain: "ultra-optics-428313-h6.firebaseapp.com",
  messagingSenderId: "75598703644",
  measurementId: "",
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    "https://ultra-optics-428313-h6-default-rtdb.asia-southeast1.firebasedatabase.app",
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

// Firestore — hanya untuk occupancy_history (AI prediction)
const db = getFirestore(app, "ai-studio-a41a5c93-aa4f-4502-9bc0-7f8e9ba610fc");

// Firebase Realtime Database — untuk slots, config, activeVehicles, logs
const rtdb = getDatabase(app);

export { app, db, rtdb };
