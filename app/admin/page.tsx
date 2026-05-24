'use client';

import React, { useState, useEffect } from 'react';
import { useParking } from '@/context/ParkingContext';

export default function DashboardPage() {
  // Mengambil state secara global dari Context
  const { 
    config, 
    setConfig,
    slots, 
    activeVehicles, 
    setSlots, 
    setActiveVehicles,
    setExitProcessData,
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
  } = useParking();

  // Camera filtering state
  const [activeCamera, setActiveCamera] = useState('semua');

  // Helper for formatting simulation virtual timestamps
  const formatVirtualDate = (timestampStr: string) => {
    try {
      const date = new Date(timestampStr.replace(/-/g, "/"));
      const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
      const months = [
        "Januari", "Februari", "Maret", "April", "Mei", "Juni", 
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
      ];
      
      const dayName = days[date.getDay()];
      const dayNum = date.getDate();
      const monthName = months[date.getMonth()];
      const year = date.getFullYear();
      const timeStr = date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
      
      return `${dayName}, ${dayNum} ${monthName} ${year} - ${timeStr}`;
    } catch (e) {
      return timestampStr;
    }
  };

  // Helper to inject occupancy surge
  const injectEmergencyOccupancy = () => {
    const emptySlots = slots.filter((s) => s.status === 'kosong');
    if (emptySlots.length < 30) {
      alert("Slot kosong tidak cukup untuk disuntikkan 30 kendaraan darurat!");
      return;
    }
    
    const shuffled = [...emptySlots].sort(() => 0.5 - Math.random());
    const selectedIds = shuffled.slice(0, 30).map((s) => s.id);
    
    setInjectedScenario({
      type: "occupancy",
      value: selectedIds
    });
  };

  // Local state untuk Admin Checkout Modal
  const [selectedVehicle, setSelectedVehicle] = useState<string | null>(null);

  // Tabs & Features State
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [petugas, setPetugas] = useState([
    { id: 1, nama: 'Andi S.', role: 'Admin Utama', status: 'Shift Pagi' },
    { id: 2, nama: 'Budi R.', role: 'Kasir', status: 'Offline' },
  ]);

  const toggleStatusPetugas = (id: number) => {
    setPetugas(petugas.map(p => {
      if (p.id === id) {
        return { ...p, status: p.status === 'Offline' ? 'Shift Pagi' : 'Offline' };
      }
      return p;
    }));
  };

  const [prediction, setPrediction] = useState({ masuk: 0, keluar: 0, status: '' });

  // Menghitung jumlah slot yang kosong dan terisi
  const availableSlots = slots.filter((slot) => slot.status === 'kosong').length;
  const occupiedSlots = slots.length - availableSlots;
  const occupancyPercentage = slots.length > 0 ? Math.round((occupiedSlots / slots.length) * 100) : 0;

  // Get actual future occupancies for comparison if in simulation mode
  const getActualFutureOccupancy = (offsetMinutes: number) => {
    if (speed === "off" || !replayData || replayData.length === 0) return null;
    const stepsAhead = Math.round(offsetMinutes / 10);
    const targetIndex = replayIndex + stepsAhead;
    if (targetIndex >= replayData.length) return null;
    
    const targetRecord = replayData[targetIndex];
    if (!targetRecord) return null;
    
    return `${Math.round(targetRecord.global_occupancy * 100)}%`;
  };

  // Get historical occupancy sequence for the last 18 frames in simulation mode
  const getSimulationHistory = () => {
    if (speed === "off" || !replayData || replayData.length === 0) return "";
    const history = [];
    for (let i = 17; i >= 0; i--) {
      const idx = Math.max(0, replayIndex - i);
      const record = replayData[idx];
      history.push(record ? record.global_occupancy.toFixed(4) : "0.0000");
    }
    return history.join(",");
  };

  // Menghitung koordinat Y untuk grafik SVG
  const getSvgY = (pctStr: string | undefined | null) => {
    if (!pctStr) return 130; // Fallback bottom
    const val = parseFloat(pctStr.replace('%', ''));
    if (isNaN(val)) return 130;
    return 130 - (val / 100) * 110;
  };

  // Filtered slots for grid view based on active camera tab
  const filteredSlots = activeCamera === 'semua' ? slots : slots.filter(s => s.camera === activeCamera);

  
  // Local state untuk AI Prediction
  const [aiPrediction, setAiPrediction] = useState<{
    prediction_id: string;
    predicted_pct: string;
    predicted_pct_10min?: string;
    predicted_pct_20min?: string;
    confidence: { confidence_pct: number; confidence_level: string };
    recommendation: { urgency: string; actions: string[]; status_flag: string; human_summary: string };
    ai_narrative: string;
    change_rate_per_interval: number;
    source?: string;
  } | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<string | null>(null);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);

  const fetchAiPrediction = async () => {
    setLoadingAi(true);
    setFeedbackSubmitted(null); // Reset feedback status on new prediction load
    const startTime = Date.now();
    try {
      console.groupCollapsed(
        `%c🤖 [SmartPark AI] Memanggil API Cloud ML Inference (Modal.com)...`,
        "color: #3b82f6; font-weight: bold; padding: 2px 4px; background: #e0f2fe; border-radius: 4px;"
      );
      console.log("Endpoint Proxy:", window.location.origin + "/api/predict");
      console.log("Target Cloud ML Host:", "https://anwarrohmadi111--smartpark-api-web-app.modal.run/predict");
      
      const currentRate = occupancyPercentage / 100.0;
      let virtualHour = new Date().getHours();
      if (speed !== "off") {
        try {
          const date = new Date(currentTimestamp.replace(/-/g, "/"));
          virtualHour = date.getHours();
        } catch (e) {}
      }

      const queryParams = new URLSearchParams({
        current_occ: currentRate.toFixed(4),
        weather: currentWeather || "SUNNY",
        hour: virtualHour.toString(),
      });

      if (speed !== "off") {
        queryParams.append("history", getSimulationHistory());
      }

      const res = await fetch(`/api/predict?${queryParams.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const latency = Date.now() - startTime;
        
        console.log("Status HTTP:", res.status);
        console.log("Waktu Respon (Latency):", `${latency}ms`);
        console.log("Payload/Hasil AI:", data);
        
        if (data.source === "Modal.com Cloud ML") {
          console.log(
            `%c✅ BERHASIL: Prediksi dihitung secara real-time oleh model Deep Learning (LSTM + Temporal Attention) di cloud Modal.com!`,
            "color: #10b981; font-weight: bold; background: #ecfdf5; padding: 2px 4px; border-radius: 4px;"
          );
        } else {
          console.warn(
            `%c⚠️ WARNING: Menggunakan Local Rule-based Fallback karena API Cloud offline atau lambat.`,
            "color: #d97706; font-weight: bold; background: #fef3c7; padding: 2px 4px; border-radius: 4px;"
          );
        }
        
        console.groupEnd();
        setAiPrediction(data);
      } else {
        console.error("HTTP Error:", res.status, res.statusText);
        console.groupEnd();
      }
    } catch (err) {
      console.error("🤖 [SmartPark AI] Gagal memuat prediksi AI:", err);
      console.groupEnd();
    } finally {
      setLoadingAi(false);
    }
  };

  const handleFeedback = async (isCorrect: boolean) => {
    if (!aiPrediction) return;
    setSubmittingFeedback(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prediction_id: aiPrediction.prediction_id,
          actual_occupancy: occupancyPercentage / 100.0,
          correct: isCorrect,
          admin_action_taken: `Feedback manual dari admin (Aktual: ${occupancyPercentage}%)`,
        }),
      });

      if (res.ok) {
        setFeedbackSubmitted(aiPrediction.prediction_id);
        console.log(`🤖 [SmartPark AI] Feedback berhasil terkirim untuk Prediksi ID: ${aiPrediction.prediction_id}`);
      } else {
        console.error("Gagal mengirimkan feedback");
      }
    } catch (err) {
      console.error("Error submitting feedback:", err);
    } finally {
      setSubmittingFeedback(false);
    }
  };

  useEffect(() => {
    // Jika simulasi berjalan sangat cepat (300x ke atas), batasi kueri API hanya setiap 1 jam virtual (indeks kelipatan 6)
    if (speed !== "off" && isPlaying) {
      const isVeryFast = speed === "300x" || speed === "600x" || speed === "1200x";
      if (isVeryFast && replayIndex % 6 !== 0) {
        return; // Lewati pemanggilan API untuk mencegah kemacetan jaringan dan overload di Modal.com
      }
    }

    fetchAiPrediction();
    
    // Fallback/Legacy mock calculations for old UI prediction consistency if needed
    let estimasiMasuk = 0;
    let estimasiKeluar = 0;
    let statusPeringatan = 'Aman';

    if (occupancyPercentage < 50) {
      estimasiMasuk = Math.floor(Math.random() * 4) + 2; 
      estimasiKeluar = Math.floor(Math.random() * 2); 
    } else if (occupancyPercentage >= 50 && occupancyPercentage < 85) {
      estimasiMasuk = Math.floor(Math.random() * 3) + 1;
      estimasiKeluar = Math.floor(Math.random() * 3) + 1;
    } else {
      estimasiMasuk = Math.floor(Math.random() * 2); 
      estimasiKeluar = Math.floor(Math.random() * 4) + 2; 
      statusPeringatan = '🔴 Peringatan: Kapasitas Kritis!';
    }
    setPrediction({ masuk: estimasiMasuk, keluar: estimasiKeluar, status: statusPeringatan });
  }, [occupancyPercentage, currentWeather, currentTimestamp, speed, isPlaying, replayIndex]);

  const handleExportCSV = () => {
    if (logs.length === 0) {
      alert("Belum ada data transaksi untuk diekspor.");
      return;
    }
    const headers = 'ID,Type,Timestamp,Action Time';
    const rows = logs.map(log => 
      `${log.id},${log.type},${log.timestamp},${new Date(log.timestamp).toLocaleString('id-ID')}`
    ).join('\n');
    
    const csvContent = `${headers}\n${rows}`;
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Laporan_Parkir_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Track activity last 30 mins
  // eslint-disable-next-line react-hooks/purity
  const thirtyMinsAgo = Date.now() - 30 * 60 * 1000;
  const recentLogs = logs.filter(log => log.timestamp > thirtyMinsAgo);
  const recentIn = recentLogs.filter(log => log.type === 'in').length;
  const recentOut = recentLogs.filter(log => log.type === 'out').length;

  // Fungsi Simulasi Kendaraan Masuk
  const simulateCheckIn = () => {
    // Cari slot yang masih kosong
    const emptySlotIndex = slots.findIndex((s) => s.status === 'kosong');
    if (emptySlotIndex === -1) {
      alert('Mohon maaf, semua slot sedang penuh!');
      return;
    }

    const slot = slots[emptySlotIndex];
    const newTicketId = `TIX-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    
    const checkInTime = Date.now() - Math.floor(Math.random() * 5 * 3600 * 1000);
    const logId = Date.now().toString();
    
    // 1. Update State Kendaraan Aktif
    setActiveVehicles((prev) => [
      ...prev,
      {
        ticketId: newTicketId,
        slotId: slot.id,
        checkInTime: checkInTime,
      },
    ]);

    // 2. Update Status Slot Menjadi "terisi"
    const updatedSlots = [...slots];
    updatedSlots[emptySlotIndex] = { ...slot, status: 'terisi' };
    setSlots(updatedSlots);
    setLogs(prev => [...prev, { id: logId, type: 'in', timestamp: Date.now() }]);
    
    syncToDB('vehicle_in', { ticketId: newTicketId, slotId: slot.id, checkInTime, logId });
  };

  const handleInitiateCheckout = (ticketId: string) => {
    setSelectedVehicle(ticketId);
    
    const vehicle = activeVehicles.find(v => v.ticketId === ticketId);
    if (!vehicle) return;

    // eslint-disable-next-line react-hooks/purity
    const checkoutTime = Date.now();
    const durationMs = checkoutTime - vehicle.checkInTime;
    const durationMinutes = Math.floor(durationMs / (1000 * 60));
    
    const hours = Math.floor(durationMinutes / 60);
    const mins = durationMinutes % 60;
    const durationString = `${hours} Jam ${mins} Menit`;
    
    // For demo: minimum 1 hour if less than 60 mins
    const billableHours = Math.max(1, Math.ceil(durationMinutes / 60));
    const totalCost = billableHours * config.harga_per_jam;

    // Trigger state untuk Exit Display
    setPaymentSuccess(false);
    setExitProcessData({
      ticketId: vehicle.ticketId,
      durationString,
      totalCost
    });
  };

  const confirmPayment = () => {
    if (!selectedVehicle) return;
    
    // Set success for exit display to show "Pembayaran Berhasil"
    setPaymentSuccess(true);
    
    const vehicle = activeVehicles.find(v => v.ticketId === selectedVehicle);
    
    setTimeout(() => {
      // 1. Release the slot
      if (vehicle) {
        setSlots(prev => prev.map(slot => 
          slot.id === vehicle.slotId ? { ...slot, status: 'kosong' } : slot
        ));
      }
      
      // 2. Remove from active vehicles
      setActiveVehicles(prev => prev.filter(v => v.ticketId !== selectedVehicle));
      
      // 3. Clear exit display
      setExitProcessData(null);
      setPaymentSuccess(false);
      setSelectedVehicle(null);
      
      if (vehicle) {
        const exitTime = Date.now();
        setLogs(prev => [...prev, { id: exitTime.toString(), type: 'out', timestamp: exitTime }]);
        syncToDB('vehicle_out', { ticketId: vehicle.ticketId, slotId: vehicle.slotId, logId: exitTime.toString(), timestamp: exitTime });
      }
    }, 4000);
  };

  return (
    <main className="h-screen bg-slate-50 font-sans flex flex-col md:flex-row overflow-hidden relative">
      
      {/* ==================================================== 
          BAGIAN ADMIN (KIRI) - Nuansa Gelap (Deep Blue/Slate)
          ==================================================== */}
      <section className="bg-slate-900 text-white w-full md:w-96 shrink-0 flex flex-col p-6 overflow-y-auto border-r border-slate-800 shadow-xl z-20">
        <h1 className="text-xl font-bold mb-1 tracking-tight">ParkSystem <span className="text-blue-400">Admin</span></h1>
        <div className="flex items-center justify-between mb-6">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">
            Global Config
          </p>
          <button
            onClick={() => {
              const newConfig = { ...config, demo_mode: !config.demo_mode };
              setConfig(newConfig);
              syncToDB("update_config", newConfig);
            }}
            className={`px-3 py-1 text-xs font-bold rounded-full transition-colors shadow-sm ${
              config.demo_mode 
                ? 'bg-amber-500 text-amber-950 hover:bg-amber-400' 
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            {config.demo_mode ? 'DEMO IS ON' : 'DEMO IS OFF'}
          </button>
        </div>

        {/* Sidebar Nav (Newly Requested) */}
        <nav className="mb-6 space-y-2">
          <div 
            onClick={() => setActiveTab('dashboard')}
            className={`p-3 font-medium cursor-pointer rounded-r-lg transition-colors ${activeTab === 'dashboard' ? 'bg-blue-600/20 border-l-4 border-blue-500 text-blue-400' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
          >
            Dashboard Overview
          </div>
          <div 
            onClick={() => setActiveTab('laporan')}
            className={`p-3 font-medium cursor-pointer rounded-r-lg transition-colors ${activeTab === 'laporan' ? 'bg-blue-600/20 border-l-4 border-blue-500 text-blue-400' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
          >
            Laporan &amp; Ekspor Data
          </div>
          <div 
            onClick={() => setActiveTab('petugas')}
            className={`p-3 font-medium cursor-pointer rounded-r-lg transition-colors ${activeTab === 'petugas' ? 'bg-blue-600/20 border-l-4 border-blue-500 text-blue-400' : 'text-slate-400 hover:text-white hover:bg-slate-800/50'}`}
          >
            Ngatur Petugas
          </div>
        </nav>

        <div className="bg-slate-800/50 rounded-xl p-5 mb-6 border border-slate-700/50">
          <h2 className="text-sm font-bold text-white mb-3">Configuration</h2>
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm text-slate-400">Rate / Hour</span>
            <span className="font-mono text-sm font-bold text-blue-400">Rp {config.harga_per_jam.toLocaleString('id-ID')}</span>
          </div>
          <input 
            type="range" 
            min="1000" 
            max="25000" 
            step="1000" 
            value={config.harga_per_jam} 
            onChange={(e) => setConfig({...config, harga_per_jam: parseInt(e.target.value)})} 
            onMouseUp={() => syncToDB('update_config', config)}
            onTouchEnd={() => syncToDB('update_config', config)}
            className="w-full accent-blue-500" 
          />
        </div>



        <div className="bg-slate-800/50 rounded-xl p-5 flex-grow border border-slate-700/50 flex flex-col">
          <h2 className="text-sm font-bold text-white mb-4 flex justify-between items-center">
            <span>Active Vehicles</span>
            <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">{activeVehicles.length}</span>
          </h2>
          {activeVehicles.length === 0 ? (
            <p className="text-xs font-medium text-slate-500 italic">No vehicles currently parked.</p>
          ) : (
            <ul className="space-y-3 overflow-y-auto pr-2">
              {activeVehicles.map((vehicle) => (
                <li key={vehicle.ticketId} className={`bg-slate-900 p-3 rounded-lg border flex flex-col shadow-sm transition-colors ${selectedVehicle === vehicle.ticketId ? 'border-blue-500' : 'border-slate-700'}`}>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-xs font-bold text-slate-200">{vehicle.ticketId}</p>
                    <span className="bg-blue-600 border border-blue-500 text-white px-2 py-1 space-x-1 rounded text-[10px] font-bold font-mono shadow-inner">
                      {vehicle.slotId}
                    </span>
                  </div>
                  <div className="flex justify-between items-end mt-1">
                    <p className="text-[10px] text-slate-400">
                      In: {new Date(vehicle.checkInTime).toLocaleTimeString('id-ID', {hour: '2-digit', minute:'2-digit'})}
                    </p>
                    <button 
                      onClick={() => handleInitiateCheckout(vehicle.ticketId)}
                      disabled={selectedVehicle !== null}
                      className="text-[10px] uppercase font-bold text-blue-400 hover:text-blue-300 active:text-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Checkout
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>


      {/* ==================================================== 
          BAGIAN USER (KANAN) - Nuansa Terang (Clean/White)
          ==================================================== */}
      <section className="flex-1 bg-slate-50 flex flex-col overflow-y-auto w-full">
        
        {/* Banner Internet Lambat */}
        {isSlowInternet && (
          <div className="bg-amber-100 text-amber-800 text-xs sm:text-sm font-semibold px-4 py-2 flex items-center justify-center border-b border-amber-200">
            <span className="mr-2">⚠️</span>
            Koneksi internet lambat. Menampilkan data terakhir pada {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('id-ID') : '--:--'}. Sedang mencoba menyinkronkan ulang...
          </div>
        )}

        <header className="h-20 bg-white border-b border-slate-200 px-6 sm:px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4 sm:gap-8">
             <div>
               <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-800">
                 {activeTab === 'dashboard' && 'Dashboard Overview'}
                 {activeTab === 'laporan' && 'Laporan & Ekspor Data'}
                 {activeTab === 'petugas' && 'Manajemen Petugas'}
               </h1>
             </div>
             <div className="hidden sm:block w-px h-8 bg-slate-200"></div>
             
             {/* Tombol Akses Masuk Manual */}
             <button
               onClick={() => setIsManualClose(!isManualClose)}
               className={`hidden sm:flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-sm active:scale-95 uppercase tracking-wider ${
                 isManualClose 
                   ? 'bg-rose-50 text-rose-600 border border-rose-200 hover:bg-rose-100'
                   : 'bg-rose-600 text-white border border-rose-700 hover:bg-rose-700'
               }`}
             >
               {isManualClose ? 'BUKA AKSES MASUK (NORMAL)' : 'TUTUP AKSES MASUK MANUAL'}
             </button>

          </div>
          
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 border border-green-100 rounded-full text-xs font-semibold">
               <span className="w-2 h-2 bg-green-500 rounded-full"></span>
               SYSTEM ONLINE
             </div>
            <button 
              onClick={simulateCheckIn}
              disabled={isManualClose || availableSlots === 0}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors shadow-sm active:scale-95 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
            >
              + Check-in Vehicle
            </button>
          </div>
        </header>

        <div className="p-6 sm:p-8 flex flex-col gap-6 max-w-5xl mx-auto w-full">
          
          {activeTab === 'dashboard' && (
            <>
              {/* PANEL SIMULASI CONTROL ROOM (Premium Glassmorphism Design) */}
              <div className="bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-2xl p-6 shadow-2xl text-slate-100 mb-6 relative overflow-hidden">
                {/* Background ambient light */}
                <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/5 rounded-full blur-3xl pointer-events-none"></div>
                <div className="absolute bottom-0 left-0 w-64 h-64 bg-amber-500/5 rounded-full blur-3xl pointer-events-none"></div>

                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6 relative z-10">
                  <div>
                    <div className="flex items-center gap-3">
                      <span className="relative flex h-3 w-3">
                        {speed === "off" ? (
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500 shadow-[0_0_10px_#10b981]"></span>
                        ) : isPlaying ? (
                          <>
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                          </>
                        ) : (
                          <span className="relative inline-flex rounded-full h-3 w-3 bg-slate-500"></span>
                        )}
                      </span>
                      <h2 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                        9-Day Replay Control Room
                        {speed === "off" ? (
                          <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/40 px-2 py-0.5 rounded-full font-mono uppercase tracking-widest">
                            Live Mode
                          </span>
                        ) : (
                          <span className="text-[10px] bg-amber-950 text-amber-400 border border-amber-800/40 px-2 py-0.5 rounded-full font-mono uppercase tracking-widest">
                            Simulation Mode ({speed})
                          </span>
                        )}
                      </h2>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {speed === "off" 
                        ? "Menampilkan data okupansi real-time yang aktif dari database Firestore."
                        : `Menjalankan simulasi data parkir 9 hari berturut-turut berdasarkan dataset CNRParkEXT (164 slot).`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {speed !== "off" && (
                      <button
                        onClick={() => {
                          setIsPlaying(false);
                          setSpeed("off");
                          setInjectedScenario(null);
                        }}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold rounded-lg border border-slate-700/80 transition-all hover:scale-105 active:scale-95 shadow-sm"
                      >
                        Kembali ke Live Mode
                      </button>
                    )}
                  </div>
                </div>

                {/* Media Controls & Speed Selection */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center bg-slate-950/40 border border-slate-800/50 p-4 rounded-xl mb-6 relative z-10">
                  {/* Part 1: Media Player Buttons */}
                  <div className="flex items-center justify-center lg:justify-start gap-3">
                    <button
                      onClick={() => {
                        if (speed === "off") setSpeed("150x");
                        setReplayIndex((prev) => (prev > 0 ? prev - 1 : 927));
                      }}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-700 transition-all hover:scale-105 active:scale-95"
                      title="Step Backward (Prev 10 Min)"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M8.445 14.832A1 1 0 0010 14v-2.798l5.445 3.63A1 1 0 0017 14V6a1 1 0 00-1.555-.832L10 8.8V6a1 1 0 00-1.555-.832l-6 4a1 1 0 000 1.664l6 4z"/></svg>
                    </button>

                    <button
                      onClick={() => {
                        if (speed === "off") {
                          setSpeed("150x");
                        }
                        setIsPlaying(!isPlaying);
                      }}
                      className={`p-3 rounded-lg border transition-all hover:scale-105 active:scale-95 ${
                        isPlaying 
                          ? 'bg-amber-500 hover:bg-amber-400 text-amber-950 border-amber-600' 
                          : 'bg-blue-600 hover:bg-blue-500 text-white border-blue-700'
                      }`}
                      title={isPlaying ? "Pause Simulation" : "Play Simulation"}
                    >
                      {isPlaying ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
                      ) : (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd"/></svg>
                      )}
                    </button>

                    <button
                      onClick={() => {
                        if (speed === "off") setSpeed("150x");
                        setReplayIndex((prev) => (prev + 1) % 928);
                      }}
                      className="p-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg border border-slate-700 transition-all hover:scale-105 active:scale-95"
                      title="Step Forward (Next 10 Min)"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M4.555 5.168A1 1 0 003 6v8a1 1 0 001.555.832L10 11.202V14a1 1 0 001.555.832l6-4a1 1 0 000-1.664l-6-4A1 1 0 0010 6v2.798L4.555 5.168z"/></svg>
                    </button>
                  </div>

                  {/* Part 2: Speed Warp Slider */}
                  <div className="flex flex-col gap-1.5 w-full">
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      <span>Kecepatan Replay</span>
                      <span className="text-amber-400 font-mono">{speed === "off" ? "Off (Live)" : speed}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="range"
                        min={0}
                        max={6}
                        value={
                          speed === "off" ? 0 : 
                          speed === "1x" ? 1 : 
                          speed === "60x" ? 2 : 
                          speed === "150x" ? 3 : 
                          speed === "300x" ? 4 : 
                          speed === "600x" ? 5 : 6
                        }
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          const speeds = ["off", "1x", "60x", "150x", "300x", "600x", "1200x"];
                          const newSpeed = speeds[val];
                          setSpeed(newSpeed);
                          if (newSpeed === "off") {
                            setIsPlaying(false);
                            setInjectedScenario(null);
                          } else {
                            setIsPlaying(true);
                          }
                        }}
                        className="w-full accent-blue-500 cursor-pointer h-1.5 bg-slate-800 rounded-lg appearance-none"
                      />
                    </div>
                    <div className="flex justify-between text-[8px] text-slate-500 font-mono">
                      <span>OFF</span>
                      <span>1x</span>
                      <span>60x</span>
                      <span>150x</span>
                      <span>300x</span>
                      <span>600x</span>
                      <span>1200x</span>
                    </div>
                  </div>

                  {/* Part 3: Status Details */}
                  <div className="flex flex-col items-center lg:items-end justify-center gap-1">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
                      <span>Cuaca virtual:</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        currentWeather === 'RAINY' 
                          ? 'bg-blue-950 text-blue-400 border border-blue-800/40' 
                          : 'bg-amber-950 text-amber-400 border border-amber-800/40'
                      }`}>
                        {currentWeather === 'RAINY' ? '🌧️ HUJAN LEBAT' : '☀️ CERAH'}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono text-center lg:text-right mt-1">
                      Hari virtual ke-{(Math.floor(replayIndex / 108) + 1)} / 9
                    </div>
                  </div>
                </div>

                {/* Timeline Seek Bar */}
                <div className="space-y-2 mb-6 relative z-10">
                  <div className="flex justify-between text-xs font-bold">
                    <span className="text-blue-400 font-mono">
                      {formatVirtualDate(currentTimestamp)}
                    </span>
                    <span className="text-slate-400 font-mono">
                      Frame {replayIndex + 1} / 928
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={927}
                    value={replayIndex}
                    onChange={(e) => {
                      if (speed === "off") setSpeed("150x"); // enter simulation mode
                      setReplayIndex(parseInt(e.target.value));
                    }}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
                  />
                  <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                    <span>16 Nov (Awal)</span>
                    <span>Weekend 1</span>
                    <span>20 Nov (Tengah)</span>
                    <span>Weekend 2</span>
                    <span>25 Nov (Akhir)</span>
                  </div>
                </div>

                {/* "What-If" Scenario Injectors */}
                <div className="bg-slate-950/60 border border-slate-800/80 p-4 rounded-xl relative z-10">
                  <div className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-3 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-blue-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    "What-If" Scenario Injector (Simulator)
                  </div>
                  
                  <div className="flex flex-wrap gap-3">
                    <button
                      onClick={() => {
                        if (speed === "off") setSpeed("150x");
                        setInjectedScenario({ type: "weather", value: "RAINY" });
                      }}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                        injectedScenario?.type === "weather" && injectedScenario.value === "RAINY"
                          ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-500/20"
                          : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800"
                      }`}
                    >
                      🌧️ Suntik Hujan Lebat
                    </button>

                    <button
                      onClick={injectEmergencyOccupancy}
                      className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all ${
                        injectedScenario?.type === "occupancy"
                          ? "bg-red-600 border-red-500 text-white shadow-lg shadow-red-500/20"
                          : "bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800"
                      }`}
                    >
                      🚨 Suntik Kendaraan Darurat (+30 Slot)
                    </button>

                    {injectedScenario && (
                      <button
                        onClick={() => setInjectedScenario(null)}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                      >
                        Reset Skenario
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {/* PREDIKSI & OKUPANSI */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Card 1: Okupansi Saat Ini */}
                <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-lg border border-slate-800 flex flex-col justify-between min-h-[220px]">
                  <div>
                    <div className="flex justify-between items-center mb-4">
                      <h2 className="text-xl font-bold tracking-tight">Status Okupansi Saat Ini</h2>
                      <span className="text-xs bg-slate-800 text-slate-400 px-3 py-1 rounded-full border border-slate-700 font-mono">Real-time</span>
                    </div>
                    <div className="flex items-baseline gap-2 mb-2">
                      <span className="text-5xl font-black font-mono text-blue-400">{occupancyPercentage}%</span>
                      <span className="text-slate-500 text-sm">keterisian lahan</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-6 font-medium">Terisi: {occupiedSlots} slot | Tersedia: {availableSlots} slot</p>
                  </div>
                  <div className="w-full bg-slate-800 h-4 rounded-full mb-2 relative overflow-hidden shadow-inner">
                    <div 
                      className={`h-4 rounded-full transition-all duration-500 ${occupancyPercentage > 85 ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]'}`} 
                      style={{ width: `${occupancyPercentage}%` }}
                    ></div>
                  </div>
                </div>

                {/* Card 2: AI Asisten Cerdas (Model CLSTAN) */}
                <div className="bg-slate-950 text-white p-6 rounded-2xl shadow-xl border border-blue-500/20 relative overflow-hidden min-h-[220px] flex flex-col justify-between">
                  {/* Background glowing aura */}
                  <div className="absolute -top-12 -right-12 w-32 h-32 bg-blue-600/10 rounded-full blur-2xl"></div>
                  
                  <div>
                    <div className="flex justify-between items-center mb-4 relative z-10">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-blue-600/20 border border-blue-500/30 rounded-lg flex items-center justify-center animate-pulse">
                          <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                        </div>
                        <h2 className="text-md font-bold tracking-wider text-slate-100 uppercase">SmartPark AI Assistant</h2>
                      </div>
                      {loadingAi ? (
                        <span className="text-[10px] bg-slate-800 text-blue-400 px-2 py-0.5 rounded font-mono animate-pulse">Analyzing...</span>
                      ) : aiPrediction?.source ? (
                        <span className="text-[10px] bg-blue-950/80 text-blue-400 border border-blue-800/50 px-2.5 py-0.5 rounded font-mono flex items-center gap-1.5" title={`Sumber: ${aiPrediction.source}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${aiPrediction.source.includes("Cloud") ? "bg-emerald-500 animate-pulse" : "bg-amber-500 animate-pulse"}`}></span>
                          {aiPrediction.source.includes("Cloud") ? "Modal.com Cloud" : "Local Fallback"}
                        </span>
                      ) : (
                        <span className="text-[10px] bg-blue-900/50 text-blue-400 border border-blue-800/50 px-2 py-0.5 rounded font-mono">Model CLSTAN</span>
                      )}
                    </div>

                    {aiPrediction ? (
                      <div className="space-y-4 relative z-10">
                        <div className="flex justify-between items-center bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
                          <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Prediksi Okupansi (30 Menit)</p>
                            <div className="flex items-center gap-2">
                              <p className="text-3xl font-black font-mono text-emerald-400 tracking-tight">{aiPrediction.predicted_pct}</p>
                              {getActualFutureOccupancy(30) !== null && (
                                <span className="text-[10px] text-slate-300 font-bold whitespace-nowrap bg-blue-950/80 border border-blue-800/40 px-2.5 py-1 rounded-lg">
                                  Aktual: <span className="text-blue-400 font-black">{getActualFutureOccupancy(30)}</span>
                                </span>
                              )}
                              {aiPrediction.change_rate_per_interval !== undefined && (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border flex items-center gap-1 ${
                                  aiPrediction.change_rate_per_interval > 0.005 
                                    ? 'bg-rose-950/80 text-rose-400 border-rose-800/30' 
                                    : aiPrediction.change_rate_per_interval < -0.005 
                                    ? 'bg-emerald-950/80 text-emerald-400 border-emerald-800/30' 
                                    : 'bg-slate-800/80 text-slate-400 border-slate-700/30'
                                }`} title={`Laju perubahan: ${aiPrediction.change_rate_per_interval.toFixed(4)}`}>
                                  {aiPrediction.change_rate_per_interval > 0.005 ? "↗️ Mengisi" : aiPrediction.change_rate_per_interval < -0.005 ? "↘️ Sepi" : "➡️ Stabil"}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Model Confidence</p>
                            <span className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-black border ${
                              aiPrediction.confidence.confidence_level === "TINGGI" 
                                ? 'bg-emerald-950 text-emerald-400 border-emerald-800/30' 
                                : 'bg-amber-950 text-amber-400 border-amber-800/30'
                            }`}>
                              {aiPrediction.confidence.confidence_level} ({aiPrediction.confidence.confidence_pct}%)
                            </span>
                          </div>
                        </div>

                        {/* Timeline Prediksi 10m | 20m | 30m */}
                        <div className="bg-slate-900/40 p-3.5 rounded-xl border border-slate-800/60 text-xs">
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Estimasi Alur Okupansi (Timeline)</p>
                          <div className="relative flex items-center justify-between mt-2 px-2">
                            {/* Horizontal Line under the points */}
                            <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-[2px] bg-slate-800 z-0"></div>
                            
                            {/* Node 1: Current */}
                            <div className="flex flex-col items-center relative z-10">
                              <span className="w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-slate-950 flex items-center justify-center"></span>
                              <span className="text-[9px] text-slate-400 font-medium mt-1">Saat Ini</span>
                              <span className="text-[11px] font-bold text-slate-200 font-mono mt-0.5">{occupancyPercentage}%</span>
                            </div>

                            {/* Node 2: 10 Min */}
                            <div className="flex flex-col items-center relative z-10">
                              <span className="w-3.5 h-3.5 rounded-full bg-blue-400 border-2 border-slate-950 flex items-center justify-center"></span>
                              <span className="text-[9px] text-slate-400 font-medium mt-1">+10 Mins</span>
                              <span className="text-[11px] font-bold text-blue-300 font-mono mt-0.5">{aiPrediction.predicted_pct_10min || `${occupancyPercentage}%`}</span>
                              {getActualFutureOccupancy(10) !== null && (
                                <span className="text-[9px] text-slate-500 font-mono mt-0.5">
                                  Aktual: <span className="text-slate-300 font-semibold">{getActualFutureOccupancy(10)}</span>
                                </span>
                              )}
                            </div>

                            {/* Node 3: 20 Min */}
                            <div className="flex flex-col items-center relative z-10">
                              <span className="w-3.5 h-3.5 rounded-full bg-indigo-400 border-2 border-slate-950 flex items-center justify-center"></span>
                              <span className="text-[9px] text-slate-400 font-medium mt-1">+20 Mins</span>
                              <span className="text-[11px] font-bold text-indigo-300 font-mono mt-0.5">{aiPrediction.predicted_pct_20min || `${occupancyPercentage}%`}</span>
                              {getActualFutureOccupancy(20) !== null && (
                                <span className="text-[9px] text-slate-500 font-mono mt-0.5">
                                  Aktual: <span className="text-slate-300 font-semibold">{getActualFutureOccupancy(20)}</span>
                                </span>
                              )}
                            </div>

                            {/* Node 4: 30 Min (CLSTAN) */}
                            <div className="flex flex-col items-center relative z-10">
                              <span className="w-3.5 h-3.5 rounded-full bg-emerald-400 border-2 border-slate-950 flex items-center justify-center shadow-[0_0_8px_rgba(52,211,153,0.5)]"></span>
                              <span className="text-[9px] text-emerald-400 font-semibold mt-1" title="Dihitung oleh model CLSTAN">+30 Mins*</span>
                              <span className="text-[11px] font-bold text-emerald-400 font-mono mt-0.5">{aiPrediction.predicted_pct}</span>
                              {getActualFutureOccupancy(30) !== null && (
                                <span className="text-[9px] text-slate-500 font-mono mt-0.5">
                                  Aktual: <span className="text-emerald-400 font-bold">{getActualFutureOccupancy(30)}</span>
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-[8px] text-slate-500 italic mt-3 text-right">
                            *Prediksi 30m dihitung oleh model CLSTAN, sedangkan 10m &amp; 20m diinterpolasikan linier.
                          </p>
                        </div>

                        {/* Grafik Realtime Perbandingan Aktual vs Prediksi */}
                        {speed !== "off" && getActualFutureOccupancy(30) !== null && (
                          <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80">
                            <div className="flex justify-between items-center mb-2 px-1">
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Visualisasi Perbandingan Aktual vs Prediksi</p>
                              <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-wider">
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                                  <span className="text-emerald-400">Prediksi</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                                  <span className="text-blue-400">Aktual</span>
                                </div>
                              </div>
                            </div>

                            <div className="relative w-full h-[150px] bg-slate-950/50 rounded-lg overflow-hidden border border-slate-900/80">
                              {/* Grid lines */}
                              <svg className="w-full h-full animate-fade-in" viewBox="0 0 500 150" preserveAspectRatio="none">
                                <defs>
                                  {/* Gradients */}
                                  <linearGradient id="predGlow" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#10b981" stopOpacity="0.2"/>
                                    <stop offset="100%" stopColor="#10b981" stopOpacity="0.0"/>
                                  </linearGradient>
                                  <linearGradient id="actGlow" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.2"/>
                                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0"/>
                                  </linearGradient>
                                </defs>

                                {/* Horizontal reference lines */}
                                <line x1="40" y1="20" x2="460" y2="20" stroke="#1e293b" strokeWidth="1" strokeDasharray="3,3" />
                                <line x1="40" y1="75" x2="460" y2="75" stroke="#1e293b" strokeWidth="1" strokeDasharray="3,3" />
                                <line x1="40" y1="130" x2="460" y2="130" stroke="#1e293b" strokeWidth="1" />

                                {/* Vertical grid lines */}
                                <line x1="40" y1="20" x2="40" y2="130" stroke="#1e293b" strokeWidth="1" />
                                <line x1="180" y1="20" x2="180" y2="130" stroke="#1e293b" strokeWidth="1" strokeDasharray="3,3" />
                                <line x1="320" y1="20" x2="320" y2="130" stroke="#1e293b" strokeWidth="1" strokeDasharray="3,3" />
                                <line x1="460" y1="20" x2="460" y2="130" stroke="#1e293b" strokeWidth="1" />

                                {/* Y-axis Labels */}
                                <text x="10" y="24" fill="#64748b" fontSize="8" fontWeight="bold" fontFamily="monospace">100%</text>
                                <text x="15" y="79" fill="#64748b" fontSize="8" fontWeight="bold" fontFamily="monospace">50%</text>
                                <text x="20" y="134" fill="#64748b" fontSize="8" fontWeight="bold" fontFamily="monospace">0%</text>

                                {/* X-axis Labels */}
                                <text x="40" y="145" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">Saat Ini</text>
                                <text x="180" y="145" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">+10m</text>
                                <text x="320" y="145" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">+20m</text>
                                <text x="460" y="145" fill="#64748b" fontSize="8" fontWeight="bold" textAnchor="middle">+30m</text>

                                {/* Actual Glow Area */}
                                <path 
                                  d={`M 40,130 L 40,${getSvgY(`${occupancyPercentage}%`)} L 180,${getSvgY(getActualFutureOccupancy(10) || `${occupancyPercentage}%`)} L 320,${getSvgY(getActualFutureOccupancy(20) || `${occupancyPercentage}%`)} L 460,${getSvgY(getActualFutureOccupancy(30) || `${occupancyPercentage}%`)} L 460,130 Z`} 
                                  fill="url(#actGlow)"
                                />

                                {/* Predicted Glow Area */}
                                <path 
                                  d={`M 40,130 L 40,${getSvgY(`${occupancyPercentage}%`)} L 180,${getSvgY(aiPrediction?.predicted_pct_10min || `${occupancyPercentage}%`)} L 320,${getSvgY(aiPrediction?.predicted_pct_20min || `${occupancyPercentage}%`)} L 460,${getSvgY(aiPrediction?.predicted_pct || `${occupancyPercentage}%`)} L 460,130 Z`} 
                                  fill="url(#predGlow)"
                                />

                                {/* Actual Line */}
                                <path 
                                  d={`M 40,${getSvgY(`${occupancyPercentage}%`)} L 180,${getSvgY(getActualFutureOccupancy(10) || `${occupancyPercentage}%`)} L 320,${getSvgY(getActualFutureOccupancy(20) || `${occupancyPercentage}%`)} L 460,${getSvgY(getActualFutureOccupancy(30) || `${occupancyPercentage}%`)}`} 
                                  fill="none" 
                                  stroke="#3b82f6" 
                                  strokeWidth="3" 
                                  strokeLinecap="round"
                                />

                                {/* Predicted Line */}
                                <path 
                                  d={`M 40,${getSvgY(`${occupancyPercentage}%`)} L 180,${getSvgY(aiPrediction?.predicted_pct_10min || `${occupancyPercentage}%`)} L 320,${getSvgY(aiPrediction?.predicted_pct_20min || `${occupancyPercentage}%`)} L 460,${getSvgY(aiPrediction?.predicted_pct || `${occupancyPercentage}%`)}`} 
                                  fill="none" 
                                  stroke="#10b981" 
                                  strokeWidth="3" 
                                  strokeLinecap="round"
                                />

                                {/* Data Nodes (Actual - Blue) */}
                                <circle cx="40" cy={getSvgY(`${occupancyPercentage}%`)} r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="1.5" />
                                <circle cx="180" cy={getSvgY(getActualFutureOccupancy(10) || `${occupancyPercentage}%`)} r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="1.5" />
                                <circle cx="320" cy={getSvgY(getActualFutureOccupancy(20) || `${occupancyPercentage}%`)} r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="1.5" />
                                <circle cx="460" cy={getSvgY(getActualFutureOccupancy(30) || `${occupancyPercentage}%`)} r="4" fill="#3b82f6" stroke="#0f172a" strokeWidth="1.5" />

                                {/* Data Nodes (Predicted - Emerald) */}
                                <circle cx="40" cy={getSvgY(`${occupancyPercentage}%`)} r="4" fill="#10b981" stroke="#0f172a" strokeWidth="1.5" />
                                <circle cx="180" cy={getSvgY(aiPrediction?.predicted_pct_10min || `${occupancyPercentage}%`)} r="4" fill="#10b981" stroke="#0f172a" strokeWidth="1.5" />
                                <circle cx="320" cy={getSvgY(aiPrediction?.predicted_pct_20min || `${occupancyPercentage}%`)} r="4" fill="#10b981" stroke="#0f172a" strokeWidth="1.5" />
                                <circle cx="460" cy={getSvgY(aiPrediction?.predicted_pct || `${occupancyPercentage}%`)} r="4" fill="#10b981" stroke="#0f172a" strokeWidth="1.5" />
                              </svg>
                            </div>
                          </div>
                        )}

                        {/* AI Narrative Bubble (Gemini) */}
                        <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/60 text-xs text-slate-300 leading-relaxed italic relative">
                          <span className="absolute -top-2.5 left-4 bg-slate-950 px-2 text-[9px] font-bold text-blue-400 uppercase tracking-wider">Gemini AI Insight</span>
                          "{aiPrediction.ai_narrative}"
                        </div>

                        {/* AI Validation Feedback Panel */}
                        <div className="flex items-center justify-between bg-slate-900/30 p-3 rounded-xl border border-slate-800/50 animate-fade-in">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Apakah Prediksi AI Akurat?</span>
                          
                          {feedbackSubmitted === aiPrediction.prediction_id ? (
                            <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1 animate-pulse">
                              Feedback Dikirim! Terima Kasih ✅
                            </span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleFeedback(true)}
                                disabled={submittingFeedback}
                                className="px-3 py-1 bg-emerald-950 hover:bg-emerald-900/80 text-emerald-400 border border-emerald-800/40 text-[10px] font-bold rounded-lg transition-all active:scale-95 disabled:opacity-50"
                              >
                                {submittingFeedback ? "..." : "👍 Akurat"}
                              </button>
                              <button
                                onClick={() => handleFeedback(false)}
                                disabled={submittingFeedback}
                                className="px-3 py-1 bg-rose-950 hover:bg-rose-900/80 text-rose-400 border border-rose-800/40 text-[10px] font-bold rounded-lg transition-all active:scale-95 disabled:opacity-50"
                              >
                                {submittingFeedback ? "..." : "👎 Salah"}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Recommended Actions */}
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Rekomendasi Tindakan Admin</p>
                          <ul className="space-y-1.5 text-xs text-slate-200">
                            {aiPrediction.recommendation.actions.map((act, index) => (
                              <li key={index} className="flex items-start gap-2 bg-slate-900/30 p-2 rounded-lg border border-slate-900/50 hover:bg-slate-900/50 transition-colors">
                                <input type="checkbox" className="mt-0.5 accent-blue-500 rounded cursor-pointer" />
                                <span className="font-medium">{act}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-xs text-slate-500 italic">
                        Memuat prediksi AI...
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* STATS AREA */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-start">
                  <p className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-1">Total Capacity</p>
                  <p className="text-2xl font-bold text-slate-800">{slots.length} <span className="text-sm text-slate-400 font-normal">Slots</span></p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-start relative overflow-hidden">
                  <div className="absolute top-0 right-0 w-2 h-full bg-blue-500"></div>
                  <p className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-1">Occupied</p>
                  <p className="text-2xl font-bold text-slate-800">{occupiedSlots}</p>
                </div>
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex flex-col items-start">
                  <p className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-1">Available</p>
                  <p className="text-2xl font-bold text-slate-800">{availableSlots}</p>
                </div>
              </div>

              {/* GRID AREA */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex-1">
                <div className="flex flex-col gap-4 mb-6 border-b border-slate-100 pb-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-bold text-slate-800">Parking Map (Control Room View)</h3>
                      <p className="text-xs text-slate-400 italic">Saring tampilan slot berdasarkan camera feed atau tampilkan semua</p>
                    </div>
                    <div className="flex gap-4 text-[10px] font-bold">
                      <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-slate-50 border border-slate-200 rounded"></span> EMPTY</div>
                      <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-blue-500 border border-blue-600 rounded"></span> OCCUPIED</div>
                    </div>
                  </div>
                  
                  {/* Camera Tabs */}
                  <div className="flex flex-wrap gap-1.5 bg-slate-50 p-1.5 rounded-xl border border-slate-200/60">
                    {['semua', '01', '02', '03', '04', '05', '06', '07', '08', '09'].map((cam) => (
                      <button
                        key={cam}
                        onClick={() => setActiveCamera(cam)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                          activeCamera === cam
                            ? 'bg-slate-900 text-white shadow-sm shadow-slate-900/10'
                            : 'text-slate-600 hover:text-slate-950 hover:bg-slate-200/50'
                        }`}
                      >
                        {cam === 'semua' ? `Semua (${slots.length} Slot)` : `Cam ${cam}`}
                      </button>
                    ))}
                  </div>
                </div>
              
                <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 sm:gap-4">
                  {filteredSlots.map((slot) => {
                    const isEmpty = slot.status === 'kosong';
                    return (
                      <div 
                        key={slot.id} 
                        className={`
                          p-3 rounded-lg flex flex-col items-center justify-center transition-all duration-200
                          ${isEmpty 
                            ? 'bg-slate-50 border border-slate-200 hover:bg-slate-100 hover:border-slate-300' 
                            : 'bg-blue-500 border border-blue-600 shadow-sm'
                          }
                        `}
                      >
                        <span className={`text-[10px] font-bold ${isEmpty ? 'text-slate-400' : 'text-blue-100'}`}>
                          {slot.id}
                        </span>
                        <span 
                          className={`text-[9px] uppercase tracking-wider mt-1 ${
                            isEmpty ? 'text-slate-300' : 'text-white opacity-90'
                          }`}
                        >
                          {isEmpty ? 'Empty' : 'Parked'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {activeTab === 'laporan' && (
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100 flex-1">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">Laporan Transaksi Parkir</h2>
                  <p className="text-sm text-slate-500">Tinjau log aktivitas kendaraan yang keluar-masuk sistem.</p>
                </div>
                <button 
                  onClick={handleExportCSV} 
                  className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm transition-all active:scale-95 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                  Unduh CSV
                </button>
              </div>

              {logs.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
                  <p className="text-slate-500 font-medium">Belum ada data transaksi.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Log ID / Waktu</th>
                        <th className="p-4 text-xs font-bold text-slate-500 uppercase tracking-wider">Tipe Aktivitas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logs.slice().reverse().map(log => (
                        <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50/50">
                          <td className="p-4">
                            <p className="text-sm font-semibold text-slate-800">{new Date(log.timestamp).toLocaleString('id-ID')}</p>
                            <p className="text-xs text-slate-400 font-mono mt-0.5">{log.id}</p>
                          </td>
                          <td className="p-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              log.type === 'in' 
                                ? 'bg-emerald-100 text-emerald-800' 
                                : 'bg-rose-100 text-rose-800'
                            }`}>
                              {log.type === 'in' ? 'Kendaraan Masuk' : 'Kendaraan Keluar'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'petugas' && (
            <div className="grid gap-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <h2 className="text-xl font-bold text-slate-800 mb-2">Ngatur Petugas</h2>
                <p className="text-sm text-slate-500 mb-6">Kelola status shift petugas parkir saat ini.</p>
                
                <div className="grid gap-4">
                  {petugas.map(p => (
                    <div key={p.id} className="flex justify-between items-center bg-slate-50 p-5 rounded-xl border border-slate-200 transition-all hover:border-blue-200 hover:shadow-sm">
                      <div className="flex items-center gap-4">
                        <div className={`w-3 h-3 rounded-full ${p.status !== 'Offline' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]' : 'bg-slate-300'}`}></div>
                        <div>
                          <p className="font-bold text-slate-800 text-lg">{p.nama}</p>
                          <p className="text-sm text-slate-500 font-medium">{p.role}</p>
                        </div>
                      </div>
                      <button 
                        onClick={() => toggleStatusPetugas(p.id)}
                        className={`px-5 py-2 rounded-lg font-semibold text-sm transition-all shadow-sm active:scale-95 ${
                          p.status !== 'Offline' 
                            ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200 border border-emerald-200' 
                            : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-300'
                        }`}
                      >
                        {p.status}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FOOTER INFO */}
          <footer className="mt-4 flex justify-center pb-4">
            <p className="text-xs text-slate-400 font-medium">Parking System Architecture: Next.js + Context API + Tailwind CSS</p>
          </footer>

        </div>
      </section>

      {/* ADMIN CHECKOUT OVERLAY */}
      {selectedVehicle && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full border border-slate-200">
            <div className="text-center mb-6">
              <h3 className="text-xl font-bold text-slate-800">Proses Pembayaran</h3>
              <p className="text-sm text-slate-500">Tiket: {selectedVehicle}</p>
            </div>
            
            <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 mb-6">
              <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold mb-1">Status Layar Pelanggan</p>
              <div className="flex items-center gap-2">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                </span>
                <span className="text-sm font-medium text-blue-600">Menampilkan tagihan di /exit-display</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => {
                  setSelectedVehicle(null);
                  setExitProcessData(null);
                  setPaymentSuccess(false);
                }}
                className="flex-1 px-4 py-3 border border-slate-300 text-slate-700 rounded-xl font-medium hover:bg-slate-50 transition-colors"
              >
                Batal
              </button>
              <button 
                onClick={confirmPayment}
                className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium transition-colors shadow-sm active:scale-95"
              >
                Konfirmasi Bayar
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
