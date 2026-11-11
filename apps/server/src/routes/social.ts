import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  DM_PAGE_SIZE,
  dmSendSchema,
  friendRequestSchema,
  setUsernameSchema,
  type DirectMessage,
  type FriendRequestDto,
  type PublicUser,
} from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { isDirectMessageRateLimited, isFriendRequestRateLimited } from '../lib/rateLimit.js';
import { AVATARS_ROOT, meSelect, toMe } from './profile.js';
import { getRoomPeerUserId, userRoom } from '../socket/handler.js';
import { guardRoomParticipation } from '../lib/roomAccess.js';
import { moderateText, recordModerationEvent } from '../lib/moderation/index.js';

/**
 * Amizades e mensagens privadas. Tudo exige login (convidado nao tem conta).
 *
 * Tempo real: cada socket logado entra na sala `user:<userId>` (ver
 * socket/handler.ts). As rotas avisam por la:
 *   - `friends:changed` — a lista do usuario mudou (refaz o GET /api/friends);
 *   - `dm:message`      — mensagem nova (vai para remetente e destinatario, as
 *                         outras abas do remetente tambem atualizam).
 */

export const publicUserSelect = { id: true, name: true, avatarUpdatedAt: true, username: { select: { name: true } } } as const;

type PublicUserRow = { id: string; username: { name: string } | null; name: string; avatarUpdatedAt: Date | null };

export function toPublicUser(u: PublicUserRow): PublicUser {
  return {
    id: u.id,
    username: u.username?.name ?? null,
    name: u.name,
    avatarUpdatedAt: u.avatarUpdatedAt?.toISOString() ?? null,
  };
}

function toDirectMessage(m: { id: string; senderId: string; recipientId: string; content: string; createdAt: Date }): DirectMessage {
  return {
    id: m.id,
    senderId: m.senderId,
    recipientId: m.recipientId,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
  };
}

/** Linha da amizade entre dois usuarios, em qualquer direcao. */
async function findFriendship(a: string, b: string) {
  return prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
  });
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const f = await findFriendship(a, b);
  return f?.status === 'ACCEPTED';
}

function ioOf(fastify: FastifyInstance): Server | undefined {
  return (fastify as unknown as { io?: Server }).io;
}

function notifyFriendsChanged(fastify: FastifyInstance, ...userIds: string[]): void {
  const io = ioOf(fastify);
  if (!io) return;
  for (const id of userIds) io.to(userRoom(id)).emit('friends:changed', {});
}

function tooMany(reply: FastifyReply, message: string, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header('Retry-After', String(Math.max(1, retryAfterSeconds)))
    .send({ error: message });
}

function validationFailed(reply: FastifyReply, error: z.ZodError): FastifyReply {
  return reply.code(400).send({ error: 'Validation failed', details: error.flatten().fieldErrors });
}

/** userId da sessao ou 401 (o preHandler authenticate ja barrou o anonimo). */
function sessionUser(request: FastifyRequest, reply: FastifyReply): string | null {
  if (!request.userId) {
    void reply.code(401).send({ error: 'Not authenticated' });
    return null;
  }
  return request.userId;
}

const userIdParams = z.object({ userId: z.string().min(1).max(64) });
const requestIdParams = z.object({ id: z.string().uuid() });
const historyQuery = z.object({ before: z.string().datetime().optional() });

