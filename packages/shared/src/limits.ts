/**
 * Limites de produto compartilhados entre apps/web (UX) e apps/server (regra).
 * O servidor SEMPRE revalida: estes valores no cliente servem so para feedback.
 */

/** Tamanho maximo (caracteres, apos trim) de uma mensagem de chat. */
export const CHAT_MESSAGE_MAX = 500;

/** Tamanho maximo de um arquivo anexado ao chat (bytes; 250 MB decimais). */
export const MAX_FILE_SIZE_BYTES = 250_000_000;

/**
 * Cota de arquivos por sala persistente (bytes; 2 GB decimais). Conta os
 * arquivos vivos e os apagados ha menos de 7 dias (ainda no disco ate o GC).
 */
export const ROOM_FILE_QUOTA_BYTES = 2_000_000_000;

/** Quantidade maxima de arquivos por mensagem. */
export const MAX_FILES_PER_MESSAGE = 5;

/**
 * Allowlist de MIME aceitos no upload do chat. O servidor ainda confere os
 * magic bytes do conteudo; o MIME declarado sozinho nao basta.
 * `image/svg+xml` fica FORA: SVG e documento ativo (script/links) e nao tem
 * magic bytes para conferir.
 */
export const ALLOWED_MIME_RE =
  /^(image\/(?!svg\+xml$)[a-z0-9.+-]+|application\/pdf|text\/plain|audio\/[a-z0-9.+-]+|application\/zip)$/;

/** Valor do `accept` do input de arquivo do chat (espelha ALLOWED_MIME_RE). */
export const CHAT_FILE_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,audio/*,application/zip';

/** Tamanho maximo da foto de perfil (bytes; 32 MB decimais). */
export const MAX_AVATAR_SIZE_BYTES = 32_000_000;
/** Icone de comunidade: PNG/JPEG/WebP ate 8 MB. */
export const MAX_COMMUNITY_ICON_BYTES = 8_000_000;

/** Formatos aceitos na foto de perfil (conferidos por magic bytes no servidor). */
export const AVATAR_MIMES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Valor do `accept` do input da foto de perfil. */
export const AVATAR_FILE_ACCEPT = AVATAR_MIMES.join(',');

/** Limites do nome de exibicao do usuario. */
export const USER_NAME_MIN = 1;
export const USER_NAME_MAX = 100;

/** Limites do nome da sala. */
export const ROOM_NAME_MIN = 3;
export const ROOM_NAME_MAX = 50;

/** Teto da malha P2P (mesh): acima disso a banda de upload nao comporta. */
export const MAX_PARTICIPANTS = 8;

/** Prazo para editar uma mensagem de chat, contado desde a criação. */
export const CHAT_EDIT_WINDOW_MS = 15 * 60 * 1000;

/** Limites de comunidades e canais. */
export const COMMUNITY_NAME_MAX = 50;
export const CHANNEL_NAME_MAX = 40;
export const MAX_COMMUNITIES_OWNED = 10;
export const MAX_CHANNELS_PER_COMMUNITY = 50;
export const MAX_COMMUNITY_MEMBERS = 500;
export const MAX_COMMUNITIES_JOINED = 100;
