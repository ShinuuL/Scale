'use client';

import { useCallback, useEffect, useState } from 'react';
import { MCP_SCOPE_LABELS, type ConnectedApp, type McpScope } from '@scale/shared';
import { api } from '@/lib/api';
import { AppModal } from '@/components/ui/AppModal';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

/** Rotulo curto de cada permissao na lista (o texto longo fica no consentimento). */
const SCOPE_SHORT: Record<McpScope, string> = {
  channels: 'Canais de texto',
  'community.manage': 'Configurar comunidades',
  'room.chat': 'Chat das salas',
};

const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

function lastUsedText(iso: string | null): string {
  if (!iso) return 'Ainda não usado';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return 'Usado agora há pouco';
  if (minutes < 60 * 24) return `Usado ${relative.format(-Math.round(minutes / 60), 'hour')}`;
  if (minutes < 60 * 24 * 30) return `Usado ${relative.format(-Math.round(minutes / 1440), 'day')}`;
  return `Usado em ${dateFormat.format(new Date(iso))}`;
}

/** Endereco que o usuario cola no cliente MCP (mesmo origin do site). */
const mcpUrl = () => (typeof window === 'undefined' ? '/mcp' : `${window.location.origin}/mcp`);

/**
 * Configurações > Apps conectados: apps de IA (clientes MCP) autorizados pela
 * tela de consentimento. Desconectar apaga a autorização e derruba os tokens.
 */
export function ConnectedApps() {
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [confirming, setConfirming] = useState<ConnectedApp | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoadError(false);
    api.getConnectedApps().then(setApps).catch(() => setLoadError(true));
  }, []);
  useEffect(load, [load]);

  return (
    <section aria-labelledby="settings-apps" className="space-y-3 border-t border-white/[0.08] pt-4">
      <h3 id="settings-apps" className="text-xs font-medium text-ink-muted">
        Apps conectados
      </h3>

      {notice && <p role="status" className="text-sm text-ink-secondary">{notice}</p>}

      {loadError && (
        <Banner variant="error">
          Não foi possível carregar seus apps conectados.{' '}
          <button type="button" onClick={load} className="underline underline-offset-4">Tentar de novo</button>
        </Banner>
      )}

      {!apps && !loadError && <p role="status" className="text-sm text-ink-muted">Carregando…</p>}

      {apps && apps.length === 0 && <EmptyState />}

      {apps && apps.length > 0 && (
        <ul className="divide-y divide-white/[0.06] rounded-lg border border-white/[0.08]">
          {apps.map((app) => (
            <li key={app.id} className="flex items-start gap-3 px-3 py-3">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
                <Icon name="link" size={16} />
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="truncate text-sm font-medium text-ink-primary" title={app.name}>{app.name}</p>
                <p className="text-xs text-ink-muted">
                  {app.scopes.map((s) => SCOPE_SHORT[s]).join(', ')}
                </p>
                <p className="text-xs text-ink-muted tabular-nums">
                  Conectado em {dateFormat.format(new Date(app.createdAt))} · {lastUsedText(app.lastUsedAt)}
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => { setNotice(null); setConfirming(app); }}
                aria-label={`Desconectar ${app.name}`}
              >
                Desconectar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {confirming && (
        <DisconnectDialog
          app={confirming}
          onClose={() => setConfirming(null)}
          onDone={(name) => {
            setApps((list) => list?.filter((a) => a.id !== confirming.id) ?? null);
            setConfirming(null);
            setNotice(`${name} foi desconectado. Ele não acessa mais sua conta.`);
          }}
        />
      )}
    </section>
  );
}

function EmptyState() {
  const [copied, setCopied] = useState(false);
  const url = mcpUrl();
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* sem permissao de area de transferencia: o texto continua selecionavel */ }
  }
  return (
    <div className="space-y-3 text-sm text-ink-secondary">
      <p>
        Nenhum app conectado. Assistentes de IA compatíveis com MCP, como o Claude, podem ler e enviar mensagens
        e configurar suas comunidades por você. Adicione este endereço como servidor MCP no app e autorize quando
        o Scale pedir:
      </p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 select-all truncate rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 font-mono text-xs text-ink-primary">
          {url}
        </code>
        <Button variant="secondary" size="sm" onClick={() => void copy()} aria-label="Copiar endereço do servidor MCP">
          {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
      <p className="sr-only" role="status">{copied ? 'Endereço copiado' : ''}</p>
    </div>
  );
}

function DisconnectDialog({ app, onClose, onDone }: { app: ConnectedApp; onClose: () => void; onDone: (name: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.disconnectApp(app.id);
      onDone(app.name);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 404) { onDone(app.name); return; }
      setError(status === 429 ? 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' : 'Não foi possível desconectar. Tente de novo.');
      setBusy(false);
    }
  }
  return (
    <AppModal title={`Desconectar ${app.name}?`} onClose={onClose} locked={busy}>
      <div className="space-y-4 text-sm text-ink-secondary">
        <p>O app perde o acesso na hora. Para usar de novo, será preciso conectar e autorizar outra vez.</p>
        <ul className="space-y-1.5">
          {app.scopes.map((s) => (
            <li key={s} className="flex items-start gap-2">
              <Icon name="close" size={14} className="mt-0.5 shrink-0 text-ink-muted" />
              <span>{MCP_SCOPE_LABELS[s]}</span>
            </li>
          ))}
        </ul>
        <p>Mensagens já enviadas por ele continuam no histórico com o selo “via {app.name}”.</p>
        {error && <Banner variant="error">{error}</Banner>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Manter conectado</Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? 'Desconectando…' : 'Desconectar'}
          </Button>
        </div>
      </div>
    </AppModal>
  );
}
