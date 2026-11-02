import { z } from 'zod';

/**
 * Amizades e mensagens privadas (DM) entre usuarios logados. Convidado fica de
 * fora: amizade exige conta e @nome de usuario unico.
 */

/** Limites do @nome de usuario (sempre minusculo; unico no banco). */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_RE = /^[a-z0-9_]+$/;

/** Tamanho maximo (caracteres, apos trim) de uma mensagem privada. */
export const DM_MESSAGE_MAX = 2000;

/** Mensagens por pagina no historico da conversa. */
export const DM_PAGE_SIZE = 50;

/**
 * @nome de usuario: aceita "@Fulano" e normaliza para "fulano" (trim, sem o
 * "@" inicial, minusculo) ANTES dos limites.
 */
export const usernameSchema = z
  .string()
  .transform((v) => v.trim().replace(/^@/, '').toLowerCase())
  .pipe(
    z
      .string()
      .min(USERNAME_MIN, `Use ao menos ${USERNAME_MIN} caracteres`)
      .max(USERNAME_MAX, `Use no máximo ${USERNAME_MAX} caracteres`)
      .regex(USERNAME_RE, 'Use só letras sem acento, números e _'),
  );

export const setUsernameSchema = z.object({ username: usernameSchema });
export const friendRequestSchema = z.object({ username: usernameSchema });

/** Conteudo de DM: trim antes dos limites. */
export const dmSendSchema = z.object({
  content: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1).max(DM_MESSAGE_MAX)),
});

/** Usuario como aparece para outro usuario (nunca e-mail). */
export const publicUserSchema = z.object({
  id: z.string(),
  username: z.string().nullable(),
  name: z.string(),
  /** ISO da ultima troca de foto; null = sem foto. */
  avatarUpdatedAt: z.string().nullable(),
});

export const friendRequestDtoSchema = z.object({
  id: z.string(),
  user: publicUserSchema,
  createdAt: z.string(),
});

export const friendsListSchema = z.object({
  friends: z.array(publicUserSchema),
  incoming: z.array(friendRequestDtoSchema),
  outgoing: z.array(friendRequestDtoSchema),
});

export const directMessageSchema = z.object({
  id: z.string(),
  senderId: z.string(),
  recipientId: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

export type PublicUser = z.infer<typeof publicUserSchema>;
export type FriendRequestDto = z.infer<typeof friendRequestDtoSchema>;
export type FriendsList = z.infer<typeof friendsListSchema>;
export type DirectMessage = z.infer<typeof directMessageSchema>;
