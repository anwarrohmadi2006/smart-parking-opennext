'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useParking } from '@/context/ParkingContext';

const CarIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
    <circle cx="7" cy="17" r="2" />
    <path d="M9 17h6" />
    <circle cx="17" cy="17" r="2" />
  </svg>
);

const ArrowRightIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} xmlns="http://www.w3.org/2000/svg">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);

export default function LandingPage() {
  const router = useRouter();
  const { config, setConfig, syncToDB } = useParking();

  const handleConfigUpdate = async () => {
    // Demo mode removed
  };
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleRouting = (path: string) => {
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
    <main className="min-h-screen bg-wise-canvas-soft text-wise-ink font-sans flex flex-col md:flex-row overflow-hidden">
      
      {/* Hero Section (Left on Desktop, Top on Mobile) */}
      <div className="w-full md:w-1/2 flex flex-col justify-center px-8 py-16 md:p-24 z-10">
        <div className="max-w-xl mx-auto md:mx-0">
          <div className="flex items-center gap-3 mb-8">
            <div className="bg-wise-primary p-3 rounded-full text-wise-ink">
              <CarIcon className="w-8 h-8" />
            </div>
            <p className="text-wise-ink-deep font-semibold tracking-wide uppercase text-sm">
              Capstone Project CC26
            </p>
          </div>
          
          <h1 className="text-5xl md:text-7xl lg:text-[96px] font-black tracking-tight leading-[0.9] text-wise-ink mb-12">
            Smart<br/>Parking.
          </h1>
          
          <div className="flex flex-col gap-4 w-full max-w-md">
            <button
              onClick={() => handleRouting('/dashboard')}
              className="group w-full bg-wise-primary hover:bg-wise-primary-active text-wise-ink font-bold text-xl py-5 px-8 rounded-[24px] transition-colors shadow-sm flex items-center justify-between"
            >
              <span>Pintu Masuk</span>
              <ArrowRightIcon className="w-6 h-6 transition-transform group-hover:translate-x-1" />
            </button>
            
            <button
              onClick={() => handleRouting('/exit-display')}
              className="group w-full bg-wise-canvas hover:bg-wise-primary-pale text-wise-ink border border-wise-ink font-bold text-xl py-5 px-8 rounded-[24px] transition-colors shadow-sm flex items-center justify-between"
            >
              <span>Pintu Keluar</span>
              <ArrowRightIcon className="w-6 h-6 transition-transform group-hover:translate-x-1" />
            </button>
          </div>
        </div>
      </div>

      {/* Admin Login Section (Right on Desktop, Bottom on Mobile) */}
      <div className="w-full md:w-1/2 bg-wise-canvas flex flex-col justify-center px-8 py-16 md:p-24 relative shadow-[-10px_0_30px_rgba(0,0,0,0.03)] rounded-t-[40px] md:rounded-t-none md:rounded-l-[40px]">
        <div className="max-w-md mx-auto w-full">
          <h2 className="text-4xl font-black mb-8 text-wise-ink">Admin Portal</h2>
          <form onSubmit={handleAdminLogin} className="flex flex-col gap-6">
            <div>
              <label className="block text-wise-body font-semibold mb-2">Password</label>
              <input
                type="password"
                placeholder="Masukkan kata sandi..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full bg-wise-canvas text-wise-ink placeholder:text-wise-mute px-6 py-5 rounded-[16px] border ${
                  error ? 'border-wise-negative focus:border-wise-negative' : 'border-wise-ink focus:border-wise-ink'
                } focus:outline-none transition-all font-medium text-lg`}
              />
              {error && <p className="text-wise-negative text-sm mt-3 font-semibold">{error}</p>}
            </div>
            <button
              type="submit"
              className="w-full bg-wise-ink hover:bg-[#20221e] text-wise-canvas-soft font-bold text-lg py-5 rounded-[24px] transition-all shadow-md mt-4"
            >
              Log in ke Dashboard
            </button>
          </form>
        </div>
      </div>
      
    </main>
  );
}
