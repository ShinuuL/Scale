'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import type { Metrics } from '@/lib/validation';
import { BackToAdminLink } from '@/components/admin/BackToAdminLink';
import { Badge } from '@/components/ui/Badge';
import { AppShell } from '@/components/layout/AppShell';
import { HelpSidebar } from '@/components/layout/HelpSidebar';
import { Skeleton } from '@/components/ui/Skeleton';

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
    <div className="border-b border-line py-5 flex flex-col gap-2">
      <span className="text-sm font-medium text-ink-secondary">
        {label}
      </span>
      <span className={`text-[28px] font-semibold tabular-nums ${accentText[accent]}`}>
        {value}
      </span>
      <span className="text-xs text-ink-muted">{hint}</span>
    </div>
  );
}

export default function MetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 401 não é "backend fora": é sessão ausente/expirada. O endpoint exige JWT
  // desde que o app passou a ser exposto publicamente, então a UI precisa
  // dizer isso e oferecer o login em vez de acusar falha de conexão.
  const [needsAuth, setNeedsAuth] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const data = await api.getMetrics();
        if (!cancelled) {
          setMetrics(data);
          setError(null);
          setNeedsAuth(false);
        }
      } catch (err) {
        if (!cancelled) {
          const status = (err as { status?: number }).status;
          if (status === 401) {
            setNeedsAuth(true);
            setError('As métricas exigem autenticação. Entre com sua conta para vê-las.');
          } else if (status === 403) {
            // Logado, mas fora da allowlist METRICS_ADMIN_EMAILS do backend.
            setNeedsAuth(false);
            setError('As métricas são restritas a administradores.');
          } else {
            setNeedsAuth(false);
            setError('Não foi possível carregar as métricas do backend');
          }
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
  }, [needsAuth]);

  const roomBreaks = metrics
    ? [...metrics.peers.perRoom].sort((a, b) => b - a).slice(0, 12)
    : [];

  return (
    <AppShell activeSection="help" title="Métricas do sistema" contextSidebar={<HelpSidebar active="metrics" />}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><BackToAdminLink /><h2 className="text-[28px] font-semibold leading-9 tracking-tight">Métricas do sistema</h2><p className="mt-2 text-sm text-ink-secondary">{metrics ? 'Atualizado a cada 10 segundos.' : loading ? 'Carregando métricas...' : 'Acesso restrito ao servidor.'}</p></div>
          <Badge variant={needsAuth ? 'info' : error ? 'error' : loading ? 'default' : 'success'}>{needsAuth ? 'Requer login' : error ? 'Indisponível' : loading ? 'Conectando...' : 'Conectado'}</Badge>
        </header>

        {error && (
          <div
            className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-sm text-red-300 flex flex-wrap items-center gap-x-3 gap-y-2"
            role="alert"
          >
            <span>{error}</span>
            {needsAuth && (
              <Link
                href="/login"
                className="font-medium text-brand-400 hover:text-brand-300 underline underline-offset-2 transition-colors"
              >
                Entrar
              </Link>
            )}
          </div>
        )}

        {loading && <div role="status" aria-label="Carregando métricas" className="grid gap-4 sm:grid-cols-3"><Skeleton /><Skeleton /><Skeleton /></div>}
        {metrics && <>
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
        </section>

        {/* Room breakdown */}
        <section>
          <h2 className="text-sm font-semibold text-ink-primary mb-3">
            Peers por sala
          </h2>
          {roomBreaks.length === 0 ? (
            <div className="glass rounded-2xl p-6 text-sm text-ink-muted">
              Nenhum peer conectado no momento.
            </div>
          ) : (
            <ul className="space-y-2">
              {roomBreaks.map((count, index) => (
                <li
                  key={index}
                  className="glass-subtle p-4 rounded-xl flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-primary truncate">
                      Sala {index + 1}
                    </p>
                    <p className="text-xs text-ink-muted">
                      Sala de videochamada
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-ink-primary tabular-nums">
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

        </>}
      </div>
      </div>
    </AppShell>
  );
}