'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';

export default function DocsTailscalePage() {
  return (
    <main id="main-content" className="min-h-screen">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-brand-600/10 via-transparent to-transparent pointer-events-none" />
        <div className="relative max-w-3xl mx-auto px-4 pt-12 pb-8">
          <Link href="/tutorial" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-6">
            ← Voltar ao tutorial
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2">Configuração Tailscale — Documentação completa</h1>
          <p className="text-slate-400 text-sm">
            Arquivo original em <code className="bg-white/10 px-2 py-1 rounded text-brand-300 text-xs">docs/tailscale-setup.md</code> — disponível no repositório. Abaixo um resumo visual; para detalhes técnicos veja o tutorial interativo.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 pb-12 space-y-6">
        <Card variant="glass">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">📄 Documentação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-slate-300 leading-relaxed">
            <p>
              O guia completo está versionado em <code className="bg-white/10 px-1.5 py-0.5 rounded text-brand-300">docs/tailscale-setup.md</code> e cobre: instalação por SO, verificação de IP, compartilhamento de link, MagicDNS, CORS, firewall, ACL e troubleshooting WebRTC.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/tutorial" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 text-white text-sm font-medium hover:bg-brand-500 transition-colors">
                📖 Abrir tutorial interativo
              </Link>
              <a
                href="https://tailscale.com/docs/use-cases/personal-or-at-home-use/share-private-game-server"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 transition-colors"
              >
                🎮 Exemplo Tailscale ↗
              </a>
            </div>
            <div className="glass-subtle p-4 rounded-xl">
              <p className="text-xs font-medium text-slate-200 mb-2">Acesso rápido:</p>
              <ul className="space-y-1.5 text-xs text-slate-400">
                <li>• <code className="text-brand-300">tailscale ip -4</code> → seu IP 100.x</li>
                <li>• Link da sala: <code className="text-brand-300">http://100.x:3000/room/&lt;UUID&gt;</code></li>
                <li>• Verifique <code className="text-brand-300">/api/tailscale/status</code> no Scale</li>
              </ul>
            </div>
          </CardContent>
        </Card>

        <div className="text-center">
          <Link href="/">
            <Button variant="ghost" size="sm">← Voltar ao Scale</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
