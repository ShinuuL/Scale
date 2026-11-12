/**
 * Ponte entre telas e o `RoomHost` (layout raiz) para entrar numa chamada SEM
 * navegar para `/room` — o canal de voz da comunidade, estilo Discord: a tela
 * continua no chat e a chamada roda oculta, com a `MiniCallBar`.
 */
import { useSyncExternalStore } from 'react';

export const START_CALL_EVENT = 'scale:start-call';

export interface StartCallDetail {
  roomId: string;
  communityId?: string | null;
}

export interface ActiveCall {
  roomId: string;
  joined: boolean;
}

/** Pede ao `RoomHost` para entrar na sala em segundo plano. */
export function startBackgroundCall(detail: StartCallDetail) {
  window.dispatchEvent(new CustomEvent<StartCallDetail>(START_CALL_EVENT, { detail }));
}

/** URL da tela da chamada (abrir em foco). */
export function callScreenPath(roomId: string, communityId?: string | null) {
  const query = new URLSearchParams({ id: roomId });
  if (communityId) query.set('c', communityId);
  return `/room?${query.toString()}`;
}

let activeCall: ActiveCall | null = null;
const listeners = new Set<() => void>();

/** Atualizado só pelo `RoomHost`. */
export function setActiveCall(next: ActiveCall | null) {
  if (activeCall?.roomId === next?.roomId && activeCall?.joined === next?.joined) return;
  activeCall = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Chamada ativa nesta aba (sala e se o join já concluiu). */
export function useActiveCall(): ActiveCall | null {
  return useSyncExternalStore(
    subscribe,
    () => activeCall,
    () => null,
  );
}
