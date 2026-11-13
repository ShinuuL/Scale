import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { CHANNEL_EVERYONE, channelSettingsSchema } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { communityRoom, findMembership, permissionsOf } from '../lib/communityAccess.js';

/**
 * Fase 3: configuracao do canal (quem tem manageChannels).
 *
 *  - PUT /api/channels/:id/settings { announcement, slowModeSeconds, overrides }
 *    substitui as sobrescritas inteiras; sobrescrita toda null e descartada.
 *    Aviso e modo lento so em canal de TEXTO. Responde `community:changed`.
 */
const params = z.object({ id: z.string().uuid() });
const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;

export async function channelSettingsRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };
  app.put('/api/channels/:id/settings', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = channelSettingsSchema.safeParse(request.body);
    if (!p.success || !body.success) return reply.code(400).send({ error: 'Invalid input' });
    const room = await prisma.room.findUnique({ where: { id: p.data.id } });
    if (!room?.communityId) return reply.code(404).send({ error: 'Not found' });
    const member = await findMembership(room.communityId, request.userId!);
    if (!member) return reply.code(404).send({ error: 'Not found' });
    if (!permissionsOf(member).manageChannels) return reply.code(403).send({ error: 'Forbidden' });
    const { announcement, slowModeSeconds, overrides } = body.data;
    if (room.channelKind !== 'TEXT' && (announcement || slowModeSeconds > 0)) return reply.code(400).send({ error: 'Invalid input' });
    const roleIds = overrides.map((o) => o.target).filter((t) => t !== CHANNEL_EVERYONE);
    if (roleIds.length) {
      const found = await prisma.communityCustomRole.count({ where: { id: { in: roleIds }, communityId: room.communityId } });
      if (found !== roleIds.length) return reply.code(400).send({ error: 'Invalid input' });
    }
    const kept = overrides.filter((o) => o.viewChannel !== null || o.sendMessages !== null);
    await prisma.$transaction([
      prisma.room.update({ where: { id: room.id }, data: { announcement, slowModeSeconds } }),
      prisma.channelPermissionOverride.deleteMany({ where: { roomId: room.id } }),
      ...kept.map((o) => prisma.channelPermissionOverride.create({ data: { roomId: room.id, ...o } })),
    ]);
    ioOf(app)?.to(communityRoom(room.communityId)).emit('community:changed', { communityId: room.communityId });
    return reply.send({ ok: true });
  });
}
