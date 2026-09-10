import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../lib/prisma.js';

const createRoomSchema = z.object({
  name: z.string().min(3).max(50),
  isPersistent: z.boolean().default(false),
  isPrivate: z.boolean().default(false),
  maxParticipants: z.number().int().min(2).max(8).default(8),
  ttlMinutes: z.number().int().min(1).max(1440).optional(), // 1 min to 24 hours
});

export async function roomRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/rooms
  fastify.post('/api/rooms', async (request, reply) => {
    const parsed = createRoomSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const { name, isPersistent, isPrivate, maxParticipants, ttlMinutes } =
      parsed.data;

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
        ownerId: request.userId ?? null,
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

    return reply.send({
      room: {
        ...room,
        inviteToken: isOwner ? room.inviteToken : undefined,
      },
    });
  });

  // GET /api/rooms - list active rooms
  fastify.get('/api/rooms', async (request, reply) => {
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

    // Expose inviteToken only when the requester is the room owner
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
  });

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
