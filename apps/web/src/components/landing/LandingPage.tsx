'use client';

import '@fontsource-variable/sora';
import './landing.css';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LazyMotion, domAnimation } from 'motion/react';
import { Hero } from './scenes/Hero';
import { Connection } from './scenes/Connection';
import { Room } from './scenes/Room';
import { Community } from './scenes/Community';
import { Friends } from './scenes/Friends';
import { Manifesto } from './scenes/Manifesto';
import { Platforms } from './scenes/Platforms';
import { Faq } from './scenes/Faq';
import { Final } from './scenes/Final';
import { BrandButton } from './primitives/BrandButton';
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
export function LandingPage({
  onContinueAsGuest,
  onJoinRoom
}: {
  onContinueAsGuest: () => void;
  onJoinRoom: (code: string) => void;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 40);
    update();
    window.addEventListener('scroll', update, {
      passive: true
    });
    return () => window.removeEventListener('scroll', update);
  }, []);
  return <LazyMotion features={domAnimation} strict>
    <div className="landing">
      <header className={`l-header ${scrolled ? 'is-scrolled' : ''}`}>
        <Link className="l-brand" href="/">
          <img src="/logo.png" alt="" />
          <span>Scale</span>
        </Link>
        <nav aria-label="Conta">
          <Link href="/login">Entrar</Link>
          <BrandButton href="/register" outline>Criar conta</BrandButton>
        </nav>
      </header>
      <main>
        <Hero onContinueAsGuest={onContinueAsGuest} onJoinRoom={onJoinRoom} />
        <Connection />
        <Room />
        <Community />
        <Friends />
        <Manifesto />
        <Platforms />
        <Faq />
        <Final />
      </main>
      <footer className="l-footer">
        <strong>Scale</strong>
        <nav aria-label="Rodapé">
          <Link href="/tutorial">Como usar</Link>
          <Link href="/docs">Documentação</Link>
          <Link href="/privacy">Privacidade</Link>
        </nav>
      </footer>
    </div>
  </LazyMotion>;
}
