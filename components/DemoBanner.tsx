'use client';

import React from 'react';
import { useParking } from '@/context/ParkingContext';

export default function DemoBanner() {
  const { config } = useParking();

  if (!config.demo_mode) return null;

  return (
    <div className="fixed top-0 left-0 w-full z-[9999] bg-amber-500 text-black text-center text-xs font-bold uppercase tracking-widest py-1 shadow-md opacity-90 pointer-events-none">
      * DEMO MODE ACTIVE - SIMULASI DATA OTOMATIS SEDANG BERJALAN *
    </div>
  );
}
