import type {Metadata} from 'next';
import './globals.css'; // Global styles
import dynamic from 'next/dynamic';
import DemoBanner from '@/components/DemoBanner';

const ParkingProvider = dynamic(
  () => import('@/context/ParkingContext').then((mod) => mod.ParkingProvider),
  { ssr: false }
);

export const metadata: Metadata = {
  title: 'Sistem Manajemen Parkir',
  description: 'Aplikasi pengelolaan slot parkir dengan Global State Management',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <ParkingProvider>
          <DemoBanner />
          {children}
        </ParkingProvider>
      </body>
    </html>
  );
}
