'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { chatMessageClientSchema, chatEditClientSchema } from '@/lib/validation';

// ─── Tipos públicos ────────────────────────────────────────────
export interface ChatFileInfo {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  content: string;
  authorId: string | null;
  guestName?: string;
  prevContent?: string | null;
  editedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  files?: ChatFileInfo[];
  /** Mensagens `chat:system` do servidor (entrou/saiu/convite rotacionado). */
  system?: boolean;
}

export interface ChatApi {
  messages: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
  unread: number;
  isLoadingHistory: boolean;
  sendMessage: (content: string, mentions: string[]) => void;
  editMessage: (messageId: string, content: string) => void;
  deleteMessage: (messageId: string) => void;
  loadMore: () => Promise<void>;
  uploadFiles: (files: File[], content?: string) => Promise<void>;
  markRead: () => void;
  setOpen: (open: boolean) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

const MENTION_SOUND_URL = '/sounds/mention.mp3';
const MENTION_SOUND_VOLUME = 0.6;

function playMentionSound(): void {
  try {
    const audio = new Audio(MENTION_SOUND_URL);
    audio.volume = MENTION_SOUND_VOLUME;
    audio.play().catch(() => {});
  } catch {
    // Audio indisponível (SSR / ambiente sem áudio) — menção ainda chega via UI
  }
}

/**
 * Ponte Socket.io ↔ REST do chat. Escuta chat:message/edit/delete/mention/system,
 * mantém paginação (GET /api/rooms/:id/messages, cursor 50) e upload
 * (POST /api/rooms/:id/files). `unread` só incrementa quando o painel está fechado.
 *
 * `accessToken` (inviteToken) e `password` de salas protegidas são anexados aos
 * REST calls para satisfazer o membership check server-side (hardening Task 15).
 */
export function useChat(
  roomId: string,
  socket: Socket | null,
  accessToken?: string,
  password?: string,
): ChatApi {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const isOpenRef = useRef(false);
  const accessTokenRef = useRef<string | undefined>(undefined);
  const passwordRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    passwordRef.current = password;
  }, [password]);

  const setOpen = useCallback((open: boolean) => {
    isOpenRef.current = open;
    if (open) setUnread(0);
  }, []);

  const markRead = useCallback(() => setUnread(0), []);

  useEffect(() => {
    if (!socket) return;

    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg]);
      if (!isOpenRef.current) setUnread((u) => u + 1);
    };

    const onEdit = (payload: { messageId: string; content: string; prevContent: string | null; editedAt: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? { ...m, content: payload.content, prevContent: payload.prevContent, editedAt: payload.editedAt }
            : m,
        ),
      );
    };

    const onDelete = (payload: { messageId: string; deletedAt: string }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId ? { ...m, content: '[mensagem apagada]', deletedAt: payload.deletedAt, files: [] } : m,
        ),
      );
    };

    const onMention = () => {
      playMentionSound();
    };

    const onSystem = (payload: { text: string }) => {
      const systemMessage: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        roomId,
        content: payload.text,
        authorId: null,
        createdAt: new Date().toISOString(),
        system: true,
      };
      setMessages((prev) => [...prev, systemMessage]);
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:edit', onEdit);
    socket.on('chat:delete', onDelete);
    socket.on('chat:mention', onMention);
    socket.on('chat:system', onSystem);

    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:edit', onEdit);
      socket.off('chat:delete', onDelete);
      socket.off('chat:mention', onMention);
      socket.off('chat:system', onSystem);
    };
  }, [socket, roomId]);

  const sendMessage = useCallback(
    (content: string, mentions: string[]) => {
      const parsed = chatMessageClientSchema.safeParse(content);
      if (!parsed.success) return; // ChatPanel exibe o erro inline; hook só não emite
      const payload = { roomId, content: content.trim(), mentions: mentions.slice(0, 8) };
      socket?.emit('chat:message', payload, (res: { error?: string } | undefined) => {
        if (res?.error) console.warn(res.error);
      });
    },
    [socket, roomId],
  );

  const editMessage = useCallback(
    (messageId: string, content: string) => {
      const parsed = chatEditClientSchema.safeParse(content);
      if (!parsed.success) return;
      socket?.emit('chat:edit', { roomId, messageId, content: content.trim() });
    },
    [socket, roomId],
  );

  const deleteMessage = useCallback(
    (messageId: string) => {
      socket?.emit('chat:delete', { roomId, messageId });
    },
    [socket, roomId],
  );

  const loadMore = useCallback(async () => {
    if (hasMore === false || isLoadingHistory) return;
    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (nextCursor) params.set('cursor', nextCursor);
      if (accessTokenRef.current) params.set('inviteToken', accessTokenRef.current);
      if (passwordRef.current) params.set('password', passwordRef.current);
      const res = await fetch(`/api/rooms/${roomId}/messages?${params.toString()}`, { credentials: 'include' });
      const data = (await res.json()) as { messages: ChatMessage[]; nextCursor: string | null };
      if (res.ok) {
        setMessages((prev) => [...data.messages, ...prev]);
        setNextCursor(data.nextCursor);
        setHasMore(data.nextCursor !== null);
      }
    } finally {
      setIsLoadingHistory(false);
    }
  }, [roomId, nextCursor, hasMore, isLoadingHistory]);

  const uploadFiles = useCallback(
    async (files: File[], content?: string) => {
      const form = new FormData();
      const trimmedContent = content?.trim();
      if (trimmedContent) form.append('content', trimmedContent.slice(0, 500));
      if (accessTokenRef.current) form.append('inviteToken', accessTokenRef.current);
      if (passwordRef.current) form.append('password', passwordRef.current);
      files.slice(0, 5).forEach((file) => form.append('files', file));
      const res = await fetch(`/api/rooms/${roomId}/files`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'Upload falhou');
      }
    },
    [roomId],
  );

  return {
    messages,
    hasMore,
    nextCursor,
    unread,
    isLoadingHistory,
    sendMessage,
    editMessage,
    deleteMessage,
    loadMore,
    uploadFiles,
    markRead,
    setOpen,
    setMessages,
  };
}