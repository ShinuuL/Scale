'use client';

import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { z } from 'zod';
import {
  communitySubscriptionAckSchema,
  communityVoiceStateSchema,
  communityPresenceSchema,
  communityVoiceSpeakingSchema,
  type CommunityPresence,
  type CommunityVoiceSpeaking,
  channelMessageEditEventSchema,
  channelMessageDeleteEventSchema,
  type CommunityVoiceState,
  type ChannelMessageEditEvent,
  type ChannelMessageDeleteEvent,
} from '@scale/shared';
import { channelMessageSchema, type ChannelMessage } from '@/lib/api';
import { getWsUrl } from '@/hooks/useSocket';

export interface CommunityEventHandlers {
  onMessage?: (message: ChannelMessage) => void;
  onMessageEdit?: (event: ChannelMessageEditEvent) => void;
  onMessageDelete?: (event: ChannelMessageDeleteEvent) => void;
  onChanged?: () => void;
  onDeleted?: () => void;
  onRemoved?: () => void;
  onVoiceStates?: (states: CommunityVoiceState[]) => void;
  onVoiceState?: (state: CommunityVoiceState) => void;
  /** Estado inicial de presenca (a cada inscricao): quem da comunidade esta online. */
  onOnlineUsers?: (userIds: string[]) => void;
  onPresence?: (event: CommunityPresence) => void;
  onVoiceSpeaking?: (event: CommunityVoiceSpeaking) => void;
  onError?: (error: string) => void;
}

/** Acompanha uma comunidade; cada reconexão renova a inscrição e o estado de voz. */
export function useCommunityEvents(
  communityId: string | null,
  handlers: CommunityEventHandlers,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  useEffect(() => {
    if (!communityId) return;
    let active = true;
    const socket = io(getWsUrl(), {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      timeout: 20000,
    });
    const matches = (raw: unknown): boolean =>
      z.object({ communityId: z.string() }).safeParse(raw).data?.communityId === communityId;
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('community:subscribe', { communityId }, (raw: unknown) => {
        if (!active || !socket.connected) return;
        const result = communitySubscriptionAckSchema.safeParse(raw);
        if (!result.success) {
          handlersRef.current.onError?.('Resposta inválida da comunidade');
          return;
        }
        if ('error' in result.data) {
          handlersRef.current.onError?.(result.data.error);
          return;
        }
        handlersRef.current.onVoiceStates?.(result.data.voiceStates);
        handlersRef.current.onOnlineUsers?.(result.data.onlineUserIds);
        handlersRef.current.onChanged?.();
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('community:changed', (raw: unknown) => {
      if (matches(raw)) handlersRef.current.onChanged?.();
    });
    socket.on('community:deleted', (raw: unknown) => {
      if (matches(raw)) handlersRef.current.onDeleted?.();
    });
    socket.on('community:removed', (raw: unknown) => {
      if (matches(raw)) handlersRef.current.onRemoved?.();
    });
    socket.on('community:voice-state', (raw: unknown) => {
      const parsed = communityVoiceStateSchema.safeParse(raw);
      if (parsed.success) handlersRef.current.onVoiceState?.(parsed.data);
    });
    socket.on('community:presence', (raw: unknown) => {
      const parsed = communityPresenceSchema.safeParse(raw);
      if (parsed.success && parsed.data.communityId === communityId) handlersRef.current.onPresence?.(parsed.data);
    });
    socket.on('community:voice-speaking', (raw: unknown) => {
      const parsed = communityVoiceSpeakingSchema.safeParse(raw);
      if (parsed.success) handlersRef.current.onVoiceSpeaking?.(parsed.data);
    });
    socket.on('channel:message', (raw: unknown) => {
      const parsed = channelMessageSchema.safeParse(raw);
      if (parsed.success) handlersRef.current.onMessage?.(parsed.data);
    });
    socket.on('channel:message-edit', (raw: unknown) => {
      const parsed = channelMessageEditEventSchema.safeParse(raw);
      if (parsed.success) handlersRef.current.onMessageEdit?.(parsed.data);
    });
    socket.on('channel:message-delete', (raw: unknown) => {
      const parsed = channelMessageDeleteEventSchema.safeParse(raw);
      if (parsed.success) handlersRef.current.onMessageDelete?.(parsed.data);
    });
    return () => {
      active = false;
      if (socket.connected) socket.emit('community:unsubscribe', { communityId });
      socket.disconnect();
      setConnected(false);
    };
  }, [communityId]);
  return { connected };
}
