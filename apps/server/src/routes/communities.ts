import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { CustomRoleInput } from '@scale/shared';
import { CHAT_EDIT_WINDOW_MS, MAX_COMMUNITIES_OWNED, MAX_COMMUNITIES_JOINED, MAX_CHANNELS_PER_COMMUNITY, MAX_COMMUNITY_MEMBERS, communityCreateSchema, channelCreateSchema, channelUpdateSchema, communityMemberRoleSchema, communityInviteCreateSchema, communityInviteCodeSchema, channelMessageSendSchema, customRoleInputSchema, memberCustomRoleSchema, MAX_CUSTOM_ROLES } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { DELETED_MESSAGE_CONTENT } from '../lib/publicDto.js';
import { findMembership, permissionsOf, communityRoom, toChannelMessage } from '../lib/communityAccess.js';
import { isChatRateLimited, isCommunityInviteRateLimited } from '../lib/rateLimit.js';
import { evictCommunityUser, evictCommunity } from '../socket/handler.js';
import { purgeRoom } from '../lib/roomDeletion.js';
import { getClientIp } from '../lib/clientIp.js';
import { channelUnreads, emitCommunityActivity, markChannelsRead, totalsByCommunity } from '../lib/unread.js';
import { removeCommunityMedia } from './communityExtras.js';
import { buildChannelMessages, loadReplies } from '../lib/channelMessageMeta.js';
import { postWelcomeMessage, welcomeChannelOf } from '../lib/communityWelcome.js';

const idSchema = z.string().uuid();
const params = z.object({ id: idSchema });
const memberParams = params.extend({ userId: z.string().min(1).max(64) });
const messageParams = params.extend({ messageId: idSchema });
const querySchema = z.object({ cursor: idSchema.optional(), limit: z.coerce.number().int().min(1).max(50).default(50) });
const hash = (code: string): string => createHash('sha256').update(code).digest('hex');
const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;
const changed = (app: FastifyInstance, id: string): void => { ioOf(app)?.to(communityRoom(id)).emit('community:changed', { communityId: id }); };
const missing = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'Not found' });
const invalid = (reply: FastifyReply): FastifyReply => reply.code(400).send({ error: 'Invalid input' });
const forbidden = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'Forbidden' });
const meOf = (request: FastifyRequest): string => request.userId!;
const inviteLimit = (request: FastifyRequest, reply: FastifyReply): boolean => {
  const limit = isCommunityInviteRateLimited(getClientIp(request));
  if (!limit.limited) return false;
  void reply.code(429).header('Retry-After', String(limit.retryAfterSeconds)).send({ error: 'Too many requests' });
  return true;
};

