import bcrypt from 'bcryptjs';
import type { FastifyRequest } from 'fastify';

/**
 * Corresponde exatamente à regra de acesso do `join-room` no Socket.io
 * (handler.ts): salas públicas são abertas; salas protegidas (passwordHash
 * presente ou `isPrivate`) exigem JWT do dono, inviteToken ou password.
 */
export interface RoomAccessTarget {
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

/** Extrai credenciais de acesso de query string (messages GET / files GET). */
export function extractAccessFromQuery(request: FastifyRequest): RoomAccessCreds {
  const query = request.query as Record<string, unknown>;
  const userId = (request as unknown as { userId?: string }).userId;
  const inviteToken = typeof query.inviteToken === 'string' ? query.inviteToken : undefined;
  const password = typeof query.password === 'string' ? query.password : undefined;
  return { userId, inviteToken, password };
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