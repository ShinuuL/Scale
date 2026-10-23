import bcrypt from 'bcryptjs';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { getClientIp } from './clientIp.js';
import { isRoomAuthLocked, recordRoomAuthFailure } from './rateLimit.js';

/**
 * Corresponde exatamente à regra de acesso do `join-room` no Socket.io
 * (handler.ts): salas públicas são abertas; salas protegidas (passwordHash
 * presente ou `isPrivate`) exigem JWT do dono, inviteToken ou password.
 */
export interface RoomAccessTarget {
  id: string;
  ownerId: string | null;
  isPrivate: boolean;
  inviteToken: string;
  passwordHash: string | null;
}

export interface RoomAccessCreds {
  userId?: string;
  inviteToken?: string;
  password?: string;
}

/** Header com a senha da sala (UTF-8 percent-encoded, ver decodeHeader). */
export const ROOM_PASSWORD_HEADER = 'x-room-password';
/** Header com o inviteToken da sala. */
export const ROOM_INVITE_HEADER = 'x-room-invite';

const passwordHeaderSchema = z.string().min(1).max(128);
const inviteHeaderSchema = z.string().uuid();

/**
 * O cliente envia a senha com `encodeURIComponent` (headers HTTP sao Latin-1;
 * senha com acento quebraria o fetch). Valor mal-codificado e usado cru.
 */
function decodeHeader(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Credenciais de acesso dos GET (messages/files): SO por header
 * (`X-Room-Password`, `X-Room-Invite`) — nunca pela query string, que vaza em
 * log de proxy, historico e Referer.
 */
export function extractAccessFromHeaders(request: FastifyRequest): RoomAccessCreds {
  const rawPassword = headerValue(request, ROOM_PASSWORD_HEADER);
  const rawInvite = headerValue(request, ROOM_INVITE_HEADER);
  const password = rawPassword !== undefined ? passwordHeaderSchema.safeParse(decodeHeader(rawPassword)) : undefined;
  const invite = rawInvite !== undefined ? inviteHeaderSchema.safeParse(rawInvite.trim()) : undefined;
  return {
    userId: request.userId,
    password: password?.success ? password.data : undefined,
    inviteToken: invite?.success ? invite.data : undefined,
  };
}

export async function hasRoomAccess(
  room: RoomAccessTarget,
  creds: RoomAccessCreds,
): Promise<boolean> {
  // Sala pública: qualquer participante tem acesso (igual ao join-room).
  if (!room.passwordHash && !room.isPrivate) return true;
  // Dono autenticado por JWT.
  if (creds.userId && room.ownerId && creds.userId === room.ownerId) return true;
  // Convite temporário (UUID v4 gerado no create).
  if (creds.inviteToken && creds.inviteToken === room.inviteToken) return true;
  // Password correto (mesmo compare do join-room).
  if (creds.password && room.passwordHash) {
    return bcrypt.compare(creds.password, room.passwordHash);
  }
  return false;
}

/**
 * hasRoomAccess + balde de falhas por IP+roomId (10 / 15 min).
 * Responde 429 (com Retry-After) ou 403 e devolve `false` quando negado; o
 * chamador so retorna.
 */
export async function guardRoomAccess(
  request: FastifyRequest,
  reply: FastifyReply,
  room: RoomAccessTarget,
  creds: RoomAccessCreds,
): Promise<boolean> {
  const ip = getClientIp(request);
  const locked = isRoomAuthLocked(ip, room.id);
  if (locked.limited) {
    await reply
      .code(429)
      .header('Retry-After', String(locked.retryAfterSeconds))
      .send({ error: 'Too many failed room credential attempts. Try again later.' });
    return false;
  }
  if (await hasRoomAccess(room, creds)) return true;
  recordRoomAuthFailure(ip, room.id);
  await reply.code(403).send({ error: 'Not a room member' });
  return false;
}
