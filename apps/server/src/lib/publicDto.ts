/**
 * DTOs publicos do chat: a UNICA forma de uma mensagem/arquivo sair do servidor
 * (REST, broadcast Socket.io e historico do join-room).
 *
 * Nunca saem: `prevContent` (conteudo anterior a edicao), o conteudo e os
 * arquivos de mensagem apagada, `ChatFile.path` (caminho no disco) e
 * `uploadedBy`.
 */

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
  authorId: string | null;
  guestName: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  edited: boolean;
  files: PublicChatFile[];
}

export function toPublicFile(file: ChatFileRow): PublicChatFile {
  return { id: file.id, filename: file.filename, mime: file.mime, size: file.size };
}

export function toPublicMessage(msg: ChatMessageSource): PublicChatMessage {
  const deleted = msg.deletedAt != null;
  return {
    id: msg.id,
    roomId: msg.roomId,
    content: deleted ? DELETED_MESSAGE_CONTENT : msg.content,
    authorId: msg.authorId,
    guestName: msg.guestName ?? null,
    createdAt: msg.createdAt,
    editedAt: deleted ? null : (msg.editedAt ?? null),
    deletedAt: msg.deletedAt ?? null,
    edited: !deleted && msg.editedAt != null,
    files: deleted ? [] : (msg.files ?? []).filter((f) => f.deletedAt == null).map(toPublicFile),
  };
}
