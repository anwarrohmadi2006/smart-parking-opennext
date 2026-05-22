"use client";

import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useEffect,
  useRef,
} from "react";
import { collection, doc, onSnapshot, setDoc, updateDoc, writeBatch, deleteDoc, query, limit, orderBy, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

// ==========================================
// 1. Tipe Data (Types) & Interfaces
// ==========================================

export interface Config {
  harga_per_jam: number; // Harga parkir per jam (Integer)
  demo_mode: boolean; // Menandakan apakah sistem dalam mode demo (Boolean)
}

export interface Slot {
  id: string; // Contoh: 'A01', 'A02'
  status: "kosong" | "terisi"; // Status slot saat ini
  location: string; // Contoh: 'Blok A'
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
    demo_mode: false,
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

  // Setup initial Firestore data structure if empty
  useEffect(() => {
    const initDb = async () => {
      const slotsSnap = await getDocs(collection(db, "slots"));
      if (slotsSnap.empty) {
        console.log("Initializing Firestore with default data...");
        const batch = writeBatch(db);
        
        // slots
        defaultSlots.forEach((s) => {
          const ref = doc(collection(db, "slots"), s.id);
          batch.set(ref, s);
        });

        // initial config
        const confRef = doc(collection(db, "config"), "default");
        batch.set(confRef, { harga_per_jam: 5000, demo_mode: false });

        await batch.commit();
        console.log("Firestore initialized.");
      }
    };
    initDb();
  }, []);

  // Realtime listeners via Firestore
  useEffect(() => {
    if (isSlowInternet) return; // Simulasi: stop listening saat isSlowInternet

    // Listen to Config
    const unsubConfig = onSnapshot(doc(db, "config", "default"), (docSnap) => {
      setLastSyncTime(Date.now());
      if (docSnap.exists()) {
        setConfig(docSnap.data() as Config);
      }
    });

    // Listen to Slots
    const unsubSlots = onSnapshot(collection(db, "slots"), (snap) => {
      setLastSyncTime(Date.now());
      const newSlots: Slot[] = [];
      snap.forEach((docSnap) => {
        const d = docSnap.data();
        newSlots.push({ id: d.id, status: d.status, location: d.location });
      });
      // sort slots to keep fixed order
      newSlots.sort((a, b) => a.id.localeCompare(b.id));
      if (newSlots.length > 0) setSlots(newSlots);
    });

    // Listen to Vehicles
    const unsubVehicles = onSnapshot(collection(db, "activeVehicles"), (snap) => {
      setLastSyncTime(Date.now());
      const newVehicles: ActiveVehicle[] = [];
      snap.forEach((docSnap) => {
        newVehicles.push(docSnap.data() as ActiveVehicle);
      });
      setActiveVehicles(newVehicles);
    });

    // Listen to Logs
    const qLogs = query(collection(db, "logs"), orderBy("timestamp", "desc"), limit(50));
    const unsubLogs = onSnapshot(qLogs, (snap) => {
      setLastSyncTime(Date.now());
      const newLogs: LogEntry[] = [];
      snap.forEach((docSnap) => {
        newLogs.push(docSnap.data() as LogEntry);
      });
      setLogs(newLogs);
    });

    return () => {
      unsubConfig();
      unsubSlots();
      unsubVehicles();
      unsubLogs();
    };
  }, [isSlowInternet]);

  // Sync to database
  const syncToDB = async (action: string, payload: any) => {
    try {
      if (action === "update_config") {
        await updateDoc(doc(db, "config", "default"), {
          harga_per_jam: payload.harga_per_jam,
          demo_mode: payload.demo_mode,
        });
      } else if (action === "vehicle_in") {
        const batch = writeBatch(db);
        
        // Slot
        batch.update(doc(db, "slots", payload.slotId), { status: "terisi" });
        
        // activeVehicle
        batch.set(doc(db, "activeVehicles", payload.ticketId), {
          ticketId: payload.ticketId,
          slotId: payload.slotId,
          checkInTime: payload.checkInTime,
        });

        // Log
        batch.set(doc(db, "logs", payload.logId), {
          id: payload.logId,
          type: "in",
          timestamp: payload.checkInTime,
        });

        await batch.commit();

      } else if (action === "vehicle_out") {
        const batch = writeBatch(db);
        
        // Slot
        batch.update(doc(db, "slots", payload.slotId), { status: "kosong" });
        
        // Remove activeVehicle
        batch.delete(doc(db, "activeVehicles", payload.ticketId));

        // Add Log
        batch.set(doc(db, "logs", payload.logId), {
          id: payload.logId,
          type: "out",
          timestamp: payload.timestamp,
        });

        await batch.commit();
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

  // Ref untuk menghindari stale closure di dalam setInterval Demo Mode
  const stateRef = useRef({ slots, activeVehicles, exitProcessData, config });
  useEffect(() => {
    stateRef.current = { slots, activeVehicles, exitProcessData, config };
  }, [slots, activeVehicles, exitProcessData, config]);

  // Efek Simulasi Otomatis (Demo Mode)
  useEffect(() => {
    if (!config.demo_mode) return;

    const demoInterval = setInterval(() => {
      const {
        slots: currentSlots,
        activeVehicles: currentVehicles,
        exitProcessData: currentExitData,
        config: currentConfig,
      } = stateRef.current;

      // Jangan simulasikan kalau ada kendaraan yg sedang checkout
      if (currentExitData) return;

      const isEntering = Math.random() > 0.4;
      const availableSlots = currentSlots.filter((s) => s.status === "kosong");

      if (isEntering && availableSlots.length > 0) {
        // [SIMULASI] Kendaraan Masuk
        const randomSlot =
          availableSlots[Math.floor(Math.random() * availableSlots.length)];
        const newTicketId = `DEMO-${Math.floor(Math.random() * 1000)
          .toString()
          .padStart(3, "0")}`;
        const newTime = Date.now();
        const checkInTime =
          newTime - Math.floor(Math.random() * 3 * 3600 * 1000);
        setActiveVehicles((prev) => [
          ...prev,
          {
            ticketId: newTicketId,
            slotId: randomSlot.id,
            // Buat agar durasi masuk sudah beberapa jam lalu supaya ada tagihan
            checkInTime,
          },
        ]);
        setSlots((prev) =>
          prev.map((s) =>
            s.id === randomSlot.id ? { ...s, status: "terisi" } : s,
          ),
        );
        setLogs((prev) => [
          ...prev,
          { id: newTime.toString(), type: "in", timestamp: newTime },
        ]);

        syncToDB("vehicle_in", {
          ticketId: newTicketId,
          slotId: randomSlot.id,
          checkInTime,
          logId: newTime.toString(),
        });
      } else if (!isEntering && currentVehicles.length > 0) {
        // [SIMULASI] Kendaraan Keluar
        const vehicle =
          currentVehicles[Math.floor(Math.random() * currentVehicles.length)];
        const checkoutTime = Date.now();

        const durationMs = checkoutTime - vehicle.checkInTime;
        const durationMinutes = Math.floor(durationMs / (1000 * 60));
        const hours = Math.floor(durationMinutes / 60);
        const mins = durationMinutes % 60;
        const durationString = `${hours} Jam ${mins} Menit`;
        const billableHours = Math.max(1, Math.ceil(durationMinutes / 60));
        const totalCost = billableHours * currentConfig.harga_per_jam;

        // Picu layar checkout
        setPaymentSuccess(false);
        setExitProcessData({
          ticketId: vehicle.ticketId,
          durationString,
          totalCost,
        });

        // Delay sedikit sebelum bayar
        setTimeout(() => {
          setPaymentSuccess(true); // layar hijau

          // Delay hapus data (kendaraan resmi keluar)
          setTimeout(() => {
            const exitTime = Date.now();
            setSlots((prev) =>
              prev.map((s) =>
                s.id === vehicle.slotId ? { ...s, status: "kosong" } : s,
              ),
            );
            setActiveVehicles((prev) =>
              prev.filter((v) => v.ticketId !== vehicle.ticketId),
            );
            setExitProcessData(null);
            setPaymentSuccess(false);
            setLogs((prev) => [
              ...prev,
              { id: exitTime.toString(), type: "out", timestamp: exitTime },
            ]);

            syncToDB("vehicle_out", {
              ticketId: vehicle.ticketId,
              slotId: vehicle.slotId,
              logId: exitTime.toString(),
              timestamp: exitTime,
            });
          }, 3000);
        }, 2000);
      }
    }, 4500); // Trigger setiap 4.5 detik

    return () => clearInterval(demoInterval);
  }, [config.demo_mode]);

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
