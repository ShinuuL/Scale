import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { extractAccessFromQuery, hasRoomAccess } from '../lib/roomAccess.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  cursor: z.string().uuid().optional(),
});

export async function messagesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string } }>('/api/rooms/:id/messages', async (request, reply) => {
    const { id: roomId } = request.params;
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    const { limit, cursor } = parsed.data;

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    if (!room.isPersistent) return reply.code(400).send({ error: 'Temporary rooms have no persisted history' });

    // Membership: salas protegidas exigem JWT do dono, inviteToken ou password
    // (mesma regra do join-room). Salas públicas continuam abertas.
    const creds = extractAccessFromQuery(request);
    if (!(await hasRoomAccess(room, creds))) {
      return reply.code(403).send({ error: 'Not a room member' });
    }

    let cursorCreatedAt: Date | undefined;
    if (cursor) {
      const cursorMsg = await prisma.chatMessage.findUnique({ where: { id: cursor } });
      if (!cursorMsg || cursorMsg.roomId !== roomId) return reply.code(404).send({ error: 'Cursor not found' });
      cursorCreatedAt = cursorMsg.createdAt;
    }

    const where = cursorCreatedAt ? { roomId, createdAt: { lt: cursorCreatedAt } } : { roomId };
    const rows = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { files: true },
    });
    const asc = rows.reverse();
    const nextCursor = rows.length === limit && asc.length ? asc[0].id : null;
    return reply.send({ messages: asc, nextCursor });
  });
}
