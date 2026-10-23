'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { UseSocketReturn } from '@/hooks/useSocket';
import { setFlash } from '@/lib/flash';

export const ROOM_DELETED_NOTICE = 'Esta sala foi apagada pelo dono ou por um administrador';

/**
 * Sala apagada por OUTRA pessoa (`room:deleted`): encerra a midia, deixa o
 * aviso para a home e navega. Devolve o ref que a pagina liga enquanto a
 * PROPRIA exclusao esta em curso — o servidor avisa antes de responder o
 * DELETE, e quem apagou ve "Sala apagada" em vez do aviso de terceiros.
 */
export function useRoomDeleted(
  socket: Pick<UseSocketReturn, 'onRoomDeleted'>,
  roomId: string,
  cleanupMedia: () => void,
  navigate: (href: string) => void = (href) => {
    window.location.href = href;
  },
): MutableRefObject<boolean> {
  const deletingByMeRef = useRef(false);
  const cleanupRef = useRef(cleanupMedia);
  cleanupRef.current = cleanupMedia;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  useEffect(() => {
    return socket.onRoomDeleted((data) => {
      if (data.roomId !== roomId || deletingByMeRef.current) return;
      cleanupRef.current();
      setFlash(ROOM_DELETED_NOTICE, 'info');
      navigateRef.current('/');
    });
  }, [socket, roomId]);

  return deletingByMeRef;
}
