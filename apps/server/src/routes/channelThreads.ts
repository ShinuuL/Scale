import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { channelThreadArchiveSchema, channelThreadCreateSchema, channelThreadMessageSendSchema, type ChannelThreadEvent, type ChannelThreadSummary } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { permissionsOf, toChannelMessage } from '../lib/communityAccess.js';
import { checkChannelPost, emitToChannel, viewableChannel } from '../lib/channelPermissions.js';
import { buildChannelMessages, threadSummaryOf } from '../lib/channelMessageMeta.js';
import { isChatRateLimited } from '../lib/rateLimit.js';
import { activeTimeout, timedOutBody } from '../lib/communityModeration.js';
import { emitCommunityActivity } from '../lib/unread.js';

/**
 * Fase 4: topicos (threads) nos canais de TEXTO de comunidade.
 *
 *  - POST  /api/channels/:id/messages/:messageId/thread  { name }  -> abre (201); 409 se ja existe
 *  - GET   /api/threads/:id                                       -> resumo + canSend/canManage
 *  - GET   /api/threads/:id/messages?cursor&limit                 -> historico paginado
 *  - POST  /api/threads/:id/messages  { content }                 -> envia (arquivado = 409)
 *  - PATCH /api/threads/:id  { archived }                         -> manageMessages
 *
 * Mesmas permissoes do canal pai (ver, enviar, aviso, modo lento, castigo):
 * quem nao ve o canal recebe 404. Tempo real por `emitToChannel`:
 * `channel:message` (com `threadId`) e `channel:thread` (resumo atualizado).
 * Editar/apagar mensagem do topico usa as rotas do canal.
 */
const idSchema = z.string().uuid();
const params = z.object({ id: idSchema });
const messageParams = params.extend({ messageId: idSchema });
const querySchema = z.object({ cursor: idSchema.optional(), limit: z.coerce.number().int().min(1).max(50).default(50) });
const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;
const missing = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'Not found' });
const invalid = (reply: FastifyReply): FastifyReply => reply.code(400).send({ error: 'Invalid input' });
const tooMany = (reply: FastifyReply): FastifyReply => reply.code(429).header('Retry-After', '5').send({ error: 'Too many messages' });
const meOf = (request: FastifyRequest): string => request.userId!;

/** Topico + canal pai visivel ao usuario; null = 404. */
async function viewableThread(threadId: string, userId: string) {
  const thread = await prisma.channelThread.findUnique({ where: { id: threadId } });
  if (!thread) return null;
  const found = await viewableChannel(thread.roomId, userId);
  if (!found || found.room.channelKind !== 'TEXT') return null;
  return { thread, ...found };
}

