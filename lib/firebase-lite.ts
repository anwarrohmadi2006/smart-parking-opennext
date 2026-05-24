import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore/lite";

const firebaseConfig = {
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ultra-optics-428313-h6",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:75598703644:web:9fd773089c5c3e9ae3c3d9",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "ultra-optics-428313-h6.firebasestorage.app",
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyDm71ECAe6BBeEA-vGirguOMA6nkit2GeM",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "ultra-optics-428313-h6.firebaseapp.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "75598703644",
  measurementId: ""
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app, "ai-studio-a41a5c93-aa4f-4502-9bc0-7f8e9ba610fc");

export { app, db };
