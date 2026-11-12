import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { isRoomCreateRateLimited, isRoomDeleteRateLimited } from '../lib/rateLimit.js';
import { isAdminUser } from '../lib/adminRole.js';
import { purgeRoom } from '../lib/roomDeletion.js';
import { getClientIp } from '../lib/clientIp.js';
import { createRoomSchema as sharedCreateRoomSchema } from '@scale/shared';
import { getRoomPeersSnapshot } from '../socket/handler.js';

// Campos comuns (nome, persistencia, teto, TTL) vem de @scale/shared; o server
// acrescenta a senha da sala privada.
/** Convite enviado no header X-Room-Invite (GET /api/rooms/:id). */
const inviteHeaderSchema = z.string().uuid();

/** `:id` das rotas de sala que mudam estado: sempre um uuid. */
const roomIdParamSchema = z.object({ id: z.string().uuid() });

/**
 * Pode apagar a sala: o dono (ownerId) ou um admin (raiz por ADMIN_EMAILS ou
 * concedido via AdminGrant). Anonimo nunca. `isAdmin` vem de isAdminUser,
 * resolvido uma vez por request (a lista de salas nao consulta por item).
 */
function canDeleteRoom(
  room: { ownerId: string | null },
  userId: string | undefined,
  isAdmin: boolean,
): boolean {
  if (!userId) return false;
  return room.ownerId === userId || isAdmin;
}

const createRoomSchema = sharedCreateRoomSchema.extend({
  password: z.string().min(8).max(128).optional(),
});

