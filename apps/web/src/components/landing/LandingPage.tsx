'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/ui/Logo';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon, type IconName } from '@/components/ui/Icon';

/** Chave (sessionStorage) da escolha "continuar como convidado" nesta aba. */
export const GUEST_BROWSE_KEY = 'scale.guestBrowse';

export function hasChosenGuest(): boolean {
  try {
    return sessionStorage.getItem(GUEST_BROWSE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function rememberGuestChoice() {
  try {
    sessionStorage.setItem(GUEST_BROWSE_KEY, 'true');
  } catch {
    // Armazenamento bloqueado: a escolha vale só para esta renderização.
  }
}

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: 'mic',
    title: 'Voz direto entre vocês',
    text: 'Chamadas ponto a ponto com até 8 pessoas, sem instalar nada.',
  },
  {
    icon: 'monitor',
    title: 'Tela compartilhada',
    text: 'Mostre o que está fazendo com um clique, no meio da conversa.',
  },
  {
    icon: 'chat',
    title: 'Chat e arquivos',
    text: 'Mensagens com menções e arquivos nas salas persistentes.',
  },
  {
    icon: 'lock',
    title: 'Salas privadas',
    text: 'Convite por link ou senha. Temporárias somem sozinhas.',
  },
];

/**
 * Recepção de visitante sem sessão: apresenta o Scale e oferece entrar,
 * criar conta, usar um código de sala ou seguir como convidado.
 */
export function LandingPage({
  onContinueAsGuest,
  onJoinRoom,
}: {
  onContinueAsGuest: () => void;
  onJoinRoom: (code: string) => void;
}) {
  const [code, setCode] = useState('');

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim();
    if (trimmed) onJoinRoom(trimmed);
  };

  return (
    <div className="min-h-screen bg-surface-base text-ink-primary">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-8">
        <Logo variant="full" priority />
        <nav aria-label="Conta" className="flex items-center gap-2">
          <Link
            href="/login"
            className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-ink-secondary hover:text-ink-primary"
          >
            Entrar
          </Link>
          <Link
            href="/register"
            className="inline-flex min-h-11 items-center rounded-md bg-accent-solid px-4 text-sm font-medium text-white"
          >
            Criar conta
          </Link>
        </nav>
      </header>

      <main>
        <section
          aria-labelledby="landing-title"
          className="mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-10 sm:px-8 lg:grid-cols-[1.2fr_1fr] lg:items-center lg:pt-20"
        >
          <div>
            <h1
              id="landing-title"
              className="text-4xl font-semibold leading-tight tracking-tight sm:text-5xl"
            >
              Sua sala de voz, sem complicação.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink-secondary">
              O Scale junta voz, tela compartilhada e chat numa sala só. Crie uma conta para
              abrir suas salas ou entre numa conversa com o link que recebeu.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/register"
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-accent-solid px-5 text-sm font-medium text-white"
              >
                Começar agora <Icon name="arrowRight" />
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center rounded-md border border-line px-5 text-sm font-medium"
              >
                Já tenho conta
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface-secondary p-6">
            <h2 className="text-base font-semibold">Recebeu um convite?</h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              Cole o código da sala para entrar sem criar conta.
            </p>
            <form onSubmit={submitCode} className="mt-4 flex gap-2">
              <div className="flex-1">
                <Input
                  aria-label="Código da sala no convite"
                  placeholder="Código da sala"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </div>
              <Button type="submit" disabled={!code.trim()}>
                Entrar na sala
              </Button>
            </form>
            <div className="mt-6 border-t border-line pt-4">
              <button
                type="button"
                onClick={onContinueAsGuest}
                className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-accent"
              >
                Continuar como convidado <Icon name="arrowRight" />
              </button>
            </div>
          </div>
        </section>

        <section aria-labelledby="features-title" className="border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8">
            <h2 id="features-title" className="sr-only">
              Recursos
            </h2>
            <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
                <li key={feature.title}>
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent-subtle text-accent">
                    <Icon name={feature.icon} size={20} />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold">{feature.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-ink-secondary">{feature.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-ink-muted sm:px-8">
          <span>Scale</span>
          <Link href="/tutorial" className="hover:text-ink-primary">
            Como usar o Scale
          </Link>
        </div>
      </footer>
    </div>
  );
}