export async function socialRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [fastify.authenticate as never] };

  // PUT /api/me/username — escolhe ou troca o @nome (unico, minusculo).
  fastify.put('/api/me/username', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const parsed = setUsernameSchema.safeParse(request.body);
    if (!parsed.success) return validationFailed(reply, parsed.error);

    const { username } = parsed.data;
    try {
      await prisma.username.upsert({
        where: { userId: me },
        create: { name: username, userId: me },
        update: { name: username },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'Username already taken' });
      }
      throw err;
    }
    const user = await prisma.user.findUnique({ where: { id: me }, select: meSelect });
    if (!user) return reply.code(404).send({ error: 'User not found' });
    return reply.send({ user: toMe(user) });
  });

  // GET /api/friends — amigos, pedidos recebidos e enviados.
  fastify.get('/api/friends', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;

    const rows = await prisma.friendship.findMany({
      where: { OR: [{ requesterId: me }, { addresseeId: me }] },
      include: { requester: { select: publicUserSelect }, addressee: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
    });

    const friends: PublicUser[] = [];
    const incoming: FriendRequestDto[] = [];
    const outgoing: FriendRequestDto[] = [];
    for (const f of rows) {
      const other = f.requesterId === me ? f.addressee : f.requester;
      if (f.status === 'ACCEPTED') friends.push(toPublicUser(other));
      else {
        const dto = { id: f.id, user: toPublicUser(other), createdAt: f.createdAt.toISOString() };
        (f.addresseeId === me ? incoming : outgoing).push(dto);
      }
    }
    friends.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return reply.send({ friends, incoming, outgoing });
  });

  // POST /api/friends/requests — pede amizade pelo @nome. Pedido cruzado
  // (o outro ja tinha pedido) vira aceite direto.
  fastify.post('/api/friends/requests', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;

    const limit = isFriendRequestRateLimited(me);
    if (limit.limited) return tooMany(reply, 'Too many friend requests. Try again later.', limit.retryAfterSeconds);

    const parsed = friendRequestSchema.safeParse(request.body);
    if (!parsed.success) return validationFailed(reply, parsed.error);

    const handle = await prisma.username.findUnique({ where: { name: parsed.data.username } });
    const target = handle ? { id: handle.userId } : null;
    if (!target) return reply.code(404).send({ error: 'User not found' });
    if (target.id === me) return reply.code(400).send({ error: 'Cannot add yourself' });

    const existing = await findFriendship(me, target.id);
    if (existing?.status === 'ACCEPTED') return reply.code(409).send({ error: 'Already friends' });
    if (existing && existing.requesterId === me) return reply.code(409).send({ error: 'Request already sent' });
    if (existing) {
      await prisma.friendship.update({
        where: { id: existing.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      notifyFriendsChanged(fastify, me, target.id);
      return reply.code(200).send({ status: 'ACCEPTED' });
    }

    try {
      await prisma.friendship.create({ data: { requesterId: me, addresseeId: target.id } });
    } catch (err) {
      // Dois pedidos simultaneos do mesmo par: o unique segura o segundo.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'Request already sent' });
      }
      throw err;
    }
    notifyFriendsChanged(fastify, me, target.id);
    return reply.code(201).send({ status: 'PENDING' });
  });

  // POST /api/friends/requests/:id/accept — so quem RECEBEU aceita.
  fastify.post('/api/friends/requests/:id/accept', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const params = requestIdParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Request not found' });

    const f = await prisma.friendship.findUnique({ where: { id: params.data.id } });
    if (!f || f.addresseeId !== me || f.status !== 'PENDING') {
      return reply.code(404).send({ error: 'Request not found' });
    }
    await prisma.friendship.update({ where: { id: f.id }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    notifyFriendsChanged(fastify, f.requesterId, f.addresseeId);
    return reply.send({ status: 'ACCEPTED' });
  });

  // DELETE /api/friends/requests/:id — recusa (destinatario) ou cancela (autor).
  fastify.delete('/api/friends/requests/:id', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const params = requestIdParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Request not found' });

    const f = await prisma.friendship.findUnique({ where: { id: params.data.id } });
    if (!f || f.status !== 'PENDING' || (f.addresseeId !== me && f.requesterId !== me)) {
      return reply.code(404).send({ error: 'Request not found' });
    }
    await prisma.friendship.delete({ where: { id: f.id } });
    notifyFriendsChanged(fastify, f.requesterId, f.addresseeId);
    return reply.send({ success: true });
  });

  // DELETE /api/friends/:userId — desfaz a amizade. A conversa fica guardada,
  // mas so volta a ser lida/escrita se a amizade for refeita.
  fastify.delete('/api/friends/:userId', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const params = userIdParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Friend not found' });

    const f = await findFriendship(me, params.data.userId);
    if (!f || f.status !== 'ACCEPTED') return reply.code(404).send({ error: 'Friend not found' });
    await prisma.friendship.delete({ where: { id: f.id } });
    notifyFriendsChanged(fastify, me, params.data.userId);
    return reply.send({ success: true });
  });

  // GET /api/dm/:userId/messages?before=<ISO> — historico, do mais antigo ao
  // mais novo, paginado para tras. So entre amigos.
  fastify.get('/api/dm/:userId/messages', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const params = userIdParams.safeParse(request.params);
    const query = historyQuery.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: 'Validation failed' });
    const other = params.data.userId;
    if (!(await areFriends(me, other))) return reply.code(403).send({ error: 'Not friends' });

    const rows = await prisma.directMessage.findMany({
      where: {
        OR: [
          { senderId: me, recipientId: other },
          { senderId: other, recipientId: me },
        ],
        ...(query.data.before ? { createdAt: { lt: new Date(query.data.before) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: DM_PAGE_SIZE + 1,
    });
    const hasMore = rows.length > DM_PAGE_SIZE;
    const messages = rows.slice(0, DM_PAGE_SIZE).reverse().map(toDirectMessage);
    return reply.send({ messages, hasMore });
  });

  // POST /api/dm/:userId/messages — envia texto a um amigo.
  fastify.post('/api/dm/:userId/messages', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;

    const limit = isDirectMessageRateLimited(me);
    if (limit.limited) return tooMany(reply, 'Rate limit exceeded. Slow down.', limit.retryAfterSeconds);

    const params = userIdParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Validation failed' });
    const parsed = dmSendSchema.safeParse(request.body);
    if (!parsed.success) return validationFailed(reply, parsed.error);
    const other = params.data.userId;
    if (other === me) return reply.code(400).send({ error: 'Cannot message yourself' });
    if (!(await areFriends(me, other))) return reply.code(403).send({ error: 'Not friends' });

    // Moderacao ANTES de gravar: high bloqueia (422), medium entrega e avisa
    // so o autor (`moderation:warning` na sala `user:<me>`).
    const verdict = await moderateText(parsed.data.content, fastify.log);
    if (verdict.severity === 'high') {
      await recordModerationEvent({
        kind: 'text', source: 'dm', userId: me, category: verdict.category, severity: verdict.severity,
        action: 'blocked', excerpt: parsed.data.content,
      }, fastify.log);
      return reply.code(422).send({ error: 'Mensagem bloqueada pela moderacao', code: 'MODERATED', category: verdict.category });
    }

    const row = await prisma.directMessage.create({
      data: { senderId: me, recipientId: other, content: parsed.data.content },
    });
    const message = toDirectMessage(row);
    ioOf(fastify)?.to([userRoom(me), userRoom(other)]).emit('dm:message', message);
    if (verdict.severity === 'medium') {
      await recordModerationEvent({
        kind: 'text', source: 'dm', userId: me, category: verdict.category, severity: verdict.severity,
        action: 'warned', excerpt: parsed.data.content,
      }, fastify.log);
      ioOf(fastify)?.to(userRoom(me)).emit('moderation:warning', {
        category: verdict.category,
        text: 'Sua mensagem foi marcada pelo assistente de moderacao. Mantenha o respeito.',
      });
    }
    return reply.code(201).send({ message });
  });

  // GET /api/users/:userId/avatar — foto de um amigo (ou a propria).
  fastify.get('/api/users/:userId/avatar', auth, async (request, reply) => {
    const me = sessionUser(request, reply);
    if (!me) return reply;
    const params = userIdParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'No avatar' });
    const other = params.data.userId;
    // Sem amizade responde igual a "sem foto": nao confirma quem existe.
    if (other !== me && !(await areFriends(me, other))) return reply.code(404).send({ error: 'No avatar' });

    return sendUserAvatar(reply, other);
  });

  // GET /api/rooms/:roomId/peers/:peerId/avatar — foto de quem esta na chamada.
  // So participante da sala (room ticket no header, ou dono) e so de um peer
  // que esta NELA agora; o userId nao trafega, o cliente so conhece o peerId.
  // Convidado, peer fora da sala ou sem foto: o mesmo 404.
  fastify.get('/api/rooms/:roomId/peers/:peerId/avatar', async (request, reply) => {
    const params = peerAvatarParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'No avatar' });
    const room = await prisma.room.findUnique({ where: { id: params.data.roomId } });
    if (!room) return reply.code(404).send({ error: 'No avatar' });
    if (!(await guardRoomParticipation(request, reply, room))) return reply;

    const userId = getRoomPeerUserId(room.id, params.data.peerId);
    if (!userId) return reply.code(404).send({ error: 'No avatar' });
    // A foto muda de dono se o peerId for reaproveitado: cache curto e privado.
    reply.header('Cache-Control', 'private, max-age=300');
    return sendUserAvatar(reply, userId);
  });
}

const peerAvatarParams = z.object({
  roomId: z.string().uuid(),
  // socket.id do Socket.io: 20 caracteres [A-Za-z0-9_-].
  peerId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
});

/** Envia a foto do usuario (sandbox em AVATARS_ROOT) ou 404 "No avatar". */
async function sendUserAvatar(reply: FastifyReply, userId: string): Promise<FastifyReply> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { avatarPath: true, avatarMime: true } });
  const abs = user?.avatarPath ? path.resolve(process.cwd(), user.avatarPath) : null;
  if (!abs || !user?.avatarMime || !abs.startsWith(AVATARS_ROOT + path.sep)) {
    return reply.code(404).send({ error: 'No avatar' });
  }
  reply.header('Content-Type', user.avatarMime);
  reply.header('X-Content-Type-Options', 'nosniff');
  return reply.send(fs.createReadStream(abs));
}
