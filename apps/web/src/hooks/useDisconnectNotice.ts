'use client';

import { useEffect, useRef } from 'react';

/**
 * Chama `notify` só quando o socket CAI depois de ter conectado. Antes, o
 * aviso disparava com `connected === false` assim que a página terminava de
 * carregar — e na entrada da sala os dados chegam antes da 1a conexão do
 * socket, então todo mundo via "Desconectado" sem ter havido queda nenhuma.
 */
export function useDisconnectNotice(connected: boolean, notify: () => void): void {
  const wasConnectedRef = useRef(false);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    if (connected) {
      wasConnectedRef.current = true;
      return;
    }
    if (wasConnectedRef.current) {
      wasConnectedRef.current = false;
      notifyRef.current();
    }
  }, [connected]);
}