export async function channelThreadRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };
  const emitThread = async (communityId: string, thread: ChannelThreadSummary): Promise<void> => {
    const event: ChannelThreadEvent = { channelId: thread.channelId, thread };
    await emitToChannel(ioOf(app), communityId, thread.channelId, 'channel:thread', event);
  };

  app.post('/api/channels/:id/messages/:messageId/thread', auth, async (request, reply) => {
    const p = messageParams.safeParse(request.params); const body = channelThreadCreateSchema.safeParse(request.body);
    if (!p.success || !body.success) return invalid(reply);
    const me = meOf(request);
    const found = await viewableChannel(p.data.id, me); if (!found || found.room.channelKind !== 'TEXT') return missing(reply);
    const { room, member, access } = found;
    const timedOut = activeTimeout(member); if (timedOut) return reply.code(403).send(timedOutBody(timedOut));
    if (!access.send) return reply.code(403).send({ error: 'Sem permissão para enviar neste canal' });
    const root = await prisma.chatMessage.findUnique({ where: { id: p.data.messageId }, select: { roomId: true, threadId: true, deletedAt: true, isSystem: true } });
    if (!root || root.roomId !== room.id || root.threadId) return missing(reply);
    if (root.deletedAt || root.isSystem) return invalid(reply);
    const existing = await prisma.channelThread.findUnique({ where: { rootMessageId: p.data.messageId } });
    if (existing) return reply.code(409).send({ error: 'Thread exists', thread: await threadSummaryOf(existing.id) });
    if (isChatRateLimited(`user:${me}`)) return tooMany(reply);
    let threadId: string;
    try {
      threadId = (await prisma.channelThread.create({ data: { roomId: room.id, rootMessageId: p.data.messageId, name: body.data.name, createdById: me } })).id;
    } catch (err) {
      // Dois cliques simultaneos: o segundo bate no unique da origem.
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      const raced = await prisma.channelThread.findUnique({ where: { rootMessageId: p.data.messageId } });
      return reply.code(409).send({ error: 'Thread exists', thread: raced ? await threadSummaryOf(raced.id) : null });
    }
    const thread = await threadSummaryOf(threadId); if (!thread) return missing(reply);
    await emitThread(room.communityId, thread);
    return reply.code(201).send({ thread });
  });

  app.get('/api/threads/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const found = await viewableThread(p.data.id, meOf(request)); if (!found) return missing(reply);
    const thread = await threadSummaryOf(found.thread.id); if (!thread) return missing(reply);
    return reply.send({ thread, canSend: found.access.send && !found.thread.archivedAt, canManage: permissionsOf(found.member).manageMessages });
  });

  app.get('/api/threads/:id/messages', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const query = querySchema.safeParse(request.query);
    if (!p.success || !query.success) return invalid(reply);
    const found = await viewableThread(p.data.id, meOf(request)); if (!found) return missing(reply);
    const threadId = found.thread.id;
    let cursorDate: Date | undefined;
    if (query.data.cursor) {
      const cursor = await prisma.chatMessage.findUnique({ where: { id: query.data.cursor } });
      if (!cursor || cursor.threadId !== threadId) return missing(reply);
      cursorDate = cursor.createdAt;
    }
    const rows = await prisma.chatMessage.findMany({
      where: { roomId: found.room.id, threadId, ...(cursorDate && query.data.cursor ? { OR: [{ createdAt: { lt: cursorDate } }, { createdAt: cursorDate, id: { lt: query.data.cursor } }] } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.data.limit, include: { files: true },
    });
    const messages = await buildChannelMessages(found.room.id, rows.reverse());
    return reply.send({ messages, nextCursor: rows.length === query.data.limit ? rows[0]?.id ?? null : null });
  });

  app.post('/api/threads/:id/messages', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = channelThreadMessageSendSchema.safeParse(request.body);
    if (!p.success || !body.success) return invalid(reply);
    const me = meOf(request);
    const found = await viewableThread(p.data.id, me); if (!found) return missing(reply);
    const { room, member, access, thread } = found;
    const timedOut = activeTimeout(member); if (timedOut) return reply.code(403).send(timedOutBody(timedOut));
    if (thread.archivedAt) return reply.code(409).send({ error: 'Thread archived' });
    const post = await checkChannelPost(room, access, me);
    if (!post.ok) { if (post.body.retryAfterSeconds) void reply.header('Retry-After', String(post.body.retryAfterSeconds)); return reply.code(post.status).send(post.body); }
    if (isChatRateLimited(`user:${me}`)) return tooMany(reply);
    const user = await prisma.user.findUnique({ where: { id: me }, include: { username: true } }); if (!user) return missing(reply);
    const row = await prisma.chatMessage.create({ data: { roomId: room.id, authorId: me, content: body.data.content, threadId: thread.id } });
    const message = toChannelMessage(row, { id: user.id, name: user.name, username: user.username?.name ?? null });
    await emitToChannel(ioOf(app), room.communityId, room.id, 'channel:message', message);
    const summary = await threadSummaryOf(thread.id);
    if (summary) await emitThread(room.communityId, summary);
    await emitCommunityActivity(ioOf(app), room.communityId, room.id, me);
    return reply.code(201).send({ message });
  });

  app.patch('/api/threads/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = channelThreadArchiveSchema.safeParse(request.body);
    if (!p.success || !body.success) return invalid(reply);
    const me = meOf(request);
    const found = await viewableThread(p.data.id, me); if (!found) return missing(reply);
    if (!permissionsOf(found.member).manageMessages) return reply.code(403).send({ error: 'Forbidden' });
    if (Boolean(found.thread.archivedAt) !== body.data.archived) {
      await prisma.channelThread.update({ where: { id: found.thread.id }, data: body.data.archived ? { archivedAt: new Date(), archivedById: me } : { archivedAt: null, archivedById: null } });
    }
    const thread = await threadSummaryOf(found.thread.id); if (!thread) return missing(reply);
    await emitThread(found.room.communityId, thread);
    return reply.send({ thread });
  });
}
