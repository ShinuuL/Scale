import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { isRoomCreateRateLimited } from '../lib/rateLimit.js';
import { getClientIp } from '../lib/clientIp.js';

const createRoomSchema = z.object({
  name: z.string().min(3).max(50),
  isPersistent: z.boolean().default(false),
  isPrivate: z.boolean().default(false),
  maxParticipants: z.number().int().min(2).max(8).default(8),
  ttlMinutes: z.number().int().min(1).max(1440).optional(), // 1 min to 24 hours
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
    const isOwner = request.userId && room.ownerId === request.userId;

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
      },
    });
  });

  // GET /api/rooms - list active rooms
  // Exige login: o app é publicado na internet (tunel) e a listagem enumera as
  // salas ativas da instância. Sem sessão → 401 antes de tocar o banco.
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
          isPrivate: true,
          maxParticipants: true,
          inviteToken: true,
          ownerId: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      // Expose inviteToken only when the requester is the room owner. ownerId é
      // usado só para essa checagem e NÃO vai para o payload — a listagem é
      // pública para qualquer usuário logado e não precisa do dono.
      const roomsPublic = rooms.map((room) => {
        const isOwner = request.userId && room.ownerId === request.userId;
        return {
          id: room.id,
          name: room.name,
          isPersistent: room.isPersistent,
          isPrivate: room.isPrivate,
          maxParticipants: room.maxParticipants,
          createdAt: room.createdAt,
          inviteToken: isOwner ? room.inviteToken : undefined,
        };
      });

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

  // DELETE /api/rooms/:id (owner only)
  fastify.delete<{ Params: { id: string } }>(
    '/api/rooms/:id',
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
        return reply.code(403).send({ error: 'Only the room owner can delete it' });
      }

      await prisma.room.update({
        where: { id },
        data: { status: 'ENDED' },
      });

      return reply.send({ success: true });
    },
  );
}