export async function roomRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/rooms
  fastify.post('/api/rooms', async (request, reply) => {
    // Criar sala exige login (regra de negócio): sem sessão válida → 401 antes
    // de qualquer trabalho (rate limit/zod/prisma).
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ error: 'Authentication required' });
    }

    // Anti-flood: cada chamada cria uma sala persistida. A chave e o IP do
    // cliente resolvido por lib/clientIp.ts (nao o header cru), entao continua
    // valido atras do proxy /api do Next e do tunel.
    if (isRoomCreateRateLimited(getClientIp(request))) {
      return reply
        .code(429)
        .send({ error: 'Too many rooms created. Try again in a few seconds.' });
    }

    const parsed = createRoomSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { name, isPersistent, isPrivate, maxParticipants, ttlMinutes, password } =
      parsed.data;

    // Password validation: only for persistent rooms, minimum 8 chars
    let passwordHash: string | null = null;
    if (password !== undefined) {
      if (!isPersistent) {
        return reply.code(400).send({
          error: 'Password only allowed for persistent rooms',
        });
      }
      passwordHash = await bcrypt.hash(password, 10);
    }

    // Calculate expiresAt: only for non-persistent rooms
    let expiresAt: Date | null = null;
    if (!isPersistent && ttlMinutes) {
      expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    } else if (!isPersistent) {
      // Default TTL: 1 hour for temporary rooms without explicit TTL
      expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    }

    const room = await prisma.room.create({
      data: {
        name,
        isPersistent,
        isPrivate,
        maxParticipants,
        inviteToken: uuidv4(),
        expiresAt,
        ownerId: userId,
        passwordHash,
      },
      select: {
        id: true,
        name: true,
        isPersistent: true,
        isPrivate: true,
        maxParticipants: true,
        inviteToken: true,
        expiresAt: true,
        createdAt: true,
        status: true,
      },
    });

    return reply.code(201).send({ room });
  });

  // GET /api/rooms/:id
  fastify.get<{ Params: { id: string } }>('/api/rooms/:id', async (request, reply) => {
    const { id } = request.params;

    const room = await prisma.room.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        isPersistent: true,
        isPrivate: true,
        maxParticipants: true,
        inviteToken: true,
        expiresAt: true,
        createdAt: true,
        status: true,
        ownerId: true,
        passwordHash: true,
      },
    });

    if (!room) {
      return reply.code(404).send({ error: 'Room not found' });
    }

    // Check if expired
    if (room.expiresAt && new Date(room.expiresAt) < new Date()) {
      return reply.code(410).send({ error: 'Room has expired' });
    }

    // Don't expose inviteToken unless requester is the owner
    const isOwner = Boolean(request.userId && room.ownerId === request.userId);
    const canDelete = canDeleteRoom(room, request.userId, await isAdminUser({ userId: request.userId, email: request.userEmail }));

    // Sala PRIVADA sem credencial (nem dono, nem X-Room-Invite valido): so o
    // minimo para a tela de entrada decidir o fluxo (pedir senha/convite).
    // Nome, teto, expiracao e status ficam para quem tem acesso. A senha NAO e
    // aceita aqui: verifica-la custaria bcrypt sem balde (o join-room e as
    // rotas de chat tem o balde de falhas).
    if (room.isPrivate && !isOwner) {
      const invite = inviteHeaderSchema.safeParse(request.headers['x-room-invite']);
      const hasInvite = invite.success && invite.data === room.inviteToken;
      if (!hasInvite) {
        return reply.send({
          room: { id: room.id, isPrivate: true, hasPassword: room.passwordHash !== null },
        });
      }
    }

    // passwordHash nunca é exposto; expomos apenas o flag hasPassword para a UI
    // decidir se deve pedir a senha antes do join (fluxo password do critic).
    // `ownerId` também é restrito: só o dono vê quem é o dono (o resto do app é
    // anônimo/guest e não precisa do dado). O `select` continua trazendo ownerId
    // para a checagem isOwner — ele só não entra no payload público.
    return reply.send({
      room: {
        id: room.id,
        name: room.name,
        isPersistent: room.isPersistent,
        isPrivate: room.isPrivate,
        maxParticipants: room.maxParticipants,
        inviteToken: isOwner ? room.inviteToken : undefined,
        expiresAt: room.expiresAt,
        createdAt: room.createdAt,
        status: room.status,
        ownerId: isOwner ? room.ownerId : undefined,
        hasPassword: room.passwordHash !== null,
        canDelete,
      },
    });
  });

  // GET /api/rooms - list active rooms ("Salas na rede")
  // Exige login: o app é publicado na internet (tunel) e a listagem enumera as
  // salas ativas da instância. Sem sessão → 401 antes de tocar o banco.
  // So salas PUBLICAS e ATIVAS (nao expiradas), com dados minimos: id, nome,
  // participantes conectados agora, persistencia e se pede senha. Nada de
  // inviteToken, dono, teto ou historico — entrar continua exigindo o
  // join-room (e o historico, o room ticket que ele emite).
  fastify.get(
    '/api/rooms',
    { preHandler: [fastify.authenticate as never] },
    async (request, reply) => {
      const rooms = await prisma.room.findMany({
        where: {
          status: 'ACTIVE',
          isPrivate: false,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        select: {
          id: true,
          name: true,
          isPersistent: true,
          passwordHash: true,
          ownerId: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      const counts = getRoomPeersSnapshot();
      const requesterIsAdmin = await isAdminUser({ userId: request.userId, email: request.userEmail });
      const roomsPublic = rooms.map((room) => ({
        id: room.id,
        name: room.name,
        participantCount: counts.get(room.id) ?? 0,
        isPersistent: room.isPersistent,
        hasPassword: room.passwordHash !== null,
        // Permissao calculada para QUEM pede; o ownerId em si nao sai.
        canDelete: canDeleteRoom(room, request.userId, requesterIsAdmin),
      }));

      return reply.send({ rooms: roomsPublic });
    },
  );

  // POST /api/rooms/:id/rotate-invite (owner only)
  fastify.post<{ Params: { id: string } }>(
    '/api/rooms/:id/rotate-invite',
    { preHandler: [fastify.authenticate as never] },
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const { id } = request.params;

      const room = await prisma.room.findUnique({
        where: { id },
        select: { id: true, ownerId: true },
      });

      if (!room) {
        return reply.code(404).send({ error: 'Room not found' });
      }

      if (room.ownerId !== userId) {
        return reply.code(403).send({ error: 'Only the room owner can rotate the invite' });
      }

      const newToken = uuidv4();
      await prisma.room.update({
        where: { id: room.id },
        data: { inviteToken: newToken },
      });

      // Emit chat:system so connected peers know the invite was rotated
      const io = (fastify as unknown as { io?: import('socket.io').Server }).io;
      io?.to(room.id).emit('chat:system', {
        roomId: room.id,
        text: 'Convite rotacionado pelo dono',
        kind: 'system',
      });

      return reply.send({ inviteToken: newToken });
    },
  );

  // DELETE /api/rooms/:id — exclusao DEFINITIVA, pelo dono ou admin do sistema.
  fastify.delete<{ Params: { id: string } }>(
    '/api/rooms/:id',
    { preHandler: [fastify.authenticate as never] },
    async (request, reply) => {
      const userId = request.userId;
      if (!userId) {
        return reply.code(401).send({ error: 'Authentication required' });
      }

      const params = roomIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({ error: 'Invalid room id' });
      }
      const { id } = params.data;

      const limit = isRoomDeleteRateLimited(userId);
      if (limit.limited) {
        return reply
          .code(429)
          .header('Retry-After', String(limit.retryAfterSeconds))
          .send({ error: 'Too many rooms deleted. Try again later.' });
      }

      const room = await prisma.room.findUnique({
        where: { id },
        select: { id: true, ownerId: true },
      });

      if (!room) {
        return reply.code(404).send({ error: 'Room not found' });
      }

      const isOwner = room.ownerId === userId;
      const isAdmin = await isAdminUser({ userId, email: request.userEmail });
      if (!isOwner && !isAdmin) {
        return reply
          .code(403)
          .send({ error: 'Only the room owner or a system admin can delete it' });
      }

      // Avisa e tira todo mundo, apaga banco e disco (lib/roomDeletion.ts —
      // mesma rotina da varredura de salas temporarias vencidas).
      const io = (fastify as unknown as { io?: import('socket.io').Server }).io;
      await purgeRoom(io, id, request.log);

      request.log.info(
        { roomId: id, userId, deletedAs: isOwner ? 'owner' : 'admin' },
        'room deleted',
      );

      return reply.send({ success: true });
    },
  );
}
