'use client';

import { useEffect, useRef } from 'react';

export interface CallKeepAliveOptions {
  /** Chamada ativa (entrou na sala). Fora disso o hook não faz nada. */
  active: boolean;
  /** Nome exibido na Media Session (tela de bloqueio / notificação). */
  roomName: string;
  /** Desligar pela Media Session (opcional). */
  onHangup?: () => void;
  /** Alternar microfone pela Media Session (opcional). */
  onToggleMicrophone?: () => void;
}

interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}

interface WakeLockLike {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

type ExtendedAction = MediaSessionAction | 'hangup' | 'togglemicrophone';

function getWakeLock(): WakeLockLike | null {
  if (typeof navigator === 'undefined') return null;
  const wl = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return wl && typeof wl.request === 'function' ? wl : null;
}

function getMediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return null;
  return navigator.mediaSession ?? null;
}

function setAction(session: MediaSession, action: ExtendedAction, handler: (() => void) | null) {
  try {
    session.setActionHandler(action as MediaSessionAction, handler);
  } catch {
    // Ação não suportada pelo navegador.
  }
}

/** Retoma os <audio> remotos que o navegador pausou em segundo plano. */
export function resumePausedAudio(root: ParentNode = document): void {
  root.querySelectorAll('audio').forEach((el) => {
    if (!el.paused) return;
    try {
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      // Autoplay bloqueado: ignora.
    }
  });
}

/**
 * Mantém a chamada viva no celular: Wake Lock de tela, Media Session com
 * ações de desligar/microfone e retomada de áudio ao voltar ao primeiro plano.
 */
export function useCallKeepAlive({
  active,
  roomName,
  onHangup,
  onToggleMicrophone,
}: CallKeepAliveOptions): void {
  const hangupRef = useRef(onHangup);
  const micRef = useRef(onToggleMicrophone);
  hangupRef.current = onHangup;
  micRef.current = onToggleMicrophone;
  const hasHangup = Boolean(onHangup);
  const hasMic = Boolean(onToggleMicrophone);

  // Wake Lock + retomada de áudio
  useEffect(() => {
    if (!active || typeof document === 'undefined') return;
    const wakeLock = getWakeLock();
    let sentinel: WakeLockSentinelLike | null = null;
    let disposed = false;

    const request = async () => {
      if (!wakeLock || document.visibilityState !== 'visible') return;
      if (sentinel && !sentinel.released) return;
      try {
        const s = await wakeLock.request('screen');
        if (disposed) {
          void s.release().catch(() => {});
          return;
        }
        sentinel = s;
      } catch {
        // Negado (bateria fraca, sem gesto etc.).
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      void request();
      resumePausedAudio();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);

  // Media Session
  useEffect(() => {
    if (!active) return;
    const session = getMediaSession();
    if (!session) return;
    try {
      if (typeof MediaMetadata !== 'undefined') {
        session.metadata = new MediaMetadata({ title: roomName, artist: 'Scale' });
      }
    } catch {
      // MediaMetadata indisponível.
    }
    if (hasHangup) setAction(session, 'hangup', () => hangupRef.current?.());
    if (hasMic) setAction(session, 'togglemicrophone', () => micRef.current?.());
    return () => {
      if (hasHangup) setAction(session, 'hangup', null);
      if (hasMic) setAction(session, 'togglemicrophone', null);
      try {
        session.metadata = null;
      } catch {
        // ignora
      }
    };
  }, [active, roomName, hasHangup, hasMic]);
}
