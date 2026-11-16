import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { MAX_PINNED_PER_CHANNEL, channelReactionToggleSchema, type ChannelPinEvent, type ChannelReactionEvent } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { permissionsOf, type Membership } from '../lib/communityAccess.js';
import { emitToChannel, viewableChannel } from '../lib/channelPermissions.js';
import { buildChannelMessages } from '../lib/channelMessageMeta.js';
import { isChannelReactionRateLimited } from '../lib/rateLimit.js';
import { activeTimeout, audit, timedOutBody } from '../lib/communityModeration.js';

/**
 * Fase 2 das comunidades: reacoes (conjunto fixo) e mensagens fixadas nos
 * canais de TEXTO. Mesmo modelo de acesso das mensagens: quem nao e membro
 * recebe 404 (nao descobre o canal).
 *
 *  - POST   /api/channels/:id/messages/:messageId/reactions  { reaction } -> toggle
 *  - PUT    /api/channels/:id/messages/:messageId/pin        (manageMessages)
 *  - DELETE /api/channels/:id/messages/:messageId/pin        (manageMessages)
 *  - GET    /api/channels/:id/pins                           (membro; ate 50)
 *
 * Eventos na sala `community:<id>`: `channel:reaction` e `channel:message-pin`.
 */
const idSchema = z.string().uuid();
const params = z.object({ id: idSchema });
const messageParams = params.extend({ messageId: idSchema });
const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;
const missing = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'Not found' });
const invalid = (reply: FastifyReply): FastifyReply => reply.code(400).send({ error: 'Invalid input' });
const limited = (reply: FastifyReply): FastifyReply => reply.code(429).header('Retry-After', '10').send({ error: 'Too many requests' });

interface ChannelAccess { communityId: string; roomId: string; me: string; member: Membership }

/** Canal de texto de comunidade + membership; null = 404. */
async function channelAccess(request: FastifyRequest, channelId: string): Promise<ChannelAccess | null> {
  const me = request.userId!;
  // Fase 3: canal que o membro nao ve = 404 (reagir vale ate em canal de avisos).
  const found = await viewableChannel(channelId, me);
  if (!found || found.room.channelKind !== 'TEXT') return null;
  return { communityId: found.room.communityId, roomId: found.room.id, me, member: found.member };
}

export async function channelMessageExtrasRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };

  app.post('/api/channels/:id/messages/:messageId/reactions', auth, async (request, reply) => {
    const p = messageParams.safeParse(request.params); const body = channelReactionToggleSchema.safeParse(request.body);
    if (!p.success || !body.success) return invalid(reply);
    const access = await channelAccess(request, p.data.id); if (!access) return missing(reply);
    const message = await prisma.chatMessage.findUnique({ where: { id: p.data.messageId }, select: { roomId: true, deletedAt: true } });
    if (!message || message.roomId !== access.roomId) return missing(reply);
    if (message.deletedAt) return invalid(reply);
    const timedOut = activeTimeout(access.member); if (timedOut) return reply.code(403).send(timedOutBody(timedOut));
    if (isChannelReactionRateLimited(`user:${access.me}`)) return limited(reply);
    const key = { messageId_userId_reaction: { messageId: p.data.messageId, userId: access.me, reaction: body.data.reaction } };
    const existing = await prisma.chatMessageReaction.findUnique({ where: key });
    try {
      if (existing) await prisma.chatMessageReaction.deleteMany({ where: { id: existing.id } });
      else await prisma.chatMessageReaction.create({ data: { messageId: p.data.messageId, userId: access.me, reaction: body.data.reaction } });
    } catch (err) {
      // Dois cliques simultaneos: o segundo create bate no unique; o estado final e o mesmo.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
    }
    const rows = await prisma.chatMessageReaction.findMany({ where: { messageId: p.data.messageId, reaction: body.data.reaction }, orderBy: { createdAt: 'asc' }, select: { userId: true } });
    const event: ChannelReactionEvent = { channelId: access.roomId, messageId: p.data.messageId, reaction: body.data.reaction, userIds: rows.map(r => r.userId) };
    await emitToChannel(ioOf(app), access.communityId, access.roomId, 'channel:reaction', event);
    return reply.send(event);
  });

  const setPin = async (request: FastifyRequest, reply: FastifyReply, pin: boolean): Promise<FastifyReply> => {
    const p = messageParams.safeParse(request.params); if (!p.success) return invalid(reply);
    const access = await channelAccess(request, p.data.id); if (!access) return missing(reply);
    const message = await prisma.chatMessage.findUnique({ where: { id: p.data.messageId }, select: { roomId: true, deletedAt: true, pinnedAt: true, pinnedById: true } });
    if (!message || message.roomId !== access.roomId) return missing(reply);
    if (!permissionsOf(access.member).manageMessages) return reply.code(403).send({ error: 'Forbidden' });
    if (pin && message.deletedAt) return invalid(reply);
    if (isChannelReactionRateLimited(`user:${access.me}`)) return limited(reply);
    const already = pin ? message.pinnedAt != null : message.pinnedAt == null;
    if (already) {
      const current: ChannelPinEvent = { channelId: access.roomId, messageId: p.data.messageId, pinnedAt: message.pinnedAt?.toISOString() ?? null, pinnedById: message.pinnedById };
      return reply.send(current);
    }
    if (pin) {
      const count = await prisma.chatMessage.count({ where: { roomId: access.roomId, pinnedAt: { not: null } } });
      if (count >= MAX_PINNED_PER_CHANNEL) return reply.code(409).send({ error: 'Pin limit reached' });
    }
    const pinnedAt = pin ? new Date() : null;
    await prisma.chatMessage.update({ where: { id: p.data.messageId }, data: { pinnedAt, pinnedById: pin ? access.me : null } });
    const event: ChannelPinEvent = { channelId: access.roomId, messageId: p.data.messageId, pinnedAt: pinnedAt?.toISOString() ?? null, pinnedById: pin ? access.me : null };
    await emitToChannel(ioOf(app), access.communityId, access.roomId, 'channel:message-pin', event);
    const channel = await prisma.room.findUnique({ where: { id: access.roomId }, select: { name: true } });
    await audit(access.communityId, { action: pin ? 'message.pin' : 'message.unpin', actorId: access.me, targetId: p.data.messageId, targetName: channel?.name ?? null });
    return reply.send(event);
  };
  app.put('/api/channels/:id/messages/:messageId/pin', auth, (request, reply) => setPin(request, reply, true));
  app.delete('/api/channels/:id/messages/:messageId/pin', auth, (request, reply) => setPin(request, reply, false));

  app.get('/api/channels/:id/pins', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const access = await channelAccess(request, p.data.id); if (!access) return missing(reply);
    const rows = await prisma.chatMessage.findMany({ where: { roomId: access.roomId, pinnedAt: { not: null }, deletedAt: null }, orderBy: { pinnedAt: 'desc' }, take: MAX_PINNED_PER_CHANNEL, include: { files: true } });
    return reply.send({ messages: await buildChannelMessages(access.roomId, rows) });
  });
}
