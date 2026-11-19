'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MCP_SCOPE_LABELS, oauthAuthorizeParamsSchema, type McpScope, type OAuthAuthorizeError, type OAuthAuthorizeInfo } from '@scale/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Banner } from '@/components/ui/Banner';
import { Card, CardContent } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Logo } from '@/components/ui/Logo';

/**
 * Consentimento de app conectado (servidor MCP). O cliente MCP abre esta
 * pagina com a query OAuth; ela pergunta ao servidor quem pede o que e devolve
 * o usuario ao app com o codigo (ou com access_denied).
 */

const SCOPE_ICON: Record<McpScope, IconName> = { channels: 'chat', 'community.manage': 'settings', 'room.chat': 'mic' };

const REQUEST_ERRORS: Record<OAuthAuthorizeError, string> = {
  invalid_request: 'O link de autorização está incompleto. Volte ao app e comece a conexão de novo.',
  unknown_client: 'Este app não está registrado no Scale. Volte ao app e comece a conexão de novo.',
  invalid_redirect: 'O endereço de retorno deste app não confere com o registrado. Por segurança, a conexão foi bloqueada.',
  invalid_scope: 'O app pediu uma permissão que o Scale não oferece. Volte ao app e tente de novo.',
};

type View =
  | { kind: 'loading' }
  | { kind: 'ready'; info: OAuthAuthorizeInfo; params: Record<string, string> }
  | { kind: 'request-error'; message: string }
  | { kind: 'load-error' }
  | { kind: 'leaving'; approved: boolean; host: string; redirectTo: string };

function readParams(): Record<string, string> | null {
  const raw = Object.fromEntries(new URLSearchParams(window.location.search));
  return oauthAuthorizeParamsSchema.safeParse(raw).success ? raw : null;
}

