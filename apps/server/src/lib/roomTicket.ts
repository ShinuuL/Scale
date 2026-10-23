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
 * - JWT HS256 com segredo DERIVADO do JWT_SECRET (HMAC com rotulo proprio) e
 *   `aud` proprio: um ticket nao vale como sessao e uma sessao nao vale como
 *   ticket.
 * - Escopo: `roomId` + `sub` = identidade de quem entrou (`u:<userId>` ou
 *   `g:<guestId>`), a MESMA do socket que fez o join.
 *   - `u:` so vale com a sessao (JWT) do mesmo usuario.
 *   - `g:` carrega a identidade do convidado: o REST usa ESTE guestId (autoria
 *     do upload, isMine do historico). Nao e amarrado ao cookie porque, no
 *     primeiro acesso, handshakes simultaneos podem emitir cookies diferentes;
 *     a identidade que vale e a do socket que entrou na sala.
 * - Validade 12 h. Sair/ser desconectado NAO revoga (stateless); sala ENDED ou
 *   expirada e negada na hora pela rota, independente do ticket.
 */
export const ROOM_TICKET_HEADER = 'x-room-ticket';
export const ROOM_TICKET_TTL_SECONDS = 12 * 60 * 60;
const AUDIENCE = 'scale:room-ticket';

const payloadSchema = z.object({
  roomId: z.string().min(1),
  sub: z.string().regex(/^[ug]:.+$/),
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

/**
 * Valida o ticket para ESTA sala e devolve a identidade de quem entrou, ou
 * null. `requestUserId` e o usuario da sessao do request: ticket `u:` so vale
 * para ele.
 */
export function verifyRoomTicket(
  ticket: string | undefined,
  roomId: string,
  requestUserId: string | null,
): TicketIdentity | null {
  if (!ticket) return null;
  try {
    const decoded = jwt.verify(ticket, ticketSecret(), { algorithms: ['HS256'], audience: AUDIENCE });
    const parsed = payloadSchema.safeParse(decoded);
    if (!parsed.success || parsed.data.roomId !== roomId) return null;
    const id = parsed.data.sub.slice(2);
    if (parsed.data.sub.startsWith('u:')) {
      return requestUserId === id ? { userId: id, guestId: null } : null;
    }
    return { userId: null, guestId: id };
  } catch {
    return null;
  }
}
