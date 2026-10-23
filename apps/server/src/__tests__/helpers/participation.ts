import { randomUUID } from 'node:crypto';
import { GUEST_COOKIE_NAME, signGuestId } from '../../lib/guestId.js';
import { signRoomTicket } from '../../lib/roomTicket.js';

/**
 * Helpers de teste para a regra de participacao efetiva (room ticket) e o
 * guestId emitido pelo servidor.
 */

/** Cookie `scale_guest=<assinado>` de um convidado. */
export function guestCookie(guestId: string): string {
  return `${GUEST_COOKIE_NAME}=${encodeURIComponent(signGuestId(guestId))}`;
}

/**
 * Headers de um CONVIDADO que entrou na sala: cookie do guestId + ticket
 * emitido para ele. `guestId` default = UUID novo.
 */
export function guestParticipantHeaders(roomId: string, guestId: string = randomUUID()): Record<string, string> {
  return {
    cookie: guestCookie(guestId),
    'x-room-ticket': signRoomTicket(roomId, `g:${guestId}`),
  };
}

/** Headers de um usuario LOGADO (cookie de sessao) que entrou na sala. */
export function userParticipantHeaders(roomId: string, userId: string, sessionToken: string): Record<string, string> {
  return {
    cookie: `token=${sessionToken}`,
    'x-room-ticket': signRoomTicket(roomId, `u:${userId}`),
  };
}
