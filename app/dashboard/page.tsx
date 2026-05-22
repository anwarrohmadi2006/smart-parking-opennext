'use client';

import React, { useState, useEffect } from 'react';
import { useParking } from '@/context/ParkingContext';

export default function EntryGatePage() {
  const { slots, setSlots, setActiveVehicles, isManualClose, isSlowInternet, lastSyncTime, setLogs, syncToDB } = useParking();
  const [modalData, setModalData] = useState<{ ticketId: string; slotId: string } | null>(null);

  const availableSlots = slots.filter((s) => s.status === 'kosong').length;

  const handleAmbilTiket = () => {
    if (availableSlots === 0) {
      alert('Mohon maaf, lokasi parkir sedang penuh!');
      return;
    }

    const emptySlotIndex = slots.findIndex((s) => s.status === 'kosong');
    if (emptySlotIndex === -1) return;

    const slot = slots[emptySlotIndex];
    const newTicketId = `TIX-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
    const checkInTime = Date.now();
    const logId = Date.now().toString();

    // Update global state
    setActiveVehicles((prev) => [
      ...prev,
      {
        ticketId: newTicketId,
        slotId: slot.id,
        checkInTime: checkInTime,
      },
    ]);

    const updatedSlots = [...slots];
    updatedSlots[emptySlotIndex] = { ...slot, status: 'terisi' };
    setSlots(updatedSlots);
    setLogs((prev: any) => [...prev, { id: logId, type: 'in', timestamp: Date.now() }]);
    
    syncToDB('vehicle_in', { ticketId: newTicketId, slotId: slot.id, checkInTime, logId });

    // Show modal
    setModalData({ ticketId: newTicketId, slotId: slot.id });
  };

  useEffect(() => {
    if (modalData) {
      const timer = setTimeout(() => {
        setModalData(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [modalData]);

  return (
    <main className="h-screen w-full bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
      
      {/* Banner Internet Lambat */}
      {isSlowInternet && (
        <div className="bg-amber-100 text-amber-800 text-xs sm:text-sm font-semibold px-4 py-2 flex items-center justify-center border-b border-amber-200">
          <span className="mr-2">⚠️</span>
          Koneksi internet lambat. Menampilkan data terakhir pada {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('id-ID') : '--:--'}. Sedang mencoba menyinkronkan ulang...
        </div>
      )}

      {/* Header */}
      <header className="h-24 border-b border-slate-800/50 bg-slate-900/50 flex items-center justify-between px-8 sm:px-12 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.5)]">
             <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-widest text-slate-100 uppercase">
            SISTEM PARKIR CAPSTONE CC26 <span className="text-slate-500 mx-2">|</span> <span className="text-blue-400">PINTU MASUK</span>
          </h1>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">Status Kapasitas</span>
          <div className="flex items-center gap-3">
             <div className={`w-3 h-3 rounded-full ${availableSlots > 0 ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]'} animate-pulse`}></div>
             <p className="text-xl font-bold font-mono">
               <span className={availableSlots > 0 ? 'text-emerald-400' : 'text-rose-400'}>{availableSlots}</span>
               <span className="text-slate-500 mx-1">/</span>
               <span className="text-slate-300">24</span>
             </p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <section className="flex-1 flex flex-col items-center justify-center p-8 relative">
        <div className="text-center mb-16 relative z-10">
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-4 text-transparent bg-clip-text bg-gradient-to-r from-slate-100 to-slate-400">
            {isManualClose ? 'Akses Masuk Ditutup' : availableSlots === 0 ? 'Sistem Penuh' : 'Silakan Ambil Tiket'}
          </h2>
          <p className="text-lg text-slate-400">
            {isManualClose ? 'Mohon hubungi petugas kami' : availableSlots === 0 ? 'Tunggu sampai ada kendaraan keluar' : 'Tekan tombol di bawah untuk membuka gerbang'}
          </p>
        </div>

        {/* Big Red Button */}
        <div className="relative group">
          {/* Outer glowing rings */}
          <div className={`absolute -inset-8 bg-rose-600/20 rounded-full blur-2xl transition-all duration-500 ${availableSlots > 0 && !isManualClose ? 'group-hover:bg-rose-500/40 group-hover:blur-3xl' : 'opacity-0'}`}></div>
          <div className={`absolute -inset-4 bg-rose-500/30 rounded-full blur-xl transition-all duration-500 ${availableSlots > 0 && !isManualClose ? 'group-hover:bg-rose-400/50' : 'opacity-0'}`}></div>
          
          <button
            onClick={handleAmbilTiket}
            disabled={availableSlots === 0 || modalData !== null || isManualClose}
            className={`
              relative z-10 w-64 h-64 md:w-80 md:h-80 rounded-full flex flex-col items-center justify-center 
              border-8 shadow-[inset_0_4px_20px_rgba(255,255,255,0.2),_0_10px_30px_rgba(0,0,0,0.8)]
              transition-all duration-200 
              ${availableSlots > 0 && !modalData && !isManualClose
                ? 'bg-gradient-to-br from-rose-500 to-rose-700 border-slate-900 hover:from-rose-400 hover:to-rose-600 active:scale-95 active:shadow-[inset_0_10px_30px_rgba(0,0,0,0.5)] cursor-pointer' 
                : 'bg-slate-900 border-rose-900/50 cursor-not-allowed'
              }
            `}
          >
            <span className={`text-2xl md:text-3xl font-black uppercase tracking-widest text-center px-6 leading-relaxed flex flex-col items-center
              ${availableSlots > 0 && !modalData && !isManualClose ? 'text-white' : 'text-rose-500'}
            `}>
              {isManualClose ? (
                'AKSES DITUTUP ADMIN'
              ) : availableSlots === 0 ? (
                'MAAF, PARKIRAN SEDANG PENUH'
              ) : (
                'TEKAN UNTUK AMBIL TIKET'
              )}
            </span>
            {availableSlots > 0 && !modalData && !isManualClose && (
              <span className="mt-4 text-rose-200 text-sm font-semibold tracking-widest uppercase">(MASUK)</span>
            )}
          </button>
        </div>
      </section>

      {/* Futuristic Modal Overlay */}
      <div 
        className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md transition-all duration-300 ${
          modalData ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div 
          className={`bg-slate-900 border border-emerald-500/30 p-8 rounded-3xl shadow-[0_0_50px_rgba(16,185,129,0.15)] max-w-md w-full text-center transition-all duration-500 transform ${
            modalData ? 'translate-y-0 scale-100' : 'translate-y-12 scale-95'
          }`}
        >
          <div className="w-20 h-20 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6 shadow-[0_0_20px_rgba(16,185,129,0.2)]">
            <svg className="w-10 h-10 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">Selamat Datang!</h3>
          <p className="text-emerald-400 font-medium mb-8">Gerbang telah terbuka. Silakan masuk.</p>
          
          <div className="bg-slate-950 rounded-2xl p-6 border border-slate-800 mb-8">
            <div className="flex justify-between items-center mb-4 pb-4 border-b border-slate-800">
              <span className="text-sm text-slate-500 uppercase tracking-wider font-semibold">Nomor Tiket</span>
              <span className="text-lg font-mono font-bold text-white tracking-wider">{modalData?.ticketId}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-500 uppercase tracking-wider font-semibold">Lokasi Slot</span>
              <span className="text-4xl font-bold text-emerald-400">{modalData?.slotId}</span>
            </div>
          </div>
          
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
            {/* Visual timer bar that shrinks over 5 seconds */}
            <div 
              className="h-full bg-emerald-500 transition-all ease-linear" 
              style={{ 
                width: modalData ? '0%' : '100%', 
                transitionDuration: modalData ? '5000ms' : '0ms' 
              }}
            ></div>
          </div>
        </div>
      </div>

    </main>
  );
}
