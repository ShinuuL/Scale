'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { CHAT_MESSAGE_MAX } from '@scale/shared';
import { chatMessageClientSchema, chatEditClientSchema } from '@/lib/validation';
import { roomAccessHeaders } from '@/lib/roomAccess';

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
  /** Nome exibido do autor. O id do autor nunca sai do servidor. */
  guestName?: string | null;
  /** Calculado pelo servidor para quem le: a mensagem e minha. */
  isMine?: boolean;
  /** Autor era convidado (sem conta). */
  isGuest?: boolean;
  /** true quando a mensagem foi editada (o conteudo anterior nunca trafega). */
  edited?: boolean;
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
  uploadFiles: (files: File[], content?: string, guestName?: string) => Promise<void>;
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
/** Mensagem legível para a falha de upload (o backend responde em inglês). */
export function uploadErrorMessage(status: number, serverError?: string): string {
  if (serverError === 'Temporary rooms do not support files') {
    return 'Sala temporária não aceita arquivos — use uma sala persistente.';
  }
  if (serverError === 'Magic bytes mismatch') {
    return 'O conteúdo do arquivo não corresponde ao tipo declarado.';
  }
  switch (status) {
    case 401:
    case 403:
      return 'Sem permissão para enviar arquivos nesta sala.';
    case 413:
      return serverError === 'Quota exceeded'
        ? 'Cota de 200 MB da sala atingida.'
        : 'Arquivo grande demais (máx. 15 MB).';
    case 429:
      return 'Muitos envios seguidos. Aguarde e tente de novo.';
    default:
      return serverError ? `Falha no envio: ${serverError}` : `Falha no envio (HTTP ${status}).`;
  }
}

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

    const onEdit = (payload: { messageId: string; content: string; editedAt: string; edited?: boolean }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === payload.messageId
            ? { ...m, content: payload.content, editedAt: payload.editedAt, edited: true }
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
      // Credencial da sala vai por header (X-Room-Invite / X-Room-Password),
      // nunca na URL.
      const res = await fetch(`/api/rooms/${roomId}/messages?${params.toString()}`, {
        credentials: 'include',
        headers: roomAccessHeaders(accessTokenRef.current, passwordRef.current),
      });
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
    async (files: File[], content?: string, guestName?: string) => {
      const form = new FormData();
      const trimmedContent = content?.trim();
      if (trimmedContent) form.append('content', trimmedContent.slice(0, CHAT_MESSAGE_MAX));
      // O backend e quem monta a mensagem: sem o nome aqui o autor do arquivo
      // aparece como "Anon" (ChatMessageItem.tsx). Vai ANTES dos arquivos para
      // que a checagem de membership do servidor ja veja os campos.
      if (guestName) form.append('guestName', guestName);
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
        throw new Error(uploadErrorMessage(res.status, body.error));
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