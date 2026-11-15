'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatTypingText, type ChannelTypingEvent } from '@scale/shared';

/** Sem novo sinal por este tempo, o "digitando" de alguem some. */
export const TYPING_EXPIRE_MS = 6000;
/** Enquanto digita, reenvia "digitando" no maximo a cada este intervalo. */
export const TYPING_SEND_INTERVAL_MS = 3000;

export interface TypingEntry {
  channelId: string;
  userId: string;
  name: string;
  at: number;
}

/** Aplica um evento recebido: `typing` renova/insere; parada remove. */
export function applyTypingEvent(entries: TypingEntry[], event: ChannelTypingEvent, now: number): TypingEntry[] {
  const rest = entries.filter((entry) => !(entry.channelId === event.channelId && entry.userId === event.userId));
  return event.typing ? [...rest, { channelId: event.channelId, userId: event.userId, name: event.name, at: now }] : rest;
}

/** Nomes digitando agora no canal, sem o proprio usuario e sem os expirados. */
export function activeTypingNames(entries: TypingEntry[], channelId: string, meId: string, now: number): string[] {
  return entries
    .filter((entry) => entry.channelId === channelId && entry.userId !== meId && now - entry.at < TYPING_EXPIRE_MS)
    .map((entry) => entry.name);
}

/**
 * Envio com limite: texto nao vazio manda `true` no maximo a cada intervalo;
 * texto vazio ou `stop()` (enviou/saiu) manda `false` uma vez.
 */
export function createTypingSender(emit: (typing: boolean) => void, now: () => number = Date.now) {
  let lastSent: number | null = null;
  const stop = () => {
    if (lastSent === null) return;
    lastSent = null;
    emit(false);
  };
  return {
    input(text: string) {
      if (!text.trim()) {
        stop();
        return;
      }
      const at = now();
      if (lastSent === null || at - lastSent >= TYPING_SEND_INTERVAL_MS) {
        lastSent = at;
        emit(true);
      }
    },
    stop,
  };
}

/** Estado de "digitando" da comunidade; poda os expirados a cada segundo. */
export function useChannelTyping(meId: string) {
  const [entries, setEntries] = useState<TypingEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (entries.length === 0) return;
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);
      setEntries((current) => {
        const kept = current.filter((entry) => at - entry.at < TYPING_EXPIRE_MS);
        return kept.length === current.length ? current : kept;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [entries.length]);
  const onTyping = useCallback((event: ChannelTypingEvent) => {
    const at = Date.now();
    setNow(at);
    setEntries((current) => applyTypingEvent(current, event, at));
  }, []);
  /** Mensagem do autor chegou: ele parou de digitar naquele canal. */
  const clearUser = useCallback((channelId: string, userId: string) => {
    setEntries((current) => current.filter((entry) => !(entry.channelId === channelId && entry.userId === userId)));
  }, []);
  const reset = useCallback(() => setEntries([]), []);
  /** `rename` troca o nome do evento (ex.: apelido na comunidade) pelo userId. */
  const textFor = (channelId: string, rename?: (userId: string, name: string) => string): string | null =>
    formatTypingText(
      activeTypingNames(
        rename ? entries.map((entry) => ({ ...entry, name: rename(entry.userId, entry.name) })) : entries,
        channelId, meId, now,
      ),
    );
  return { onTyping, clearUser, reset, textFor };
}
