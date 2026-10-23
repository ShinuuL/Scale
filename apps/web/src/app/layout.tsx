import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { PALETTE_BOOT_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'Scale — P2P Video Calls',
  description: 'Scale — escamas de dragão, videochamadas P2P mesh powered by WebRTC',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/favicon-32x32.png', type: 'image/png', sizes: '32x32' },
      { url: '/favicon-16x16.png', type: 'image/png', sizes: '16x16' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Tema salvo aplicado antes da 1a pintura (texto estático, sem dado do usuário) */}
        <script dangerouslySetInnerHTML={{ __html: PALETTE_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-forest-950 text-slate-100 antialiased">
        {/* Skip to content link for accessibility */}
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <div id="app-root">
          {children}
        </div>
      </body>
    </html>
  );
}
