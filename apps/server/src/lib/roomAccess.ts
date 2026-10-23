import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ROOM_TICKET_HEADER, verifyRoomTicket } from './roomTicket.js';

/**
 * Acesso ao historico, download e upload de arquivos de uma sala: exige
 * PARTICIPACAO EFETIVA — inclusive em sala publica sem senha.
 *
 * Senha e convite continuam valendo so para o `join-room` (Socket.io). O join
 * bem-sucedido emite um room ticket (lib/roomTicket.ts) que o cliente manda no
 * header `X-Room-Ticket`. O dono da sala (JWT) dispensa o ticket. Sala ENDED ou
 * expirada e negada para todos.
 */
export interface RoomAccessTarget {
  id: string;
  ownerId: string | null;
  status: string;
  expiresAt: Date | null;
}

const ticketHeaderSchema = z.string().min(16).max(2048);

/** Ticket do header (nunca da query string). */
export function extractRoomTicket(request: FastifyRequest): string | undefined {
  const raw = request.headers[ROOM_TICKET_HEADER];
  const parsed = ticketHeaderSchema.safeParse(typeof raw === 'string' ? raw.trim() : undefined);
  return parsed.success ? parsed.data : undefined;
}

export function isRoomOpen(room: RoomAccessTarget, now = Date.now()): boolean {
  if (room.status !== 'ACTIVE') return false;
  return !(room.expiresAt && room.expiresAt.getTime() < now);
}

export function hasRoomParticipation(request: FastifyRequest, room: RoomAccessTarget): boolean {
  if (!isRoomOpen(room)) return false;
  if (request.userId && room.ownerId && request.userId === room.ownerId) return true;
  return verifyRoomTicket(extractRoomTicket(request), room.id, {
    userId: request.userId ?? null,
    guestId: request.guestId ?? null,
  });
}

/**
 * Responde 403 (e devolve false) quando quem chama nao participa da sala.
 * O chamador so retorna.
 */
export async function guardRoomParticipation(
  request: FastifyRequest,
  reply: FastifyReply,
  room: RoomAccessTarget,
): Promise<boolean> {
  if (hasRoomParticipation(request, room)) return true;
  await reply.code(403).send({ error: 'Not a room member' });
  return false;
}
