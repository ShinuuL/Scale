import { useCallback, useEffect, useState } from 'react';

/** Segundos restantes ate `until` (ms epoch), arredondado para cima; nunca negativo. */
export function secondsLeft(until: number, now: number): number {
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

/**
 * Contagem regressiva do modo lento no compositor. `start(segundos)` arma o
 * relogio (apos enviar, ou com o `retryAfterSeconds` de um 429); zera ao trocar
 * de canal porque o componente do chat e remontado por canal.
 */
export function useCooldown(): { remaining: number; start: (seconds: number) => void } {
  const [until, setUntil] = useState(0);
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const tick = () => setRemaining(secondsLeft(until, Date.now()));
    tick();
    if (until <= Date.now()) return;
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [until]);
  const start = useCallback((seconds: number) => {
    if (seconds > 0) setUntil(Date.now() + seconds * 1000);
  }, []);
  return { remaining, start };
}
