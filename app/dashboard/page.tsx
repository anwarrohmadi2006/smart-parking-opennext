'use client';

import React, { useState, useEffect } from 'react';
import { useParking } from '@/context/ParkingContext';

const AlertIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M5 13l4 4L19 7"/>
  </svg>
);

const CarIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
    <circle cx="7" cy="17" r="2" />
    <path d="M9 17h6" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);

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
    <main className="min-h-screen w-full bg-wise-canvas-soft text-wise-ink flex flex-col font-sans overflow-hidden">
      
      {/* Banner Internet Lambat */}
      {isSlowInternet && (
        <div className="bg-wise-warning text-wise-warning-content text-xs sm:text-sm font-semibold px-4 py-3 flex items-center justify-center border-b border-wise-warning-deep/20">
          <AlertIcon className="w-5 h-5 mr-2" />
          Koneksi internet lambat. Data terakhir pada {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('id-ID') : '--:--'}. Sedang sinkronisasi...
        </div>
      )}

      {/* Header */}
      <header className="h-24 bg-wise-canvas-soft flex items-center justify-between px-8 sm:px-12 shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-wise-ink rounded-full flex items-center justify-center">
             <CarIcon className="w-6 h-6 text-wise-primary" />
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-wise-ink">
            Pintu Masuk
          </h1>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-xs text-wise-mute font-semibold uppercase tracking-wider mb-1">Status Kapasitas</span>
          <div className="flex items-center gap-3">
             <div className={`w-3 h-3 rounded-full ${availableSlots > 0 ? 'bg-wise-positive' : 'bg-wise-negative'} animate-pulse`}></div>
             <p className="text-xl font-bold font-mono">
               <span className={availableSlots > 0 ? 'text-wise-positive' : 'text-wise-negative'}>{availableSlots}</span>
               <span className="text-wise-mute mx-1">/</span>
               <span className="text-wise-body">{slots.length}</span>
             </p>
          </div>
        </div>
      </header>

      {/* Main Content - Center Card */}
      <section className="flex-1 flex flex-col items-center justify-center p-8 relative">
        <div className="max-w-xl w-full bg-wise-canvas border border-wise-ink p-10 md:p-14 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative z-10 flex flex-col items-center">
          
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-4 text-wise-ink text-center">
            {isManualClose ? 'Akses Ditutup' : availableSlots === 0 ? 'Parkir Penuh' : 'Ambil Tiket'}
          </h2>
          <p className="text-lg text-wise-body text-center mb-10 font-medium">
            {isManualClose ? 'Mohon hubungi petugas keamanan kami.' : availableSlots === 0 ? 'Harap tunggu sampai ada kendaraan yang keluar.' : 'Tekan tombol di bawah untuk membuka palang.'}
          </p>

          <button
            onClick={handleAmbilTiket}
            disabled={availableSlots === 0 || modalData !== null || isManualClose}
            className={`w-full py-6 px-8 rounded-[24px] font-bold text-xl md:text-2xl transition-all flex flex-col items-center justify-center gap-2 ${
              availableSlots > 0 && !modalData && !isManualClose
                ? 'bg-wise-primary hover:bg-wise-primary-active text-wise-ink shadow-sm'
                : 'bg-wise-canvas-soft text-wise-mute cursor-not-allowed border border-wise-canvas-soft'
            }`}
          >
            {isManualClose ? 'Terkunci' : availableSlots === 0 ? 'Area Penuh' : 'Ambil Tiket Parkir'}
          </button>
        </div>
      </section>

      {/* Success Modal Overlay */}
      <div 
        className={`fixed inset-0 z-50 flex items-center justify-center bg-wise-ink/50 backdrop-blur-sm transition-all duration-300 ${
          modalData ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div 
          className={`bg-wise-canvas p-10 rounded-[24px] shadow-2xl max-w-md w-full text-center transition-all duration-500 transform ${
            modalData ? 'translate-y-0 scale-100' : 'translate-y-12 scale-95'
          }`}
        >
          <div className="w-20 h-20 bg-wise-primary rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm">
            <CheckIcon className="w-10 h-10 text-wise-ink" />
          </div>
          <h3 className="text-3xl font-black text-wise-ink mb-2">Berhasil!</h3>
          <p className="text-wise-body font-medium mb-8 text-lg">Gerbang terbuka. Silakan masuk.</p>
          
          <div className="bg-wise-canvas-soft rounded-[16px] p-6 mb-8 flex flex-col gap-4">
            <div className="flex justify-between items-center pb-4 border-b border-white">
              <span className="text-sm text-wise-mute font-semibold">Nomor Tiket</span>
              <span className="text-lg font-mono font-bold text-wise-ink">{modalData?.ticketId}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-wise-mute font-semibold">Lokasi Slot</span>
              <span className="text-4xl font-black text-wise-ink">{modalData?.slotId}</span>
            </div>
          </div>
          
          <div className="w-full bg-wise-canvas-soft h-2 rounded-full overflow-hidden">
            <div 
              className="h-full bg-wise-primary transition-all ease-linear" 
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
