'use client';

import { useEffect, useRef, useState } from 'react';
import { roomTicketHeaders } from '@/lib/roomAccess';

/**
 * Fotos de perfil dos participantes da chamada, por peerId.
 *
 * A rota exige o room ticket no header (nunca na URL), entao `<img src>` nao
 * serve: busca com fetch e expoe uma URL `blob:` (a CSP libera `img-src blob:`).
 * Cada peer e buscado uma vez enquanto estiver na sala; 404 (convidado ou sem
 * foto) fica registrado para nao repetir. URLs de quem saiu sao revogadas.
 *
 * @param peerIds peers LOGADOS presentes (convidado nunca tem foto).
 */
export function usePeerAvatars(
  roomId: string,
  peerIds: string[],
  ticket: string | null,
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  // peerId -> URL blob (string) ou null (sem foto / falhou). Presente = ja tratado.
  const resolved = useRef(new Map<string, string | null>());
  const key = [...peerIds].sort().join(',');

  useEffect(() => {
    if (!ticket || !roomId) return;
    const wanted = new Set(key ? key.split(',') : []);
    const controller = new AbortController();

    // Quem saiu: revoga e esquece (se voltar, busca de novo).
    let changed = false;
    for (const [peerId, url] of resolved.current) {
      if (!wanted.has(peerId)) {
        if (url) URL.revokeObjectURL(url);
        resolved.current.delete(peerId);
        changed = true;
      }
    }
    if (changed) setUrls(toUrlMap(resolved.current));

    for (const peerId of wanted) {
      if (resolved.current.has(peerId)) continue;
      resolved.current.set(peerId, null); // reserva: evita busca duplicada
      fetch(`/api/rooms/${encodeURIComponent(roomId)}/peers/${encodeURIComponent(peerId)}/avatar`, {
        credentials: 'include',
        headers: roomTicketHeaders(ticket),
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) return;
          const blob = await res.blob();
          if (!resolved.current.has(peerId)) return; // saiu enquanto baixava
          resolved.current.set(peerId, URL.createObjectURL(blob));
          setUrls(toUrlMap(resolved.current));
        })
        .catch(() => {
          // Abortado (peer saiu / desmontou) ou rede: libera para tentar de novo.
          if (resolved.current.get(peerId) === null) resolved.current.delete(peerId);
        });
    }
    return () => controller.abort();
  }, [roomId, key, ticket]);

  // Desmontou: revoga tudo.
  useEffect(() => {
    const map = resolved.current;
    return () => {
      for (const url of map.values()) if (url) URL.revokeObjectURL(url);
      map.clear();
    };
  }, []);

  return urls;
}

function toUrlMap(source: Map<string, string | null>): Map<string, string> {
  const out = new Map<string, string>();
  for (const [peerId, url] of source) if (url) out.set(peerId, url);
  return out;
}
