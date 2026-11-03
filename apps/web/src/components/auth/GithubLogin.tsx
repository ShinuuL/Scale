'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

/** Codigos de `/login?github=<codigo>` emitidos pelo callback do backend. */
const GITHUB_ERRORS: Record<string, string> = {
  cancelado: 'Login com GitHub cancelado.',
  falhou: 'Não foi possível entrar com o GitHub. Tente de novo.',
  email_em_uso:
    'Já existe uma conta com o e-mail do seu GitHub. Entre com e-mail e senha.',
  sem_email:
    'Seu GitHub não tem e-mail principal verificado. Verifique um e-mail no GitHub e tente de novo.',
  limite: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  desligado: 'Login com GitHub não está disponível neste servidor.',
};

/** Mensagem do erro de GitHub na URL atual (null se nao houver). */
export function readGithubError(): string | null {
  if (typeof window === 'undefined') return null;
  const code = new URLSearchParams(window.location.search).get('github');
  if (!code) return null;
  return GITHUB_ERRORS[code] ?? GITHUB_ERRORS.falhou;
}

/**
 * Botao "Entrar com GitHub" + divisor. So aparece se o servidor tiver o
 * recurso ligado. E um link (navegacao de topo), nao fetch: o fluxo OAuth
 * passa pelo github.com e volta por redirect.
 */
export function GithubLoginButton({ label = 'Entrar com GitHub' }: { label?: string }) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .getAuthProviders()
      .then((p) => alive && setEnabled(p.github))
      .catch(() => alive && setEnabled(false));
    return () => {
      alive = false;
    };
  }, []);

  if (!enabled) return null;

  return (
    <>
      <div className="my-4 flex items-center gap-3 text-xs text-slate-400" aria-hidden>
        <span className="h-px flex-1 bg-white/10" />
        ou
        <span className="h-px flex-1 bg-white/10" />
      </div>
      <a
        href="/api/auth/github"
        className="btn-secondary w-full text-sm px-5 py-2.5 font-medium inline-flex items-center justify-center gap-2 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950"
      >
        <Icon name="github" size={18} />
        {label}
      </a>
    </>
  );
}
