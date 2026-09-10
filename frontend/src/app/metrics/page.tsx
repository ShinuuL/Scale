'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Metrics } from '@/lib/validation';
import { Badge } from '@/components/ui/Badge';

const REFRESH_MS = 10_000;

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

interface MetricCardProps {
  label: string;
  value: string;
  hint: string;
  accent: 'brand' | 'emerald' | 'amber';
}

const accentText = {
  brand: 'text-brand-300',
  emerald: 'text-emerald-300',
  amber: 'text-amber-300',
} as const;

function MetricCard({ label, value, hint, accent }: MetricCardProps) {
  return (
    <div className="glass rounded-2xl p-6 flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span className={`text-4xl font-bold tabular-nums ${accentText[accent]}`}>
        {value}
      </span>
      <span className="text-xs text-slate-500">{hint}</span>
    </div>
  );
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const data = await api.getMetrics();
        if (!cancelled) {
          setMetrics(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Não foi possível carregar as métricas do backend');
          console.error(err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void refresh();
    const interval = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const roomBreaks = metrics
    ? Object.entries(metrics.peers.byRoom)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
    : [];

  return (
    <main id="main-content" className="min-h-screen relative overflow-hidden">
      {/* Background */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[450px] bg-brand-600/10 blur-[140px] rounded-full" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-brand-600/10 via-transparent to-transparent" />

      <div className="relative max-w-5xl mx-auto px-4 py-12 space-y-8">
        {/* Header */}
        <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 bg-brand-500/10 text-brand-300 text-xs font-medium px-3 py-1.5 rounded-full border border-brand-500/20">
              <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
              Observabilidade
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
              <span className="bg-gradient-to-r from-white via-white to-slate-400 bg-clip-text text-transparent">
                Métricas do{' '}
              </span>
              <span className="bg-gradient-to-r from-brand-400 to-brand-600 bg-clip-text text-transparent">
                sistema
              </span>
            </h1>
            <p className="text-slate-400 text-sm">
              {metrics
                ? `Atualizado a cada 10s · v${metrics.version}`
                : 'Carregando métricas...'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={error ? 'error' : 'success'}>
              {error ? 'Offline' : loading ? 'Conectando…' : 'Online'}
            </Badge>
            <Link
              href="/"
              className="text-sm font-medium text-brand-400 hover:text-brand-300 transition-colors"
            >
              ← Voltar
            </Link>
          </div>
        </header>

        {error && (
          <div
            className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-sm text-red-300"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Cards row 1 */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard
            label="Uptime"
            value={metrics ? formatUptime(metrics.uptimeSeconds) : '—'}
            hint="Tempo desde o start do backend"
            accent="brand"
          />
          <MetricCard
            label="Total de salas"
            value={metrics ? String(metrics.rooms.total) : '—'}
            hint="Salas no banco de dados"
            accent="brand"
          />
          <MetricCard
            label="Salas ativas"
            value={metrics ? String(metrics.rooms.active) : '—'}
            hint="Status ACTIVE e não expiradas"
            accent="emerald"
          />
          <MetricCard
            label="Salas com peers"
            value={metrics ? String(metrics.rooms.withPeers) : '—'}
            hint="Salas com participantes conectados agora"
            accent="brand"
          />
          <MetricCard
            label="Peers conectados"
            value={metrics ? String(metrics.peers.total) : '—'}
            hint="Participantes em salas via Socket.io"
            accent="emerald"
          />
          <MetricCard
            label="Memória RSS"
            value={metrics ? formatBytes(metrics.memory.rss) : '—'}
            hint={`Heap ${metrics ? formatBytes(metrics.memory.heapUsed) : '—'} usado`}
            accent="amber"
          />
        </section>

        {/* Room breakdown */}
        <section>
          <h2 className="text-sm font-semibold text-slate-200 mb-3">
            Peers por sala
          </h2>
          {roomBreaks.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-sm text-slate-500">
              Nenhum peer conectado no momento.
            </div>
          ) : (
            <ul className="space-y-2">
              {roomBreaks.map(([roomId, count]) => (
                <li
                  key={roomId}
                  className="glass-subtle p-4 rounded-xl flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 font-mono truncate">
                      {roomId}
                    </p>
                    <p className="text-xs text-slate-500">
                      Sala de videochamada
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-slate-200 tabular-nums">
                      {count}
                    </span>
                    <Badge variant="info">
                      {count === 1 ? 'peer' : 'peers'}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Footer */}
        <footer className="text-xs text-slate-600 text-center pt-4">
          Scale 🐉 · P2P Video Calls · escamas de dragão · mesh 2–8 participantes
        </footer>
      </div>
    </main>
  );
}