export async function communityRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };
  app.post('/api/communities', auth, async (request, reply) => {
    const body = communityCreateSchema.safeParse(request.body); if (!body.success) return invalid(reply);
    const me = meOf(request);
    const community = await prisma.$transaction(async tx => {
      if (await tx.community.count({ where: { ownerId: me } }) >= MAX_COMMUNITIES_OWNED || await tx.communityMember.count({ where: { userId: me } }) >= MAX_COMMUNITIES_JOINED) return null;
      return tx.community.create({ data: { name: body.data.name, ownerId: me, members: { create: { userId: me, role: 'OWNER' } }, rooms: { create: [ { name: 'geral', channelKind: 'TEXT', isPersistent: true, isPrivate: true, position: 0 }, { name: 'Sala de voz', channelKind: 'VOICE', isPersistent: true, isPrivate: true, position: 1 } ] } } });
    });
    if (!community) return reply.code(409).send({ error: 'Community limit reached' });
    return reply.code(201).send({ community: { id: community.id, name: community.name, ownerId: community.ownerId } });
  });
  app.get('/api/communities', auth, async (request, reply) => {
    const rows = await prisma.communityMember.findMany({ where: { userId: meOf(request) }, include: { community: true }, orderBy: { joinedAt: 'asc' } });
    const unread = totalsByCommunity(await channelUnreads(meOf(request)));
    return reply.send({ communities: rows.map(row => ({ id: row.community.id, name: row.community.name, role: row.role, iconUpdatedAt: row.community.iconUpdatedAt?.toISOString() ?? null, unread: unread.get(row.community.id) ?? 0 })) });
  });
  app.get('/api/communities/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const membership = await findMembership(p.data.id, meOf(request)); if (!membership) return missing(reply);
    const community = await prisma.community.findUnique({ where: { id: p.data.id }, include: { rooms: { orderBy: { position: 'asc' } }, categories: { orderBy: { position: 'asc' } }, customRoles: { orderBy: { createdAt: 'asc' } }, members: { include: { user: { include: { username: true } } }, orderBy: { joinedAt: 'asc' } } } });
    if (!community) return missing(reply);
    const unread = new Map((await channelUnreads(meOf(request), community.id)).map(row => [row.channelId, row.unread]));
    return reply.send({ community: { id: community.id, name: community.name, ownerId: community.ownerId, iconUpdatedAt: community.iconUpdatedAt?.toISOString() ?? null, bannerUpdatedAt: community.bannerUpdatedAt?.toISOString() ?? null, welcome: await welcomeChannelOf(community.id) }, myRole: membership.role, myPermissions: permissionsOf(membership), roles: community.customRoles.map(r => ({ id: r.id, name: r.name, color: r.color, permissions: { manageChannels: r.manageChannels, manageInvites: r.manageInvites, manageMessages: r.manageMessages, kickMembers: r.kickMembers } })), categories: community.categories.map(c => ({ id: c.id, name: c.name, position: c.position })), channels: community.rooms.map(r => ({ id: r.id, name: r.name, kind: r.channelKind, position: r.position, categoryId: r.categoryId, topic: r.topic ?? null, userLimit: r.userLimit ?? null, unread: unread.get(r.id) ?? 0 })), members: community.members.map(m => ({ userId: m.userId, name: m.user.name, username: m.user.username?.name ?? null, role: m.role, customRoleId: m.customRoleId })) });
  });
  app.patch('/api/communities/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = communityCreateSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply); if (member.role !== 'OWNER') return forbidden(reply);
    await prisma.community.update({ where: { id: p.data.id }, data: body.data }); changed(app, p.data.id); return reply.send({ ok: true });
  });
  app.delete('/api/communities/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply); if (member.role !== 'OWNER') return forbidden(reply);
    ioOf(app)?.to(communityRoom(p.data.id)).emit('community:deleted', { communityId: p.data.id });
    await evictCommunity(ioOf(app), p.data.id);
    const rooms = await prisma.room.findMany({ where: { communityId: p.data.id }, select: { id: true } });
    for (const room of rooms) await purgeRoom(ioOf(app), room.id, app.log);
    await removeCommunityMedia(p.data.id);
    await prisma.community.delete({ where: { id: p.data.id } }); return reply.send({ ok: true });
  });
  app.post('/api/communities/:id/leave', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const me = meOf(request); const member = await findMembership(p.data.id, me); if (!member) return missing(reply); if (member.role === 'OWNER') return forbidden(reply);
    await prisma.communityMember.delete({ where: { id: member.id } }); await evictCommunityUser(ioOf(app), p.data.id, me); changed(app, p.data.id); return reply.send({ ok: true });
  });
  app.delete('/api/communities/:id/members/:userId', auth, async (request, reply) => {
    const p = memberParams.safeParse(request.params); if (!p.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply);
    const target = await findMembership(p.data.id, p.data.userId); if (!target) return missing(reply);
    if (!permissionsOf(member).kickMembers || target.role === 'OWNER' || (target.role === 'ADMIN' && member.role !== 'OWNER') || p.data.userId === meOf(request)) return forbidden(reply);
    await prisma.communityMember.delete({ where: { id: target.id } }); await evictCommunityUser(ioOf(app), p.data.id, p.data.userId); changed(app, p.data.id); return reply.send({ ok: true });
  });
  app.patch('/api/communities/:id/members/:userId', auth, async (request, reply) => {
    const p = memberParams.safeParse(request.params); const body = communityMemberRoleSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply); if (member.role !== 'OWNER') return forbidden(reply);
    const target = await findMembership(p.data.id, p.data.userId); if (!target) return missing(reply); if (target.role === 'OWNER') return forbidden(reply);
    await prisma.communityMember.update({ where: { id: target.id }, data: body.data }); changed(app, p.data.id); return reply.send({ ok: true });
  });
  // Cargos personalizados: so o OWNER cria, edita, apaga e atribui.
  const roleData = (input: CustomRoleInput) => ({ name: input.name, color: input.color.toLowerCase(), ...input.permissions });
  app.post('/api/communities/:id/roles', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = customRoleInputSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply); if (member.role !== 'OWNER') return forbidden(reply);
    const role = await prisma.$transaction(async tx => (await tx.communityCustomRole.count({ where: { communityId: p.data.id } })) >= MAX_CUSTOM_ROLES ? null : tx.communityCustomRole.create({ data: { communityId: p.data.id, ...roleData(body.data) } }));
    if (!role) return reply.code(409).send({ error: 'Role limit reached' });
    changed(app, p.data.id); return reply.code(201).send({ role: { id: role.id } });
  });
  app.patch('/api/community-roles/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = customRoleInputSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const role = await prisma.communityCustomRole.findUnique({ where: { id: p.data.id } }); if (!role) return missing(reply);
    const member = await findMembership(role.communityId, meOf(request)); if (!member) return missing(reply); if (member.role !== 'OWNER') return forbidden(reply);
    await prisma.communityCustomRole.update({ where: { id: role.id }, data: roleData(body.data) }); changed(app, role.communityId); return reply.send({ ok: true });
  });
  app.delete('/api/community-roles/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const role = await prisma.communityCustomRole.findUnique({ where: { id: p.data.id } }); if (!role) return missing(reply);
    const member = await findMembership(role.communityId, meOf(request)); if (!member) return missing(reply); if (member.role !== 'OWNER') return forbidden(reply);
    await prisma.communityCustomRole.delete({ where: { id: role.id } }); changed(app, role.communityId); return reply.send({ ok: true });
  });
  app.put('/api/communities/:id/members/:userId/custom-role', auth, async (request, reply) => {
    const p = memberParams.safeParse(request.params); const body = memberCustomRoleSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply); if (member.role !== 'OWNER') return forbidden(reply);
    const target = await findMembership(p.data.id, p.data.userId); if (!target) return missing(reply);
    if (body.data.customRoleId) { const role = await prisma.communityCustomRole.findUnique({ where: { id: body.data.customRoleId } }); if (!role || role.communityId !== p.data.id) return missing(reply); }
    await prisma.communityMember.update({ where: { id: target.id }, data: { customRoleId: body.data.customRoleId } }); changed(app, p.data.id); return reply.send({ ok: true });
  });
  app.post('/api/communities/:id/channels', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = channelCreateSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageChannels) return forbidden(reply);
    const room = await prisma.$transaction(async tx => {
      const count = await tx.room.count({ where: { communityId: p.data.id } });
      if (count >= MAX_CHANNELS_PER_COMMUNITY) return null;
      // Fim da lista: maior posicao + 1 (apos reordenar/apagar, count pode colidir).
      const last = await tx.room.aggregate({ where: { communityId: p.data.id }, _max: { position: true } });
      return tx.room.create({ data: { communityId: p.data.id, name: body.data.name, channelKind: body.data.kind, position: (last._max.position ?? -1) + 1, isPersistent: true, isPrivate: true } });
    });
    if (!room) return reply.code(409).send({ error: 'Channel limit reached' });
    changed(app, p.data.id);
    return reply.code(201).send({ channel: { id: room.id, name: room.name, kind: room.channelKind, position: room.position } });
  });
  app.patch('/api/channels/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = channelUpdateSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const room = await prisma.room.findUnique({ where: { id: p.data.id } }); if (!room?.communityId) return missing(reply);
    const member = await findMembership(room.communityId, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageChannels) return forbidden(reply);
    const { name, topic } = body.data;
    // Topico so existe em canal de texto; vazio limpa (null).
    if (topic !== undefined && room.channelKind !== 'TEXT') return invalid(reply);
    await prisma.room.update({ where: { id: room.id }, data: { ...(name === undefined ? {} : { name }), ...(topic === undefined ? {} : { topic: topic ? topic : null }) } }); changed(app, room.communityId); return reply.send({ ok: true });
  });
  app.delete('/api/channels/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const room = await prisma.room.findUnique({ where: { id: p.data.id } }); if (!room?.communityId) return missing(reply);
    const member = await findMembership(room.communityId, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageChannels) return forbidden(reply);
    await purgeRoom(ioOf(app), room.id, app.log); changed(app, room.communityId); return reply.send({ ok: true });
  });
  app.post('/api/communities/:id/invites', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = communityInviteCreateSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply);
    const code = randomBytes(16).toString('base64url');
    const duration = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 }[body.data.expiresIn];
    const invite = await prisma.communityInvite.create({ data: { communityId: p.data.id, createdById: meOf(request), codeHash: hash(code), expiresAt: new Date(Date.now() + duration), maxUses: body.data.maxUses } });
    return reply.code(201).send({ invite: { id: invite.id, code, expiresAt: invite.expiresAt.toISOString(), maxUses: invite.maxUses } });
  });
  app.get('/api/communities/:id/invites', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageInvites) return forbidden(reply);
    const invites = await prisma.communityInvite.findMany({ where: { communityId: p.data.id }, select: { id: true, createdById: true, expiresAt: true, maxUses: true, uses: true, revokedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    return reply.send({ invites });
  });
  app.delete('/api/invites/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const invite = await prisma.communityInvite.findUnique({ where: { id: p.data.id } }); if (!invite) return missing(reply);
    const member = await findMembership(invite.communityId, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageInvites && invite.createdById !== meOf(request)) return forbidden(reply);
    await prisma.communityInvite.update({ where: { id: invite.id }, data: { revokedAt: new Date() } }); return reply.send({ ok: true });
  });
  app.post('/api/invites/preview', auth, async (request, reply) => {
    if (inviteLimit(request, reply)) return reply; const body = communityInviteCodeSchema.safeParse(request.body); if (!body.success) return invalid(reply);
    const invite = await prisma.communityInvite.findUnique({ where: { codeHash: hash(body.data.code) }, include: { community: { include: { _count: { select: { members: true } } } } } });
    if (!invite || invite.revokedAt || invite.expiresAt <= new Date() || (invite.maxUses !== null && invite.uses >= invite.maxUses)) return missing(reply);
    const member = await findMembership(invite.communityId, meOf(request));
    return reply.send({ community: { id: invite.community.id, name: invite.community.name, memberCount: invite.community._count.members }, alreadyMember: !!member });
  });
  app.post('/api/invites/accept', auth, async (request, reply) => {
    if (inviteLimit(request, reply)) return reply; const body = communityInviteCodeSchema.safeParse(request.body); if (!body.success) return invalid(reply);
    const me = meOf(request); const codeHash = hash(body.data.code);
    try {
      const result = await prisma.$transaction(async tx => {
        const invite = await tx.communityInvite.findUnique({ where: { codeHash } });
        if (!invite || invite.revokedAt || invite.expiresAt <= new Date()) return { status: 'missing' as const };
        const existing = await tx.communityMember.findUnique({ where: { communityId_userId: { communityId: invite.communityId, userId: me } } });
        if (existing) return { status: 'ok' as const, communityId: invite.communityId, joined: false };
        if (invite.maxUses !== null && invite.uses >= invite.maxUses) return { status: 'missing' as const };
        if (await tx.communityMember.count({ where: { communityId: invite.communityId } }) >= MAX_COMMUNITY_MEMBERS || await tx.communityMember.count({ where: { userId: me } }) >= MAX_COMMUNITIES_JOINED) return { status: 'limit' as const };
        const updated = await tx.communityInvite.updateMany({ where: { codeHash, revokedAt: null, expiresAt: { gt: new Date() }, OR: [{ maxUses: null }, { uses: { lt: tx.communityInvite.fields.maxUses } }] }, data: { uses: { increment: 1 } } });
        if (updated.count !== 1) return { status: 'missing' as const };
        await tx.communityMember.create({ data: { communityId: invite.communityId, userId: me, role: 'MEMBER' } });
        return { status: 'ok' as const, communityId: invite.communityId, joined: true };
      });
      if (result.status === 'missing') return missing(reply); if (result.status === 'limit') return reply.code(409).send({ error: 'Member limit reached' });
      if (!result.joined) return reply.send({ communityId: result.communityId, welcomeChannelId: (await welcomeChannelOf(result.communityId))?.channelId ?? null });
      changed(app, result.communityId);
      // Boas-vindas: mensagem de sistema no canal escolhido; o cliente abre nele.
      const welcomeChannelId = await postWelcomeMessage(ioOf(app), result.communityId, me).catch((err: unknown) => { app.log.warn({ err }, 'welcome message failed'); return null; });
      return reply.send({ communityId: result.communityId, welcomeChannelId });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') return missing(reply);
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const invite = await prisma.communityInvite.findUnique({ where: { codeHash } });
        if (invite && await findMembership(invite.communityId, me)) return reply.send({ communityId: invite.communityId });
      }
      throw err;
    }
  });
  app.get('/api/channels/:id/messages', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const query = querySchema.safeParse(request.query); if (!p.success || !query.success) return invalid(reply);
    const room = await prisma.room.findUnique({ where: { id: p.data.id } }); if (!room?.communityId || room.channelKind !== 'TEXT') return missing(reply);
    if (!await findMembership(room.communityId, meOf(request))) return missing(reply);
    let cursorDate: Date | undefined;
    if (query.data.cursor) { const cursor = await prisma.chatMessage.findUnique({ where: { id: query.data.cursor } }); if (!cursor || cursor.roomId !== room.id) return missing(reply); cursorDate = cursor.createdAt; }
    const rows = await prisma.chatMessage.findMany({ where: { roomId: room.id, ...(cursorDate && query.data.cursor ? { OR: [{ createdAt: { lt: cursorDate } }, { createdAt: cursorDate, id: { lt: query.data.cursor } }] } : {}) }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.data.limit, include: { files: true } });
    const messages = await buildChannelMessages(room.id, rows.reverse());
    return reply.send({ messages, nextCursor: rows.length === query.data.limit ? rows[0]?.id ?? null : null });
  });
  app.post('/api/channels/:id/messages', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = channelMessageSendSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const room = await prisma.room.findUnique({ where: { id: p.data.id } }); if (!room?.communityId || room.channelKind !== 'TEXT') return missing(reply);
    const me = meOf(request); if (!await findMembership(room.communityId, me)) return missing(reply);
    if (isChatRateLimited(`user:${me}`)) return reply.code(429).header('Retry-After', '5').send({ error: 'Too many messages' });
    const user = await prisma.user.findUnique({ where: { id: me }, include: { username: true } }); if (!user) return missing(reply);
    const replyToId = body.data.replyToId;
    const replies = replyToId ? await loadReplies(room.id, [replyToId]) : null;
    const replyTo = replyToId ? replies?.get(replyToId) : undefined;
    if (replyToId && (!replyTo || !replyTo.authorName)) return invalid(reply);
    const row = await prisma.chatMessage.create({ data: { roomId: room.id, authorId: me, content: body.data.content, replyToId: replyToId ?? null } });
    const message = toChannelMessage(row, { id: user.id, name: user.name, username: user.username?.name ?? null }, { replyTo: replyTo ?? null });
    ioOf(app)?.to(communityRoom(room.communityId)).emit('channel:message', message);
    await emitCommunityActivity(ioOf(app), room.communityId, room.id, me);
    return reply.code(201).send({ message });
  });
  // Nao lidas: marcar um canal (ao abrir / ao ler mensagem nova) ou a comunidade inteira.
  app.post('/api/channels/:id/read', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const room = await prisma.room.findUnique({ where: { id: p.data.id } }); if (!room?.communityId || room.channelKind !== 'TEXT') return missing(reply);
    const me = meOf(request); if (!await findMembership(room.communityId, me)) return missing(reply);
    await markChannelsRead(me, [room.id]); return reply.send({ ok: true });
  });
  app.post('/api/communities/:id/read', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const me = meOf(request); if (!await findMembership(p.data.id, me)) return missing(reply);
    const rooms = await prisma.room.findMany({ where: { communityId: p.data.id, channelKind: 'TEXT' }, select: { id: true } });
    await markChannelsRead(me, rooms.map(r => r.id)); return reply.send({ ok: true });
  });
  app.patch('/api/channels/:id/messages/:messageId', auth, async (request, reply) => {
    const p = messageParams.safeParse(request.params); const body = channelMessageSendSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const room = await prisma.room.findUnique({ where: { id: p.data.id } }); if (!room?.communityId || room.channelKind !== 'TEXT') return missing(reply);
    const me = meOf(request); if (!await findMembership(room.communityId, me)) return missing(reply);
    const message = await prisma.chatMessage.findUnique({ where: { id: p.data.messageId } }); if (!message || message.roomId !== room.id) return missing(reply);
    if (message.authorId !== me) return forbidden(reply);
    if (message.deletedAt || Date.now() - message.createdAt.getTime() > CHAT_EDIT_WINDOW_MS) return invalid(reply);
    if (isChatRateLimited(`user:${me}`)) return reply.code(429).header('Retry-After', '5').send({ error: 'Too many messages' });
    const editedAt = new Date();
    const updated = await prisma.chatMessage.updateMany({ where: { id: message.id, deletedAt: null }, data: { prevContent: message.content, content: body.data.content, editedAt } });
    if (!updated.count) return invalid(reply);
    ioOf(app)?.to(communityRoom(room.communityId)).emit('channel:message-edit', { channelId: room.id, messageId: message.id, content: body.data.content, editedAt: editedAt.toISOString() });
    return reply.send({ ok: true });
  });
  app.delete('/api/channels/:id/messages/:messageId', auth, async (request, reply) => {
    const p = messageParams.safeParse(request.params); if (!p.success) return invalid(reply);
    const room = await prisma.room.findUnique({ where: { id: p.data.id } }); if (!room?.communityId || room.channelKind !== 'TEXT') return missing(reply);
    const me = meOf(request); const member = await findMembership(room.communityId, me); if (!member) return missing(reply);
    const message = await prisma.chatMessage.findUnique({ where: { id: p.data.messageId } }); if (!message || message.roomId !== room.id) return missing(reply);
    if (message.authorId !== me && !permissionsOf(member).manageMessages) return forbidden(reply);
    if (message.deletedAt) return reply.send({ ok: true });
    if (isChatRateLimited(`user:${me}`)) return reply.code(429).header('Retry-After', '5').send({ error: 'Too many messages' });
    const deletedAt = new Date();
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.chatMessage.updateMany({ where: { id: message.id, deletedAt: null }, data: { content: DELETED_MESSAGE_CONTENT, prevContent: null, deletedAt, pinnedAt: null, pinnedById: null } });
      if (result.count) await tx.chatMessageReaction.deleteMany({ where: { messageId: message.id } });
      if (result.count) await tx.chatFile.updateMany({ where: { messageId: message.id }, data: { deletedAt } });
      return result;
    });
    if (updated.count) ioOf(app)?.to(communityRoom(room.communityId)).emit('channel:message-delete', { channelId: room.id, messageId: message.id, deletedAt: deletedAt.toISOString() });
    return reply.send({ ok: true });
  });

}
