'use client';

import { useEffect, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import type { VoiceFlagsPayload } from '@scale/shared';

/** Intervalo minimo entre dois avisos de "falando" (por socket). */
export const SPEAKING_MIN_INTERVAL_MS = 400;

export interface SpeakingThrottle {
  update: (speaking: boolean) => void;
  dispose: () => void;
}

/**
 * So manda TRANSICOES de "falando" e no maximo uma a cada `minIntervalMs`:
 * dentro da janela guarda o ultimo valor e envia no fim (trailing), se ainda
 * diferir do ultimo enviado. Assim o canal de voz da comunidade mostra quem
 * fala sem trafego por quadro de audio.
 */
export function createSpeakingThrottle(
  send: (speaking: boolean) => void,
  minIntervalMs = SPEAKING_MIN_INTERVAL_MS,
  now: () => number = Date.now,
): SpeakingThrottle {
  let sent = false;
  let lastAt = Number.NEGATIVE_INFINITY;
  let latest = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (latest === sent) return;
    sent = latest;
    lastAt = now();
    send(latest);
  };
  return {
    update(speaking) {
      latest = speaking;
      if (timer) return;
      const wait = lastAt + minIntervalMs - now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/**
 * Publica deafen, tela e "falando" do proprio peer (`peer:voice-flags`) para os
 * indicadores do canal de voz da comunidade. Reenvia tudo a cada entrada na sala.
 */
export function useVoiceFlags(
  socket: Socket | null,
  roomId: string,
  joined: boolean,
  flags: { deafened: boolean; screenSharing: boolean; speaking: boolean },
): void {
  const emit = useRef<(payload: Omit<VoiceFlagsPayload, 'roomId'>) => void>(() => undefined);
  emit.current = (payload) => {
    if (!socket?.connected || !joined) return;
    socket.emit('peer:voice-flags', { roomId, ...payload }, () => undefined);
  };
  const throttle = useRef<SpeakingThrottle | null>(null);
  useEffect(() => {
    const instance = createSpeakingThrottle((speaking) => emit.current({ speaking }));
    throttle.current = instance;
    return () => instance.dispose();
  }, []);
  useEffect(() => {
    emit.current({ deafened: flags.deafened, screenSharing: flags.screenSharing });
  }, [socket, roomId, joined, flags.deafened, flags.screenSharing]);
  useEffect(() => {
    throttle.current?.update(joined && flags.speaking);
  }, [joined, flags.speaking]);
}
