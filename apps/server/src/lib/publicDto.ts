/**
 * DTOs publicos do chat: a UNICA forma de uma mensagem/arquivo sair do servidor
 * (REST, broadcast Socket.io e historico do join-room).
 *
 * Nunca saem: `prevContent` (conteudo anterior a edicao), o conteudo e os
 * arquivos de mensagem apagada, `ChatFile.path` (caminho no disco),
 * `uploadedBy` e `authorId`. A autoria vira `isMine`, calculado POR
 * DESTINATARIO (quem le), e `isGuest`.
 */

/** Quem esta lendo a mensagem (para calcular `isMine`). */
export interface MessageViewer {
  userId: string | null;
  /** Nome de convidado do leitor (handshake do socket); ausente no REST. */
  guestName?: string;
}

/**
 * Regra de autoria (a mesma do chat:edit/chat:delete): mensagem de usuario
 * logado pertence ao `authorId`; mensagem de convidado, ao `guestName`.
 */
export function isMessageAuthor(
  msg: { authorId: string | null; guestName?: string | null },
  viewer: MessageViewer | undefined,
): boolean {
  if (!viewer) return false;
  if (msg.authorId) return msg.authorId === viewer.userId;
  return viewer.guestName !== undefined && msg.guestName === viewer.guestName;
}

export const DELETED_MESSAGE_CONTENT = '[mensagem apagada]';

export interface ChatFileRow {
  id: string;
  filename: string;
  mime: string;
  size: number;
  createdAt?: Date;
  deletedAt?: Date | null;
}

export interface ChatMessageSource {
  id: string;
  roomId: string;
  content: string;
  authorId: string | null;
  guestName?: string | null;
  createdAt: Date;
  editedAt?: Date | null;
  deletedAt?: Date | null;
  files?: ChatFileRow[];
}

export interface PublicChatFile {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface PublicChatMessage {
  id: string;
  roomId: string;
  content: string;
  /** Nome exibido do autor (convidado ou usuario logado). */
  guestName: string | null;
  /** Autor e quem esta lendo (calculado por destinatario). */
  isMine: boolean;
  /** Autor era convidado (sem conta). */
  isGuest: boolean;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  edited: boolean;
  files: PublicChatFile[];
}

export function toPublicFile(file: ChatFileRow): PublicChatFile {
  return { id: file.id, filename: file.filename, mime: file.mime, size: file.size };
}

export function toPublicMessage(msg: ChatMessageSource, viewer?: MessageViewer): PublicChatMessage {
  const deleted = msg.deletedAt != null;
  return {
    id: msg.id,
    roomId: msg.roomId,
    content: deleted ? DELETED_MESSAGE_CONTENT : msg.content,
    guestName: msg.guestName ?? null,
    isMine: isMessageAuthor(msg, viewer),
    isGuest: msg.authorId === null,
    createdAt: msg.createdAt,
    editedAt: deleted ? null : (msg.editedAt ?? null),
    deletedAt: msg.deletedAt ?? null,
    edited: !deleted && msg.editedAt != null,
    files: deleted ? [] : (msg.files ?? []).filter((f) => f.deletedAt == null).map(toPublicFile),
  };
}
