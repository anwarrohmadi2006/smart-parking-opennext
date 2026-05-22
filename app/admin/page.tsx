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
    syncToDB
  } = useParking();

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

  useEffect(() => {
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

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrediction({ masuk: estimasiMasuk, keluar: estimasiKeluar, status: statusPeringatan });
  }, [occupancyPercentage]);

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
              {/* PREDIKSI & OKUPANSI */}
              <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-sm border border-slate-800">
                <h2 className="text-xl font-bold mb-3">Status Okupansi: {occupancyPercentage}%</h2>
                <div className="w-full bg-slate-700 h-4 rounded-full mb-6 relative overflow-hidden">
                  <div 
                    className={`h-4 rounded-full transition-all duration-500 ${occupancyPercentage > 85 ? 'bg-rose-500' : 'bg-blue-500'}`} 
                    style={{ width: `${occupancyPercentage}%` }}
                  ></div>
                </div>

                <div className="bg-slate-800 p-5 rounded-xl border border-slate-700">
                  <h3 className="text-xs uppercase tracking-wider text-slate-400 font-bold mb-2">PREDIKSI 1 JAM KE DEPAN</h3>
                  <p className="text-lg">
                    Estimasi <span className="font-bold text-emerald-400">{prediction.masuk} masuk</span> dan <span className="font-bold text-blue-400">{prediction.keluar} keluar</span>.
                  </p>
                  {prediction.status !== 'Aman' && (
                    <div className="mt-3 inline-block bg-rose-500/20 border border-rose-500/30 text-rose-400 px-3 py-1.5 rounded-lg text-sm font-semibold animate-pulse">
                      {prediction.status} Siapkan tindakan antisipasi!
                    </div>
                  )}
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
                <div className="flex justify-between items-center mb-6">
                  <div>
                    <h3 className="font-bold text-slate-800">Parking Map</h3>
                    <p className="text-xs text-slate-400 italic">State: slots[{slots.length}]</p>
                  </div>
                  <div className="flex gap-4 text-[10px] font-bold">
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-slate-50 border border-slate-200 rounded"></span> EMPTY</div>
                    <div className="flex items-center gap-1.5"><span className="w-3 h-3 bg-blue-500 border border-blue-600 rounded"></span> OCCUPIED</div>
                  </div>
                </div>
              
                <div className="grid grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3 sm:gap-4">
                  {slots.map((slot) => {
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
