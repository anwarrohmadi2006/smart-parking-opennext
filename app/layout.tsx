import type {Metadata} from 'next';
import './globals.css'; // Global styles
import ClientParkingProvider from '@/components/ClientParkingProvider';


export const metadata: Metadata = {
  title: 'Sistem Manajemen Parkir',
  description: 'Aplikasi pengelolaan slot parkir dengan Global State Management',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ClientParkingProvider>
          {children}
        </ClientParkingProvider>
      </body>
    </html>
  );
}
