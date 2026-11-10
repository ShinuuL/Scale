'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/components/ui/Icon';

type Provider = 'github' | 'google';

const PROVIDER_NAME: Record<Provider, string> = { github: 'GitHub', google: 'Google' };

/** Codigos de `/login?<provedor>=<codigo>` emitidos pelo callback do backend. */
function errorMessage(provider: Provider, code: string): string {
  const name = PROVIDER_NAME[provider];
  const messages: Record<string, string> = {
    cancelado: `Login com ${name} cancelado.`,
    falhou: `Não foi possível entrar com o ${name}. Tente de novo.`,
    outra_conta: `Sua conta do Scale já está vinculada a outra conta ${name}. Entre com ela ou com e-mail e senha.`,
    sem_email: `Seu ${name} não tem e-mail verificado. Verifique um e-mail no ${name} e tente de novo.`,
    limite: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
    desligado: `Login com ${name} não está disponível neste servidor.`,
  };
  return messages[code] ?? messages.falhou;
}

/** Mensagem do erro de login externo na URL atual (null se nao houver). */
export function readOAuthError(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  for (const provider of ['github', 'google'] as const) {
    const code = params.get(provider);
    if (code) return errorMessage(provider, code);
  }
  return null;
}

const BUTTON_CLASS =
  'btn-secondary w-full text-sm px-5 py-2.5 font-medium inline-flex items-center justify-center gap-2 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950';

/**
 * Botoes "Entrar com Google/GitHub" + divisor. So aparecem os provedores
 * ligados no servidor. Sao links (navegacao de topo), nao fetch: o fluxo OAuth
 * passa pelo site do provedor e volta por redirect.
 */
export function OAuthLoginButtons({ mode = 'login' }: { mode?: 'login' | 'register' }) {
  const [enabled, setEnabled] = useState<Provider[]>([]);

  useEffect(() => {
    let alive = true;
    api
      .getAuthProviders()
      .then((p) => {
        if (!alive) return;
        const list: Provider[] = [];
        if (p.google) list.push('google');
        if (p.github) list.push('github');
        setEnabled(list);
      })
      .catch(() => alive && setEnabled([]));
    return () => {
      alive = false;
    };
  }, []);

  if (enabled.length === 0) return null;
  const verb = mode === 'register' ? 'Criar conta com' : 'Entrar com';

  return (
    <>
      <div className="my-4 flex items-center gap-3 text-xs text-slate-400" aria-hidden>
        <span className="h-px flex-1 bg-white/10" />
        ou
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <div className="flex flex-col gap-2">
        {enabled.map((provider) => (
          <a key={provider} href={`/api/auth/${provider}`} className={BUTTON_CLASS} onClick={() => {
            if (new URLSearchParams(window.location.search).get('next') === '/invite') sessionStorage.setItem('scale:invite-oauth-return', String(Date.now()));
          }}>
            <Icon name={provider satisfies IconName} size={18} />
            {verb} {PROVIDER_NAME[provider]}
          </a>
        ))}
      </div>
    </>
  );
}
