import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  projectId: "gen-lang-client-0914835553",
  appId: "1:866461062058:web:30ad74796ed78cdbdcd1d3",
  apiKey: "AIzaSyDF_MCDIdyW5J5DLY5pnNn-4Q_zHEmmOzA",
  authDomain: "gen-lang-client-0914835553.firebaseapp.com",
  storageBucket: "gen-lang-client-0914835553.firebasestorage.app",
  messagingSenderId: "866461062058",
  measurementId: ""
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app, "ai-studio-958a91bd-4791-4958-8185-c2c4c67693dc");

export { app, db };
