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
    <main
      style={{
        display: 'flex',
        flexDirection: 'row',
        minHeight: '100vh',
        width: '100%',
        backgroundColor: '#0a0a0a',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        margin: 0,
        padding: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background Dot Pattern (Trapezoid Area) */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.3) 3.5px, transparent 3.5px)',
          backgroundSize: '36px 36px',
          clipPath: 'polygon(45% 0, 100% 0, 100% 100%, 35% 100%)',
          zIndex: 0,
        }}
      />

      {/* ===== LEFT PANEL ===== */}
      <div
        style={{
          width: '45%',
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          padding: '40px 60px',
          boxSizing: 'border-box',
          position: 'relative',
          zIndex: 2,
        }}
      >
        {/* Top: Branding */}
        <div>
          <div
            style={{
              color: '#ffffff',
              fontSize: '22px',
              fontWeight: 800,
              lineHeight: 1.2,
              letterSpacing: '-0.02em',
            }}
          >
            SmartParking<br />System
          </div>
          <div
            style={{
              color: '#666666',
              fontSize: '13px',
              fontWeight: 400,
              marginTop: '4px',
            }}
          >
            Capstone Project CC26
          </div>
        </div>

        {/* Center: Login Form */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            width: '100%',
            maxWidth: '340px',
            alignSelf: 'center',
          }}
        >
          <h2
            style={{
              color: '#ffffff',
              fontSize: '42px',
              fontWeight: 800,
              margin: '0 0 12px 0',
              letterSpacing: '-0.02em',
            }}
          >
            Login
          </h2>
          <p
            style={{
              color: '#888888',
              fontSize: '14px',
              lineHeight: 1.6,
              margin: '0 0 40px 0',
              fontWeight: 400,
            }}
          >
            Welcome to Smartparking System<br />
            Login as administrator
          </p>

          <form onSubmit={handleAdminLogin}>
            <div style={{ marginBottom: '20px' }}>
              <input
                type="password"
                placeholder="Input Password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{
                  width: '100%',
                  backgroundColor: '#d9d9d9',
                  color: '#222222',
                  fontSize: '14px',
                  fontWeight: 400,
                  padding: '14px 18px',
                  borderRadius: '8px',
                  border: error ? '2px solid #ef4444' : '2px solid transparent',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
              {error && (
                <p
                  style={{
                    color: '#ef4444',
                    fontSize: '12px',
                    marginTop: '8px',
                    fontWeight: 500,
                  }}
                >
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              style={{
                width: '100%',
                backgroundColor: '#888888',
                color: '#ffffff',
                fontSize: '18px',
                fontWeight: 700,
                padding: '14px 0',
                borderRadius: '8px',
                border: 'none',
                cursor: 'pointer',
                transition: 'background-color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#777777')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#888888')}
            >
              Login
            </button>
          </form>
        </div>
      </div>

      {/* ===== RIGHT PANEL ===== */}
      <div
        style={{
          flex: 1,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          boxSizing: 'border-box',
        }}
      >
        {/* Car Icon (Inline SVG) */}
        <div style={{ marginBottom: '50px', position: 'relative', zIndex: 1 }}>
          <svg width="220" height="180" viewBox="0 0 220 180" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Roof / Top bar */}
            <rect x="60" y="18" width="100" height="6" rx="3" fill="white" />
            {/* Windshield / Roof curve */}
            <path d="M45 90 Q45 30 110 28 Q175 30 175 90" fill="white" />
            {/* Body */}
            <rect x="30" y="88" width="160" height="65" rx="16" fill="white" />
            {/* Windshield glass (dark cutout) */}
            <path d="M58 85 Q58 48 110 46 Q162 48 162 85" fill="#1a1a1a" />
            {/* Left headlight outer */}
            <circle cx="68" cy="115" r="18" fill="#1a1a1a" />
            {/* Left headlight inner */}
            <circle cx="68" cy="115" r="12" fill="#2a2a2a" />
            {/* Left headlight reflection */}
            <circle cx="63" cy="110" r="4" fill="#555" />
            {/* Right headlight outer */}
            <circle cx="152" cy="115" r="18" fill="#1a1a1a" />
            {/* Right headlight inner */}
            <circle cx="152" cy="115" r="12" fill="#2a2a2a" />
            {/* Right headlight reflection */}
            <circle cx="147" cy="110" r="4" fill="#555" />
            {/* Bottom bumper line */}
            <rect x="50" y="148" width="120" height="5" rx="2.5" fill="#e0e0e0" />
            {/* Side mirrors */}
            <ellipse cx="26" cy="92" rx="10" ry="7" fill="white" />
            <ellipse cx="194" cy="92" rx="10" ry="7" fill="white" />
          </svg>
        </div>

        {/* Gate Buttons */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            width: '100%',
            maxWidth: '320px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          <button
            onClick={() => handleRouting('/dashboard')}
            style={{
              width: '100%',
              backgroundColor: '#8CC665',
              color: '#ffffff',
              fontSize: '22px',
              fontWeight: 700,
              padding: '16px 0',
              borderRadius: '12px',
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.2s, transform 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#7cb455')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#8CC665')}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            Pintu Masuk
          </button>

          <button
            onClick={() => handleRouting('/exit-display')}
            style={{
              width: '100%',
              backgroundColor: '#EB645B',
              color: '#ffffff',
              fontSize: '22px',
              fontWeight: 700,
              padding: '16px 0',
              borderRadius: '12px',
              border: 'none',
              cursor: 'pointer',
              transition: 'background-color 0.2s, transform 0.1s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#d55951')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#EB645B')}
            onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
            onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
          >
            Pintu Keluar
          </button>
        </div>
      </div>
    </main>
  );
}
