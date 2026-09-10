'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { TailscaleShareTutorial } from '@/components/onboarding/TailscaleShareTutorial';

export default function TutorialPage() {
  return (
    <main id="main-content" className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-600/10 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-brand-600/5 blur-[120px] rounded-full pointer-events-none" />

        <div className="relative max-w-2xl mx-auto px-4 pt-24 pb-8 text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-brand-500/10 text-brand-300 text-xs font-medium px-3 py-1.5 rounded-full border border-brand-500/20">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            Tutorial
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-white via-white to-slate-400 bg-clip-text text-transparent">
              Como compartilhar na rede
            </span>
          </h1>

          <p className="text-slate-400 text-base max-w-lg mx-auto leading-relaxed">
            Guia passo a passo para configurar Tailscale e compartilhar salas do Scale
            com seus amigos via rede mesh privada.
          </p>
        </div>
      </section>

      {/* Tutorial content */}
      <section className="max-w-2xl mx-auto px-4 pb-16">
        <TailscaleShareTutorial />
      </section>

      {/* Footer nav */}
      <section className="max-w-2xl mx-auto px-4 pb-24 text-center">
        <Link href="/" className="inline-block">
          <Button variant="ghost" size="sm">
            ← Voltar ao Scale
          </Button>
        </Link>
      </section>
    </main>
  );
}
