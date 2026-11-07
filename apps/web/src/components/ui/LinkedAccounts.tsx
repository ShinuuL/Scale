'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

type Provider = 'github' | 'google';

const PROVIDER_NAME: Record<Provider, string> = { github: 'GitHub', google: 'Google' };

const LINK_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  ok: { text: 'Conta {p} vinculada. Agora você pode entrar com ela.', ok: true },
  outra_conta: { text: 'Essa conta {p} já está vinculada a outro usuário do Scale.', ok: false },
  ja_vinculado: { text: 'Você já tem outra conta {p} vinculada.', ok: false },
  cancelado: { text: 'Vínculo com {p} cancelado.', ok: false },
  limite: { text: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.', ok: false },
  falhou: { text: 'Não foi possível vincular a conta {p}. Tente de novo.', ok: false },
};

/** Parametro `?vinculo=<provedor>.<status>` deixado pelo callback (null se nao houver). */
export function hasLinkResult(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('vinculo');
}

/** Le e REMOVE da URL o resultado do vinculo. */
function takeLinkResult(): { text: string; ok: boolean } | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const raw = url.searchParams.get('vinculo');
  if (!raw) return null;
  url.searchParams.delete('vinculo');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  const [provider, status] = raw.split('.');
  if (provider !== 'github' && provider !== 'google') return null;
  const msg = LINK_MESSAGES[status ?? ''] ?? LINK_MESSAGES.falhou;
  return { text: msg.text.replace('{p}', PROVIDER_NAME[provider]), ok: msg.ok };
}

/**
 * Contas vinculadas (Configurações): mostra GitHub/Google ligados no servidor e
 * permite vincular. O botão é um link de navegação: o fluxo passa pelo site do
 * provedor e volta para `/?vinculo=...`.
 */
export function LinkedAccounts() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [links, setLinks] = useState<{ github: { login: string } | null; google: boolean } | null>(null);
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    setResult(takeLinkResult());
    let alive = true;
    Promise.all([api.getAuthProviders(), api.getLinkedAccounts()])
      .then(([p, l]) => {
        if (!alive) return;
        const list: Provider[] = [];
        if (p.google) list.push('google');
        if (p.github) list.push('github');
        setProviders(list);
        setLinks(l);
      })
      .catch(() => alive && setProviders([]));
    return () => {
      alive = false;
    };
  }, []);

  if (providers.length === 0 && !result) return null;

  return (
    <section aria-labelledby="settings-links" className="space-y-3 border-t border-white/[0.08] pt-4">
      <h3 id="settings-links" className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Contas vinculadas
      </h3>
      {result && (
        <p
          role={result.ok ? 'status' : 'alert'}
          className={
            result.ok
              ? 'rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-200'
              : 'rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300'
          }
        >
          {result.text}
        </p>
      )}
      <ul className="space-y-2">
        {providers.map((provider) => {
          const linked = provider === 'github' ? links?.github : links?.google;
          const detail = provider === 'github' && links?.github ? `@${links.github.login}` : null;
          return (
            <li key={provider} className="flex items-center gap-3 text-sm text-slate-200">
              <Icon name={provider} size={18} />
              <span className="flex-1">
                {PROVIDER_NAME[provider]}
                {detail && <span className="ml-2 text-slate-400">{detail}</span>}
              </span>
              {linked ? (
                <span className="inline-flex items-center gap-1 text-xs text-brand-200">
                  <Icon name="check" size={14} />
                  Vinculada
                </span>
              ) : (
                <a
                  href={`/api/auth/${provider}/link`}
                  className="btn-secondary px-3 py-1.5 text-xs font-medium focus-visible:ring-2 focus-visible:ring-brand-400"
                  aria-label={`Vincular conta ${PROVIDER_NAME[provider]}`}
                >
                  Vincular
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
