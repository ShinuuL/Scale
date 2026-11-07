import { z } from 'zod';
import { publicUserSchema } from './social.js';

/**
 * Ligacao entre amigos: quem liga cria (ou usa) uma sala privada e o amigo
 * recebe a chamada tocando na tela. Nada fica no banco: a chamada pendente vive
 * na memoria do servidor ate ser atendida, recusada, cancelada ou perder o
 * tempo de toque.
 *
 * Eventos na sala `user:<id>` (Socket.io):
 *   - `call:incoming` — {@link CallInvite} para quem recebe;
 *   - `call:outgoing` — {@link CallInvite} para as abas de quem ligou;
 *   - `call:ended`    — {@link CallEnded} para os dois lados.
 */

/** Quanto tempo a chamada toca antes de virar "perdida". */
export const CALL_RING_TIMEOUT_MS = 45_000;

export const startCallSchema = z.object({
  friendId: z.string().min(1).max(64),
  /**
   * Chamar para uma sala em que quem liga ja esta (adicionar na chamada).
   * Ausente = cria uma sala privada nova para os dois.
   */
  roomId: z.string().uuid().optional(),
});

export const callInviteSchema = z.object({
  callId: z.string(),
  roomId: z.string(),
  /** Convite da sala privada: so vai para quem recebe a chamada. */
  inviteToken: z.string().optional(),
  /** Do ponto de vista de quem recebe o evento: a outra pessoa. */
  peer: publicUserSchema,
  /** Nome da sala quando o convite e para uma chamada ja em andamento. */
  roomName: z.string().optional(),
  /** ISO do fim do toque. */
  expiresAt: z.string(),
});

export const callEndReasonSchema = z.enum(['accepted', 'declined', 'cancelled', 'missed']);

export const callEndedSchema = z.object({
  callId: z.string(),
  reason: callEndReasonSchema,
});

export const activeCallsSchema = z.object({
  incoming: z.array(callInviteSchema),
  outgoing: z.array(callInviteSchema),
});

export const startCallResponseSchema = z.object({
  callId: z.string(),
  roomId: z.string(),
  expiresAt: z.string(),
});

export const acceptCallResponseSchema = z.object({
  roomId: z.string(),
  inviteToken: z.string(),
});

export type StartCallInput = z.infer<typeof startCallSchema>;
export type CallInvite = z.infer<typeof callInviteSchema>;
export type CallEndReason = z.infer<typeof callEndReasonSchema>;
export type CallEnded = z.infer<typeof callEndedSchema>;
export type ActiveCalls = z.infer<typeof activeCallsSchema>;
