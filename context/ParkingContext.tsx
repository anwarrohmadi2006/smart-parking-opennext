"use client";

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useRef,
} from "react";

// Firebase Realtime Database — untuk slots, config, activeVehicles, logs
import {
  ref,
  onValue,
  set,
  update,
  remove,
  off,
  get,
  query,
  orderByKey,
  limitToLast,
  type DataSnapshot,
} from "@/lib/firebase-rtdb";
import { rtdb } from "@/lib/firebase";

// Firestore — HANYA untuk occupancy_history (dipakai AI prediction di /api/predict)
import { doc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ==========================================
// 1. Tipe Data (Types) & Interfaces
// ==========================================

export interface Config {
  harga_per_jam: number;
}

export interface Slot {
  id: string; // Contoh: '184'
  status: "kosong" | "terisi"; // Status slot saat ini
  location: string; // Contoh: 'Zona Kamera 01'
  camera?: string; // ID Kamera pemantau (misal: '01')
}

export interface ActiveVehicle {
  ticketId: string; // Contoh: 'TIX-001'
  slotId: string; // Contoh: 'A01'
  checkInTime: number; // Timestamp ketika kendaraan masuk
}

export interface ExitProcessData {
  ticketId: string;
  durationString: string;
  totalCost: number;
}

export interface LogEntry {
  id: string;
  type: "in" | "out";
  timestamp: number;
}

interface ParkingContextType {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
  slots: Slot[];
  setSlots: React.Dispatch<React.SetStateAction<Slot[]>>;
  activeVehicles: ActiveVehicle[];
  setActiveVehicles: React.Dispatch<React.SetStateAction<ActiveVehicle[]>>;
  exitProcessData: ExitProcessData | null;
  setExitProcessData: React.Dispatch<
    React.SetStateAction<ExitProcessData | null>
  >;
  paymentSuccess: boolean;
  setPaymentSuccess: React.Dispatch<React.SetStateAction<boolean>>;
  logs: LogEntry[];
  setLogs: React.Dispatch<React.SetStateAction<LogEntry[]>>;
  isManualClose: boolean;
  setIsManualClose: React.Dispatch<React.SetStateAction<boolean>>;
  isSlowInternet: boolean;
  lastSyncTime: number | null;
  syncToDB: (action: string, payload: any) => Promise<void>;

  // Replay Simulator Extensions
  replayIndex: number;
  setReplayIndex: React.Dispatch<React.SetStateAction<number>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  speed: string;
  setSpeed: React.Dispatch<React.SetStateAction<string>>;
  replayData: any[];
  currentTimestamp: string;
  currentWeather: string;
  injectedScenario: { type: "weather" | "occupancy"; value: any } | null;
  setInjectedScenario: React.Dispatch<React.SetStateAction<{ type: "weather" | "occupancy"; value: any } | null>>;
}

// ==========================================
// 2. Inisiasi Data Awal (Initial State)
// ==========================================

// Membuat Array berisi 24 slot parkir (12 di Blok A, 12 di Blok B)
const defaultSlots: Slot[] = Array.from({ length: 24 }, (_, i) => {
  const floor = Math.floor(i / 8) + 1; // 1, 2, 3
  const num = (i % 8) + 1; // 1 to 8
  const id = `F${floor}-${num.toString().padStart(2, "0")}`;

  return {
    id,
    status: "kosong",
    location: `Blok ${id.startsWith("F1") ? "A" : "B"}`,
  };
});

// Membuat Context
const ParkingContext = createContext<ParkingContextType | undefined>(undefined);

// ==========================================
// 3. Provider Component
// ==========================================

/**
 * ParkingProvider digunakan untuk membungkus komponen di aplikasi kita
 * agar semua komponen turunan bisa mengakses state parkir secara global.
 */
export function ParkingProvider({ children }: { children: ReactNode }) {
  // State untuk Config
  const [config, setConfig] = useState<Config>({
    harga_per_jam: 5000,
  });

  // State untuk Data Slot Parkir
  const [slots, setSlots] = useState<Slot[]>(defaultSlots);

  // State untuk Kendaraan yang sedang Aktif/Parkir
  const [activeVehicles, setActiveVehicles] = useState<ActiveVehicle[]>([]);

  // State untuk Layar Pintu Keluar
  const [exitProcessData, setExitProcessData] =
    useState<ExitProcessData | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);

  // State untuk Log Keluar/Masuk
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // State untuk Fitur Baru (Slow Internet & Manual Close)
  const [isManualClose, setIsManualClose] = useState<boolean>(false);
  const [isSlowInternet, setIsSlowInternet] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<number | null>(null);

  // Replay Simulator States
  const [replayIndex, setReplayIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speed, setSpeed] = useState<string>("off"); // default off (Live Mode)
  const [replayData, setReplayData] = useState<any[]>([]);
  const [slotCameraMap, setSlotCameraMap] = useState<Record<string, string>>({});
  const [injectedScenario, setInjectedScenario] = useState<{ type: "weather" | "occupancy"; value: any } | null>(null);

  // Load replay data & slot mappings
  useEffect(() => {
    fetch("/data/replay_data.json")
      .then((res) => res.json())
      .then((data) => setReplayData(data))
      .catch((err) => console.error("Error loading replay data:", err));

    fetch("/data/slot_camera_mapping.json")
      .then((res) => res.json())
      .then((data) => setSlotCameraMap(data))
      .catch((err) => console.error("Error loading slot camera mapping:", err));
  }, []);

  // Current timestamp and weather from active replay index
  const currentTimestamp = replayData[replayIndex]?.timestamp || "2015-11-16 07:10";
  const currentWeather = injectedScenario?.type === "weather"
    ? injectedScenario.value
    : (replayData[replayIndex]?.weather || "SUNNY");

  // Helper to convert speed to interval ms
  const getIntervalMs = (s: string) => {
    switch (s) {
      case "1x": return 600000;
      case "60x": return 10000;
      case "150x": return 4000;
      case "300x": return 2000;
      case "600x": return 1000;
      case "1200x": return 500;
      default: return 4000;
    }
  };

  // 1. Update slots state when replayIndex, replayData, slotCameraMap, or injectedScenario changes
  useEffect(() => {
    if (replayData.length === 0 || Object.keys(slotCameraMap).length === 0) return;

    const currentData = replayData[replayIndex];
    if (!currentData) return;

    const datasetSlots = currentData.slots || {};
    const injectedOccupiedList = (injectedScenario?.type === "occupancy")
      ? (injectedScenario.value as string[])
      : [];

    const newSlots = Object.keys(slotCameraMap).map((sid) => {
      const camId = slotCameraMap[sid];

      let isOccupied = datasetSlots[sid] === 1;
      if (injectedOccupiedList.includes(sid)) {
        isOccupied = true;
      }

      return {
        id: sid,
        status: isOccupied ? ("terisi" as const) : ("kosong" as const),
        camera: camId,
        location: `Zona Kamera ${camId}`,
      };
    });

    newSlots.sort((a, b) => a.id.localeCompare(b.id));
    setSlots(newSlots);

    // Sync to Realtime DB so other tabs (Entry/Exit dashboards) are perfectly synchronized in real-time!
    if (speed !== "off") {
      const slotsDict: Record<string, any> = {};
      newSlots.forEach((s) => {
        slotsDict[s.id] = s;
      });
      set(ref(rtdb, "slots"), slotsDict).catch((err) => 
        console.error("Error syncing simulation slots to RTDB:", err)
      );
    }
  }, [replayIndex, replayData, slotCameraMap, injectedScenario, speed]);

  // 2. Timer loop for simulation increments
  useEffect(() => {
    if (!isPlaying || speed === "off" || replayData.length === 0) return;

    const intervalMs = getIntervalMs(speed);

    const timer = setInterval(() => {
      setReplayIndex((prev) => (prev + 1) % replayData.length);
    }, intervalMs);

    return () => clearInterval(timer);
  }, [isPlaying, speed, replayData.length]);

  // 3. Sync occupancy history to Firestore every 6 virtual hours (index % 6 === 0)
  // NOTE: occupancy_history tetap di Firestore karena dipakai oleh AI prediction API
  useEffect(() => {
    if (!isPlaying || speed === "off" || replayData.length === 0) return;

    if (replayIndex % 6 === 0) {
      const syncHistory = async () => {
        const dataPoint = replayData[replayIndex];
        if (!dataPoint) return;

        const totalSlotsCount = 164;
        const datasetSlots = dataPoint.slots || {};
        const originalOccupied = Object.values(datasetSlots).filter((v) => v === 1).length;

        let finalOccupied = originalOccupied;
        if (injectedScenario?.type === "occupancy") {
          const injectedList = injectedScenario.value as string[];
          const extraOccupied = injectedList.filter((sid) => datasetSlots[sid] !== 1).length;
          finalOccupied += extraOccupied;
        }

        const rate = Math.min(1.0, finalOccupied / totalSlotsCount);
        const timestampStr = dataPoint.timestamp;

        try {
          const dateObj = new Date(timestampStr.replace(/-/g, "/"));
          const timeMs = dateObj.getTime();

          // Tetap pakai Firestore untuk occupancy_history (dipakai AI prediction)
          await setDoc(doc(db, "occupancy_history", timeMs.toString()), {
            timestamp: timeMs,
            occupancy_rate: rate,
            hour: dateObj.getHours(),
            day_of_week: dateObj.getDay(),
            is_weekend: dateObj.getDay() === 0 || dateObj.getDay() === 6 ? 1 : 0,
            weather: currentWeather
          });
          console.log(`[Simulator Sync] Synced virtual time ${timestampStr} with rate ${rate.toFixed(4)}`);
        } catch (err) {
          console.error("Error syncing occupancy history to Firestore:", err);
        }
      };

      syncHistory();
    }
  }, [replayIndex, isPlaying, speed, replayData, injectedScenario, currentWeather]);

  // Setup initial Realtime Database data structure if empty
  useEffect(() => {
    if (speed === "off" && Object.keys(slotCameraMap).length > 0) {
      console.log("🔄 Simulator dimatikan. Mereset basis data slots dan activeVehicles ke baseline kosong...");
      
      const resetDatabase = async () => {
        try {
          const slotsObj: Record<string, any> = {};
          Object.keys(slotCameraMap).forEach((sid) => {
            const camId = slotCameraMap[sid];
            slotsObj[sid] = {
              id: sid,
              status: "kosong",
              camera: camId,
              location: `Zona Kamera ${camId}`
            };
          });
          
          // Tulis perubahan bersih ke Realtime Database
          await set(ref(rtdb, "slots"), slotsObj);
          await remove(ref(rtdb, "activeVehicles"));
          await remove(ref(rtdb, "logs"));
          
          // Perbarui state lokal klien agar langsung sinkron
          setSlots(Object.keys(slotCameraMap).map((sid) => ({
            id: sid,
            status: "kosong",
            camera: slotCameraMap[sid],
            location: `Zona Kamera ${slotCameraMap[sid]}`
          })));
          setActiveVehicles([]);
          setLogs([]);
          
          console.log("✅ Reset basis data berhasil diselesaikan.");
        } catch (err) {
          console.error("❌ Gagal mereset basis data saat simulator mati:", err);
        }
      };
      
      resetDatabase();
    }
  }, [speed, slotCameraMap]);

  useEffect(() => {
    if (Object.keys(slotCameraMap).length === 0) return;
    const initDb = async () => {
      try {
        // Cek apakah slots sudah ada di Realtime DB
        const slotsSnap = await get(ref(rtdb, "slots"));

        const hasOldSlots = slotsSnap.exists() &&
          Object.keys(slotsSnap.val() || {}).some(k => k.startsWith("F"));

        if (!slotsSnap.exists() || hasOldSlots) {
          console.log("Initializing/Migrating Realtime DB with CNRParkEXT slots...");

          // Bangun objek slots sekaligus (lebih efisien dari Firestore batch)
          const slotsObj: Record<string, object> = {};
          Object.keys(slotCameraMap).forEach((sid) => {
            const camId = slotCameraMap[sid];
            slotsObj[sid] = {
              id: sid,
              status: "kosong",
              camera: camId,
              location: `Zona Kamera ${camId}`
            };
          });

          // Set semua slot sekaligus (1 write ke RTDB, jauh lebih efisien)
          await set(ref(rtdb, "slots"), slotsObj);
          await set(ref(rtdb, "config"), { harga_per_jam: 5000 });

          console.log("Realtime DB initialized.");
        }
      } catch (err) {
        console.error("Error in initDb:", err);
      }
    };
    initDb();
  }, [slotCameraMap]);

  // Realtime listeners via Firebase Realtime Database
  useEffect(() => {
    if (isSlowInternet || isPlaying || speed !== "off") return; // Stop listening when playing/paused simulator to save reads

    // --- Listen to Config ---
    const configRef = ref(rtdb, "config");
    const configHandler = onValue(configRef, (snap: DataSnapshot) => {
      setLastSyncTime(Date.now());
      if (snap.exists()) {
        setConfig(snap.val() as Config);
      }
    });

    // --- Listen to Slots ---
    const slotsRef = ref(rtdb, "slots");
    const slotsHandler = onValue(slotsRef, (snap: DataSnapshot) => {
      setLastSyncTime(Date.now());
      if (snap.exists()) {
        const data = snap.val() as Record<string, Slot>;
        const newSlots: Slot[] = Object.values(data);
        newSlots.sort((a, b) => a.id.localeCompare(b.id));
        if (newSlots.length > 0) setSlots(newSlots);
      }
    });

    // --- Listen to Active Vehicles ---
    const vehiclesRef = ref(rtdb, "activeVehicles");
    const vehiclesHandler = onValue(vehiclesRef, (snap: DataSnapshot) => {
      setLastSyncTime(Date.now());
      if (snap.exists()) {
        const data = snap.val() as Record<string, ActiveVehicle>;
        setActiveVehicles(Object.values(data));
      } else {
        setActiveVehicles([]);
      }
    });

    // --- Listen to Logs (last 50, sorted by key) ---
    const logsQueryRef = query(ref(rtdb, "logs"), orderByKey(), limitToLast(50));
    const logsHandler = onValue(logsQueryRef, (snap: DataSnapshot) => {
      setLastSyncTime(Date.now());
      if (snap.exists()) {
        const data = snap.val() as Record<string, LogEntry>;
        const newLogs: LogEntry[] = Object.values(data);
        // Sort descending by timestamp
        newLogs.sort((a, b) => b.timestamp - a.timestamp);
        setLogs(newLogs);
      } else {
        setLogs([]);
      }
    });

    // Cleanup: lepas semua listener saat effect berakhir
    return () => {
      off(configRef, "value", configHandler);
      off(slotsRef, "value", slotsHandler);
      off(vehiclesRef, "value", vehiclesHandler);
      off(logsQueryRef, "value", logsHandler);
    };
  }, [isSlowInternet, isPlaying, speed]);

  // Sync to Realtime Database
  const syncToDB = async (action: string, payload: any) => {
    try {
      if (action === "update_config") {
        // Update config di Realtime DB
        await update(ref(rtdb, "config"), {
          harga_per_jam: payload.harga_per_jam,
        });

      } else if (action === "vehicle_in") {
        // Update slot status
        await update(ref(rtdb, `slots/${payload.slotId}`), { status: "terisi" });

        // Tambah activeVehicle
        await set(ref(rtdb, `activeVehicles/${payload.ticketId}`), {
          ticketId: payload.ticketId,
          slotId: payload.slotId,
          checkInTime: payload.checkInTime,
        });

        // Tambah log
        await set(ref(rtdb, `logs/${payload.logId}`), {
          id: payload.logId,
          type: "in",
          timestamp: payload.checkInTime,
        });

        // Snapshot history untuk AI prediction — TETAP di Firestore
        const occupiedIn = activeVehicles.length + 1;
        const rateIn = occupiedIn / (slots.length || 164.0);
        const timeIn = Date.now();
        const dateIn = new Date(timeIn);
        await setDoc(doc(db, "occupancy_history", timeIn.toString()), {
          timestamp: timeIn,
          occupancy_rate: rateIn,
          hour: dateIn.getHours(),
          day_of_week: dateIn.getDay(),
          is_weekend: dateIn.getDay() === 0 || dateIn.getDay() === 6 ? 1 : 0,
          weather: "SUNNY"
        });

      } else if (action === "vehicle_out") {
        // Update slot status
        await update(ref(rtdb, `slots/${payload.slotId}`), { status: "kosong" });

        // Hapus activeVehicle
        await remove(ref(rtdb, `activeVehicles/${payload.ticketId}`));

        // Tambah log keluar
        await set(ref(rtdb, `logs/${payload.logId}`), {
          id: payload.logId,
          type: "out",
          timestamp: payload.timestamp,
        });

        // Snapshot history untuk AI prediction — TETAP di Firestore
        const occupiedOut = Math.max(0, activeVehicles.length - 1);
        const rateOut = occupiedOut / (slots.length || 164.0);
        const timeOut = Date.now();
        const dateOut = new Date(timeOut);
        await setDoc(doc(db, "occupancy_history", timeOut.toString()), {
          timestamp: timeOut,
          occupancy_rate: rateOut,
          hour: dateOut.getHours(),
          day_of_week: dateOut.getDay(),
          is_weekend: dateOut.getDay() === 0 || dateOut.getDay() === 6 ? 1 : 0,
          weather: "SUNNY"
        });
      }
    } catch (e) {
      console.error("DB Sync failed:", e);
    }
  };

  // Efek Simulasi Internet Lemot
  useEffect(() => {
    const latensiInterval = setInterval(() => {
      const isSlow = Math.random() > 0.7; // 30% chance internet lambat
      setIsSlowInternet(isSlow);
      if (isSlow) {
        setLastSyncTime(Date.now() - Math.floor(Math.random() * 5 * 60 * 1000)); // last sync 0-5 mins ago
      } else {
        setLastSyncTime(Date.now());
      }
    }, 10000); // Check every 10 seconds

    return () => clearInterval(latensiInterval);
  }, []);



  return (
    <ParkingContext.Provider
      value={{
        config,
        setConfig,
        slots,
        setSlots,
        activeVehicles,
        setActiveVehicles,
        exitProcessData,
        setExitProcessData,
        paymentSuccess,
        setPaymentSuccess,
        logs,
        setLogs,
        isManualClose,
        setIsManualClose,
        isSlowInternet,
        lastSyncTime,
        syncToDB,

        // Replay Simulator Extensions
        replayIndex,
        setReplayIndex,
        isPlaying,
        setIsPlaying,
        speed,
        setSpeed,
        replayData,
        currentTimestamp,
        currentWeather,
        injectedScenario,
        setInjectedScenario
      }}
    >
      {children}
    </ParkingContext.Provider>
  );
}

// ==========================================
// 4. Custom Hook (Untuk kemudahan akses)
// ==========================================

/**
 * Hook `useParking` digunakan di dalam komponen-komponen React untuk
 * membaca dan memodifikasi global state secara mudah.
 */
export function useParking() {
  const context = useContext(ParkingContext);
  if (context === undefined) {
    throw new Error("useParking harus digunakan di dalam ParkingProvider");
  }
  return context;
}
