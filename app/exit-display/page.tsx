'use client';

import React from 'react';
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

const ScanIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm14 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
  </svg>
);

export default function ExitDisplayPage() {
  const { exitProcessData, paymentSuccess, isSlowInternet, lastSyncTime } = useParking();

  return (
    <main className="min-h-screen w-full bg-wise-canvas-soft text-wise-ink flex flex-col font-sans relative md:overflow-hidden">
      
      {/* Banner Internet Lambat */}
      {isSlowInternet && (
        <div className="absolute top-0 w-full z-50 bg-wise-warning text-wise-warning-content text-xs sm:text-sm font-semibold px-4 py-3 flex items-center justify-center border-b border-wise-warning-deep/20">
          <AlertIcon className="w-5 h-5 mr-2" />
          Koneksi internet lambat. Data terakhir pada {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('id-ID') : '--:--'}. Sedang sinkronisasi...
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
        <div className="z-10 bg-wise-canvas border border-wise-ink p-10 md:p-16 rounded-[24px] shadow-[0_8px_30px_rgb(0,0,0,0.04)] max-w-2xl w-full text-center relative overflow-hidden">
          {/* Border Top Highlight */}
          <div className={`absolute top-0 left-0 w-full h-3 ${paymentSuccess ? 'bg-wise-positive' : exitProcessData ? 'bg-wise-primary' : 'bg-wise-mute'}`}></div>
  
          {paymentSuccess ? (
            <div className="animate-in fade-in zoom-in duration-500 py-6">
              <div className="w-24 h-24 bg-wise-primary rounded-full flex items-center justify-center mx-auto mb-8 shadow-sm">
                <CheckIcon className="w-12 h-12 text-wise-ink" />
              </div>
              <h1 className="text-4xl md:text-5xl font-black text-wise-ink mb-4 tracking-tight">Pembayaran Berhasil</h1>
              <p className="text-xl md:text-2xl text-wise-body font-medium">Gerbang Terbuka. Hati-hati di Jalan!</p>
            </div>
        ) : exitProcessData ? (
          <div className="animate-in slide-in-from-bottom-8 duration-500">
            <h1 className="text-2xl md:text-3xl font-black text-wise-ink mb-10 tracking-wide border-b border-wise-canvas-soft pb-6">
              Rincian Pembayaran
            </h1>
            
            <div className="space-y-6 mb-10 text-left">
              <div className="flex justify-between items-center bg-wise-canvas-soft rounded-[16px] p-6">
                <span className="text-lg text-wise-mute font-semibold tracking-wider">Tiket</span>
                <span className="text-2xl md:text-3xl font-bold text-wise-ink font-mono tracking-widest">{exitProcessData.ticketId}</span>
              </div>
              
              <div className="flex justify-between items-center bg-wise-canvas-soft rounded-[16px] p-6">
                <span className="text-lg text-wise-mute font-semibold tracking-wider">Durasi</span>
                <span className="text-2xl md:text-3xl font-bold text-wise-ink">{exitProcessData.durationString}</span>
              </div>
            </div>

            <div className="bg-wise-ink rounded-[24px] p-8 shadow-md">
              <span className="text-sm md:text-base text-wise-canvas-soft font-semibold uppercase tracking-widest block mb-2 opacity-80">Total Bayar</span>
              <span className="text-5xl md:text-6xl font-black text-wise-primary tracking-tighter">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(exitProcessData.totalCost)}
              </span>
            </div>
          </div>
        ) : (
          <div className="py-12 animate-in fade-in duration-700">
            <div className="w-24 h-24 bg-wise-canvas-soft rounded-full flex items-center justify-center mx-auto mb-8">
               <ScanIcon className="w-12 h-12 text-wise-ink" />
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-wise-ink mb-6 tracking-tight leading-snug">
              Terima kasih atas<br/>kunjungan Anda
            </h1>
            <p className="text-xl text-wise-body font-medium">Silakan scan tiket Anda pada scanner di bawah ini.</p>
          </div>
        )}
        </div>
      </div>

      {/* Footer Branding - Consistent with entry gate */}
      <div className="absolute bottom-8 text-center w-full">
        <p className="text-xs text-wise-mute font-bold tracking-widest uppercase">Sistem Parkir Capstone CC26</p>
      </div>
    </main>
  );
}
