'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { directMessageSchema, type DirectMessage } from '@scale/shared';
import { getWsUrl } from '@/hooks/useSocket';

export interface UserEventHandlers {
  /** A lista de amigos/pedidos mudou: refazer GET /api/friends. */
  onFriendsChanged?: () => void;
  /** Mensagem privada nova (enviada ou recebida por esta conta). */
  onDirectMessage?: (message: DirectMessage) => void;
}

/**
 * Socket da conta logada (sala `user:<id>` no servidor), sem entrar em sala de
 * chamada. `enabled` = false nao conecta (convidado ou sessao ainda incerta).
 * Os handlers podem mudar a cada render sem reconectar.
 */
export function useUserEvents(enabled: boolean, handlers: UserEventHandlers): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;
    const sock = io(getWsUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      timeout: 20000,
    });
    sock.on('connect', () => {
      setConnected(true);
      // Reconexao pode ter perdido eventos: a lista e recarregada.
      handlersRef.current.onFriendsChanged?.();
    });
    sock.on('disconnect', () => setConnected(false));
    sock.on('friends:changed', () => handlersRef.current.onFriendsChanged?.());
    sock.on('dm:message', (raw: unknown) => {
      const parsed = directMessageSchema.safeParse(raw);
      if (parsed.success) handlersRef.current.onDirectMessage?.(parsed.data);
    });
    return () => {
      sock.disconnect();
      setConnected(false);
    };
  }, [enabled]);

  return { connected };
}
