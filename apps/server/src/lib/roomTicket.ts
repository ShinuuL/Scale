import { createHmac } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getEnv } from './env.js';

/**
 * Room ticket: prova de participacao efetiva numa sala.
 *
 * Emitido no ack (e no evento `room:ticket`) do `join-room` bem-sucedido —
 * portanto so depois de senha/convite validados. Exigido pelos GETs de historico
 * e arquivo e pelo upload (header `X-Room-Ticket`, nunca query string). O dono
 * da sala dispensa o ticket.
 *
 * - JWT HS256 com segredo DERIVADO do JWT_SECRET (HMAC com rotulo proprio):
 *   um ticket nao vale como sessao e uma sessao nao vale como ticket.
 * - Escopo: `roomId` + `sub` (identidade de quem entrou: `u:<userId>` ou
 *   `g:<guestId>`). O REST confere que o `sub` e o mesmo de quem chama (cookie
 *   de sessao ou de convidado): ticket vazado sem o cookie nao serve.
 * - Validade 12 h. Sair/ser desconectado NAO revoga (stateless); sala ENDED ou
 *   expirada e negada na hora pela rota, independente do ticket.
 */
export const ROOM_TICKET_HEADER = 'x-room-ticket';
export const ROOM_TICKET_TTL_SECONDS = 12 * 60 * 60;
const AUDIENCE = 'scale:room-ticket';

const payloadSchema = z.object({
  roomId: z.string().min(1),
  sub: z.string().min(3),
});

function ticketSecret(): string {
  return createHmac('sha256', getEnv().JWT_SECRET).update('scale:room-ticket:v1').digest('hex');
}

export interface TicketIdentity {
  userId: string | null;
  guestId: string | null;
}

/** `u:<userId>` (logado) ou `g:<guestId>` (convidado); null sem identidade. */
export function ticketSubject(identity: TicketIdentity): string | null {
  if (identity.userId) return `u:${identity.userId}`;
  if (identity.guestId) return `g:${identity.guestId}`;
  return null;
}

export function signRoomTicket(roomId: string, subject: string, ttlSeconds = ROOM_TICKET_TTL_SECONDS): string {
  return jwt.sign({ roomId }, ticketSecret(), {
    algorithm: 'HS256',
    audience: AUDIENCE,
    subject,
    expiresIn: ttlSeconds,
  });
}

/** Ticket valido para ESTA sala e ESTA identidade. */
export function verifyRoomTicket(ticket: string | undefined, roomId: string, identity: TicketIdentity): boolean {
  if (!ticket) return false;
  const subject = ticketSubject(identity);
  if (!subject) return false;
  try {
    const decoded = jwt.verify(ticket, ticketSecret(), { algorithms: ['HS256'], audience: AUDIENCE });
    const parsed = payloadSchema.safeParse(decoded);
    return parsed.success && parsed.data.roomId === roomId && parsed.data.sub === subject;
  } catch {
    return false;
  }
}
