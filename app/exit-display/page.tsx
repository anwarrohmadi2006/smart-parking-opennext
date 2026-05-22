'use client';

import React from 'react';
import { useParking } from '@/context/ParkingContext';

export default function ExitDisplayPage() {
  const { exitProcessData, paymentSuccess, isSlowInternet, lastSyncTime } = useParking();

  return (
    <main className="h-screen w-full bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden relative">
      
      {/* Banner Internet Lambat */}
      {isSlowInternet && (
        <div className="absolute top-0 w-full z-50 bg-amber-100 text-amber-800 text-xs sm:text-sm font-semibold px-4 py-2 flex items-center justify-center border-b border-amber-200">
          <span className="mr-2">⚠️</span>
          Koneksi internet lambat. Menampilkan data terakhir pada {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString('id-ID') : '--:--'}. Sedang mencoba menyinkronkan ulang...
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center p-8 relative">
        {/* Background Effects */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none"></div>
  
        <div className="z-10 bg-slate-900 border border-slate-800 p-10 md:p-16 rounded-[2rem] shadow-2xl max-w-2xl w-full text-center relative overflow-hidden">
          {/* Border Top Highlight */}
          <div className={`absolute top-0 left-0 w-full h-2 ${paymentSuccess ? 'bg-emerald-500' : exitProcessData ? 'bg-blue-500' : 'bg-slate-700'}`}></div>
  
          {paymentSuccess ? (
            <div className="animate-in fade-in zoom-in duration-500">
              <div className="w-24 h-24 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-8">
                <svg className="w-12 h-12 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7"/></svg>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-emerald-400 mb-4 tracking-tight">Pembayaran Berhasil</h1>
              <p className="text-xl md:text-2xl text-slate-300">Gerbang Terbuka. Hati-hati di Jalan!</p>
            </div>
        ) : exitProcessData ? (
          <div className="animate-in slide-in-from-bottom-8 duration-500">
            <h1 className="text-2xl md:text-3xl font-bold text-white mb-10 tracking-wide uppercase border-b border-slate-800 pb-6">
              Rincian Pembayaran
            </h1>
            
            <div className="space-y-6 mb-10">
              <div className="flex justify-between items-center bg-slate-950 rounded-2xl p-6 border border-slate-800">
                <span className="text-lg text-slate-400 font-semibold uppercase tracking-wider">Tiket</span>
                <span className="text-3xl font-bold text-white font-mono tracking-widest">{exitProcessData.ticketId}</span>
              </div>
              
              <div className="flex justify-between items-center bg-slate-950 rounded-2xl p-6 border border-slate-800">
                <span className="text-lg text-slate-400 font-semibold uppercase tracking-wider">Durasi</span>
                <span className="text-3xl font-bold text-white">{exitProcessData.durationString}</span>
              </div>
            </div>

            <div className="bg-slate-950 rounded-3xl p-8 border border-slate-800 shadow-[inset_0_0_20px_rgba(0,0,0,0.5)]">
              <span className="text-sm md:text-base text-slate-400 font-semibold uppercase tracking-widest block mb-2">Total Bayar</span>
              <span className="text-5xl md:text-6xl font-black text-emerald-400 tracking-tighter">
                {new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(exitProcessData.totalCost)}
              </span>
            </div>
          </div>
        ) : (
          <div className="py-12 animate-in fade-in duration-700">
            <div className="w-20 h-20 bg-slate-800 rounded-2xl flex items-center justify-center mx-auto mb-8 shadow-inner">
               <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm14 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/></svg>
            </div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-100 mb-4 tracking-tight leading-snug">
              Terima kasih atas<br/>kunjungan Anda
            </h1>
            <p className="text-xl text-slate-400">Silakan scan tiket Anda pada scanner di bawah ini.</p>
          </div>
        )}
        </div>
      </div>

      {/* Footer Branding - Consistent with entry gate */}
      <div className="absolute bottom-8 text-center w-full">
        <p className="text-xs text-slate-500 font-bold tracking-[0.2em] uppercase">Sistem Parkir Capstone CC26</p>
      </div>
    </main>
  );
}
