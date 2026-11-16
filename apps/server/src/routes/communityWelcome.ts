import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { channelUserLimitSchema, communityWelcomeSchema } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { canModerate, communityRoom, findMembership, permissionsOf } from '../lib/communityAccess.js';
import { audit } from '../lib/communityModeration.js';

/**
 * Fase 3 (voz e boas-vindas):
 *  - PUT /api/channels/:id/user-limit — limite de pessoas do canal de VOZ
 *    (2..8 ou null), permissao manageChannels. O join-room aplica.
 *  - PUT /api/communities/:id/welcome — canal de texto e modelo `{nome}` da
 *    mensagem de sistema postada quando alguem entra por convite. OWNER/ADMIN.
 * Nao membro = 404 (nao revela a comunidade).
 */
const params = z.object({ id: z.string().uuid() });
const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;
const changed = (app: FastifyInstance, id: string): void => { ioOf(app)?.to(communityRoom(id)).emit('community:changed', { communityId: id }); };
const missing = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'Not found' });
const invalid = (reply: FastifyReply): FastifyReply => reply.code(400).send({ error: 'Invalid input' });
const forbidden = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'Forbidden' });
const meOf = (request: FastifyRequest): string => request.userId!;

export async function communityWelcomeRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };

  app.put('/api/channels/:id/user-limit', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = channelUserLimitSchema.safeParse(request.body);
    if (!p.success || !body.success) return invalid(reply);
    const room = await prisma.room.findUnique({ where: { id: p.data.id }, select: { id: true, name: true, communityId: true, channelKind: true } });
    if (!room?.communityId) return missing(reply);
    const member = await findMembership(room.communityId, meOf(request)); if (!member) return missing(reply);
    if (!permissionsOf(member).manageChannels) return forbidden(reply);
    if (room.channelKind !== 'VOICE') return invalid(reply);
    await prisma.room.update({ where: { id: room.id }, data: { userLimit: body.data.userLimit } });
    const limit = body.data.userLimit;
    await audit(room.communityId, { action: 'channel.user_limit', actorId: meOf(request), targetId: room.id, targetName: room.name, detail: limit ? `${limit} pessoas` : 'sem limite' });
    changed(app, room.communityId);
    return reply.send({ ok: true });
  });

  app.put('/api/communities/:id/welcome', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = communityWelcomeSchema.safeParse(request.body);
    if (!p.success || !body.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply);
    if (!canModerate(member.role)) return forbidden(reply);
    let channelName: string | null = null;
    if (body.data.channelId) {
      const room = await prisma.room.findUnique({ where: { id: body.data.channelId }, select: { communityId: true, channelKind: true, name: true } });
      if (room?.communityId !== p.data.id || room.channelKind !== 'TEXT') return invalid(reply);
      channelName = room.name;
    }
    await prisma.community.update({ where: { id: p.data.id }, data: { welcomeChannelId: body.data.channelId, welcomeMessage: body.data.message } });
    await audit(p.data.id, {
      action: 'community.welcome', actorId: meOf(request), targetId: body.data.channelId, targetName: channelName,
      detail: channelName ? 'mensagem atualizada' : 'desligadas',
    });
    changed(app, p.data.id);
    return reply.send({ ok: true });
  });
}
