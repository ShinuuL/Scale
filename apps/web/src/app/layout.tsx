import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import './globals.css';
import { PALETTE_BOOT_SRC } from '@/lib/theme';
import { CallCenter } from '@/components/calls/CallCenter';
import { ApplicationFeatures } from '@/components/pwa/ApplicationFeatures';

export const metadata: Metadata = {
  title: 'Scale — P2P Video Calls',
  description: 'Scale — escamas de dragão, videochamadas P2P mesh powered by WebRTC',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  manifest: '/manifest.webmanifest',
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
        {/* Tema salvo aplicado antes da 1a pintura. Sincrono de proposito (precisa
            rodar antes do body pintar) e arquivo estatico para a CSP nao exigir
            'unsafe-inline' em script-src. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src={PALETTE_BOOT_SRC} />
      </head>
      <body className="min-h-screen bg-forest-950 text-slate-100 antialiased">
        {/* Skip to content link for accessibility */}
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <div id="app-root">
          {children}
        </div>
        {/* Chamadas entre amigos: tela tocando e "Chamando…" em qualquer pagina. */}
        <CallCenter />
        <ApplicationFeatures />
      </body>
    </html>
  );
}
