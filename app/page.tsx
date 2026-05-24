'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useParking } from '@/context/ParkingContext';

export default function LandingPage() {
  const router = useRouter();
  const { config, setConfig, syncToDB } = useParking();

  const handleConfigUpdate = async () => {
    // Demo mode removed
  };
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleRouting = (path: string) => {
    // Request fullscreen (some browsers might block this if not triggered by direct user gesture)
    if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.log(`Error attempting to enable fullscreen: ${err.message}`);
      });
    }
    router.push(path);
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'cc26') {
      setError('');
      router.push('/admin');
    } else {
      setError('Password salah. Silakan coba lagi.');
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <div className="bg-white p-8 md:p-12 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 max-w-lg w-full text-center flex flex-col items-center">
        {/* Header Section */}
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-800 mb-4 leading-tight">
          Selamat datang di<br className="hidden md:block" />
          <span className="text-blue-600">Taman Capstone Project CC26</span>
        </h1>
        <p className="text-sm md:text-base text-slate-500 mb-8">
          Sistem Manajemen Parkir Cerdas
        </p>
        
        {/* User Dashboard Buttons */}
        <div className="grid grid-cols-2 gap-4 w-full mb-10">
          <button
            onClick={() => handleRouting('/dashboard')}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-4 rounded-xl transition-all duration-200 shadow-sm hover:shadow active:scale-[0.98] text-sm md:text-base"
          >
            Pintu Masuk
          </button>
          <button
            onClick={() => handleRouting('/exit-display')}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-4 rounded-xl transition-all duration-200 shadow-sm hover:shadow active:scale-[0.98] text-sm md:text-base"
          >
            Pintu Keluar
          </button>
        </div>

        {/* Admin Login Section */}
        <div className="w-full border-t border-slate-100 pt-8">
          <h2 className="text-sm font-bold text-slate-700 mb-4 text-left uppercase tracking-wider">Login Admin</h2>
          <form onSubmit={handleAdminLogin} className="flex flex-col gap-4">
            <div className="text-left">
              <input
                type="password"
                placeholder="Masukkan Password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full px-4 py-3 rounded-xl border focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm ${
                  error ? 'border-rose-400 focus:border-rose-500' : 'border-slate-200 focus:border-blue-500'
                }`}
              />
              {error && <p className="text-rose-500 text-xs mt-2 font-medium">{error}</p>}
            </div>
            <button
              type="submit"
              className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 px-6 rounded-xl transition-all duration-200 shadow-sm active:scale-[0.98] text-sm mt-1"
            >
              Login
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