const loginHref = () => `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;

export default function OAuthAuthorizePage() {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [busy, setBusy] = useState<'approve' | 'deny' | 'switch' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const params = readParams();
    if (!params) {
      setView({ kind: 'request-error', message: REQUEST_ERRORS.invalid_request });
      return;
    }
    let alive = true;
    setView({ kind: 'loading' });
    api.getOAuthAuthorizeInfo(window.location.search.slice(1))
      .then((info) => alive && setView({ kind: 'ready', info, params }))
      .catch((err: unknown) => {
        if (!alive) return;
        const { status, error } = (err ?? {}) as { status?: number; error?: string };
        if (status === 401) { window.location.replace(loginHref()); return; }
        if (status === 400 && error && error in REQUEST_ERRORS) {
          setView({ kind: 'request-error', message: REQUEST_ERRORS[error as OAuthAuthorizeError] });
          return;
        }
        setView({ kind: 'load-error' });
      });
    return () => { alive = false; };
  }, [attempt]);

  async function decide(approve: boolean) {
    if (view.kind !== 'ready' || busy) return;
    setBusy(approve ? 'approve' : 'deny');
    setActionError(null);
    try {
      const { redirectTo } = await api.decideOAuthAuthorize(view.params, approve);
      setView({ kind: 'leaving', approved: approve, host: view.info.client.redirectHost, redirectTo });
      window.location.assign(redirectTo);
    } catch (err: unknown) {
      const status = (err as { status?: number })?.status;
      if (status === 401) { window.location.replace(loginHref()); return; }
      setActionError(status === 400
        ? 'O pedido deste app não é mais válido. Volte ao app e comece a conexão de novo.'
        : 'Não foi possível concluir. Verifique sua conexão e tente de novo.');
      setBusy(null);
    }
  }

  async function switchAccount() {
    if (busy) return;
    setBusy('switch');
    try { await api.logout(); } catch { /* ja sem sessao: segue para o login */ }
    window.location.assign(loginHref());
  }

  return (
    <main id="main-content" className="auth-page">
      <Link href="/" className="auth-brand" aria-label="Scale, página inicial">
        <Logo variant="full" size={36} priority />
      </Link>
      <Card variant="glass" className="w-full max-w-md">
        <CardContent className="p-0">
          {view.kind === 'loading' && (
            <p role="status" className="text-sm text-ink-muted">Carregando pedido de conexão…</p>
          )}

          {view.kind === 'load-error' && (
            <div className="space-y-4">
              <h1 className="text-xl font-semibold text-balance">Não foi possível carregar o pedido</h1>
              <Banner variant="error">Verifique sua conexão e tente de novo.</Banner>
              <Button className="w-full" onClick={() => setAttempt((n) => n + 1)}>Tentar de novo</Button>
            </div>
          )}

          {view.kind === 'request-error' && (
            <div className="space-y-4">
              <h1 className="text-xl font-semibold text-balance">Conexão não autorizada</h1>
              <Banner variant="error">{view.message}</Banner>
              <Link href="/" className="inline-block text-sm text-accent">Ir para o Scale</Link>
            </div>
          )}

          {view.kind === 'leaving' && (
            <div className="space-y-3" role="status">
              <h1 className="text-xl font-semibold text-balance">
                {view.approved ? 'App conectado' : 'Conexão cancelada'}
              </h1>
              <p className="text-sm text-ink-secondary">
                Pode voltar ao seu app. Estamos levando você para <span className="font-medium text-ink-primary">{view.host}</span>.
              </p>
              <a href={view.redirectTo} className="inline-block text-sm text-accent underline underline-offset-4">
                Se nada acontecer, continue por aqui
              </a>
            </div>
          )}

          {view.kind === 'ready' && (
            <ConsentForm
              info={view.info}
              busy={busy}
              error={actionError}
              onApprove={() => void decide(true)}
              onDeny={() => void decide(false)}
              onSwitchAccount={() => void switchAccount()}
            />
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function ConsentForm({ info, busy, error, onApprove, onDeny, onSwitchAccount }: {
  info: OAuthAuthorizeInfo;
  busy: 'approve' | 'deny' | 'switch' | null;
  error: string | null;
  onApprove: () => void;
  onDeny: () => void;
  onSwitchAccount: () => void;
}) {
  const asksMore = info.alreadyConnected && info.newScopes.length > 0;
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight text-balance">
          {asksMore ? <><span className="break-words">{info.client.name}</span> pede mais acesso</> : <>Conectar <span className="break-words">{info.client.name}</span> à sua conta</>}
        </h1>
        <p className="flex items-start gap-2 text-sm text-ink-muted">
          <Icon name="info" size={16} className="mt-0.5 shrink-0" />
          <span>O nome foi informado pelo próprio app e não foi verificado pelo Scale. Ao terminar, você volta para <span className="font-medium text-ink-secondary">{info.client.redirectHost}</span>.</span>
        </p>
      </header>

      <div className="flex items-center gap-3 rounded-lg border border-white/[0.08] px-3 py-2.5">
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate font-medium text-ink-primary">{info.user.name}</p>
          <p className="truncate text-ink-muted">{info.user.email}</p>
        </div>
        <button
          type="button"
          onClick={onSwitchAccount}
          disabled={busy !== null}
          className="shrink-0 rounded-md px-2 py-1 text-sm text-accent underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-60"
        >
          {busy === 'switch' ? 'Saindo…' : 'Trocar de conta'}
        </button>
      </div>

      <section aria-labelledby="consent-scopes" className="space-y-3">
        <h2 id="consent-scopes" className="text-sm font-medium text-ink-primary">
          {asksMore ? 'Permissões novas' : 'O app poderá'}
        </h2>
        <ul className="space-y-2.5">
          {info.scopes.map((scope) => {
            const isNew = !info.alreadyConnected || info.newScopes.includes(scope);
            return (
              <li key={scope} className={`flex items-start gap-3 text-sm ${isNew ? 'text-ink-primary' : 'text-ink-muted'}`}>
                <Icon name={SCOPE_ICON[scope]} size={18} className={`mt-px shrink-0 ${isNew ? 'text-brand-300' : ''}`} />
                <span className="flex-1">
                  {MCP_SCOPE_LABELS[scope]}
                  {!isNew && <span className="sr-only"> (já autorizado)</span>}
                </span>
                {!isNew && <span aria-hidden className="shrink-0 text-xs text-ink-muted">Já autorizado</span>}
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-ink-secondary">
          O app age como você e nunca com mais poder que você. O que ele enviar aparece com seu nome e o selo
          {' '}<span className="font-medium text-ink-primary">via {info.client.name}</span>. Você pode desconectar quando quiser em
          {' '}Configurações, Apps conectados.
        </p>
      </section>

      {error && <Banner variant="error">{error}</Banner>}

      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={onDeny} disabled={busy !== null}>
          {busy === 'deny' ? 'Cancelando…' : 'Cancelar'}
        </Button>
        <Button onClick={onApprove} disabled={busy !== null}>
          {busy === 'approve' ? 'Autorizando…' : 'Autorizar'}
        </Button>
      </div>
    </div>
  );
}
