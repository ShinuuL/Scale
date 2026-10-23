/**
 * Limites de produto compartilhados entre apps/web (UX) e apps/server (regra).
 * O servidor SEMPRE revalida: estes valores no cliente servem so para feedback.
 */

/** Tamanho maximo (caracteres, apos trim) de uma mensagem de chat. */
export const CHAT_MESSAGE_MAX = 500;

/** Tamanho maximo de um arquivo anexado ao chat (bytes; 15 MB decimais). */
export const MAX_FILE_SIZE_BYTES = 15_000_000;

/** Quantidade maxima de arquivos por mensagem. */
export const MAX_FILES_PER_MESSAGE = 5;

/**
 * Allowlist de MIME aceitos no upload do chat. O servidor ainda confere os
 * magic bytes do conteudo; o MIME declarado sozinho nao basta.
 */
export const ALLOWED_MIME_RE = /^(image\/.*|application\/pdf|text\/plain|audio\/.*|application\/zip)$/;

/** Limites do nome da sala. */
export const ROOM_NAME_MIN = 3;
export const ROOM_NAME_MAX = 50;

/** Teto da malha P2P (mesh): acima disso a banda de upload nao comporta. */
export const MAX_PARTICIPANTS = 8;
