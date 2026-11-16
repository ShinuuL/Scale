/**
 * Fase 3 das comunidades: castigo, banimento, expulsao, hierarquia e auditoria.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Server as HttpServer } from 'node:http';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import { io as ioClient, type Socket } from 'socket.io-client';
import { createSocketServer } from '../socket/handler.js';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import {
  resetChannelReactionRateLimit, resetChatRateLimit, resetCommunityInviteRateLimit, resetCommunityModerationRateLimit,
} from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { channelMessageExtrasRoutes } from '../routes/channelMessageExtras.js';
import { communityModerationRoutes } from '../routes/communityModeration.js';
import { activeTimeout, canModerateMember, memberRank } from '../lib/communityModeration.js';

type Who = 'owner' | 'admin' | 'mod' | 'member' | 'other' | 'outsider';
const names: Who[] = ['owner', 'admin', 'mod', 'member', 'other', 'outsider'];
const stamp = Date.now().toString(36);
const none = { manageChannels: false, manageInvites: false, manageMessages: false, kickMembers: false };

describe('hierarquia de moderacao', () => {
  it('nivel: OWNER > ADMIN > cargo personalizado > MEMBER', () => {
    expect(memberRank({ role: 'OWNER', customRoleId: null })).toBe(4);
    expect(memberRank({ role: 'ADMIN', customRoleId: null })).toBe(3);
    expect(memberRank({ role: 'MEMBER', customRoleId: 'x' })).toBe(2);
    expect(memberRank({ role: 'MEMBER', customRoleId: null })).toBe(1);
  });
  it('ninguem age sobre o dono nem sobre igual ou superior', () => {
    const admin = { role: 'ADMIN' as const, customRoleId: null, customRole: null };
    expect(canModerateMember(admin, { role: 'OWNER', customRoleId: null })).toBe(false);
    expect(canModerateMember(admin, { role: 'ADMIN', customRoleId: null })).toBe(false);
    expect(canModerateMember(admin, { role: 'MEMBER', customRoleId: 'x' })).toBe(true);
    const mod = { role: 'MEMBER' as const, customRoleId: 'r', customRole: { ...none, kickMembers: true } };
    expect(canModerateMember(mod, { role: 'MEMBER', customRoleId: null })).toBe(true);
    expect(canModerateMember(mod, { role: 'MEMBER', customRoleId: 'y' })).toBe(false);
    const weak = { role: 'MEMBER' as const, customRoleId: 'r', customRole: none };
    expect(canModerateMember(weak, { role: 'MEMBER', customRoleId: null })).toBe(false);
  });
  it('castigo vencido nao vale', () => {
    expect(activeTimeout({ timeoutUntil: new Date(Date.now() - 1000) })).toBeNull();
    expect(activeTimeout({ timeoutUntil: new Date(Date.now() + 1000) })).not.toBeNull();
    expect(activeTimeout(null)).toBeNull();
  });
});

describe('moderacao de comunidade', () => {
  let app: FastifyInstance;
  let communityId = '';
  let channelId = '';
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const inject = (who: Who, method: InjectOptions['method'], url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: `token=${users[who].token}` }, ...(payload === undefined ? {} : { payload }) });
  const base = () => `/api/communities/${communityId}`;
  let port = 0;
  const sockets: Socket[] = [];
  type Ack = Record<string, unknown>;
  const ack = (socket: Socket, event: string, data: object): Promise<Ack> =>
    new Promise((resolve, reject) => socket.timeout(3000).emit(event, data, (err: Error | null, result: Ack) => err ? reject(err) : resolve(result)));
  const next = <T>(socket: Socket, event: string): Promise<T> => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Evento ${event} nao recebido`)), 3000);
    socket.once(event, (data: T) => { clearTimeout(timer); resolve(data); });
  });
  const connect = (who: Who): Promise<Socket> => new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `token=${users[who].token}` } });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.register(channelMessageExtrasRoutes);
    await app.register(communityModerationRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const server: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(server);
    const address = server.address();
    port = address && typeof address === 'object' ? address.port : 0;
    for (const who of names) {
      const email = `f3-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });

  beforeEach(async () => {
    for (const who of names) {
      resetChatRateLimit(`user:${users[who].id}`);
      resetChannelReactionRateLimit(`user:${users[who].id}`);
      resetCommunityModerationRateLimit(users[who].id);
    }
    resetCommunityInviteRateLimit('127.0.0.1');
    const created = await inject('owner', 'POST', '/api/communities', { name: 'F3' });
    communityId = (created.json() as { community: { id: string } }).community.id;
    const role = await prisma.communityCustomRole.create({ data: { communityId, name: 'Mod', color: '#123456', kickMembers: true } });
    await prisma.communityMember.createMany({ data: [
      { communityId, userId: users.admin.id, role: 'ADMIN' },
      { communityId, userId: users.mod.id, role: 'MEMBER', customRoleId: role.id },
      { communityId, userId: users.member.id, role: 'MEMBER' },
      { communityId, userId: users.other.id, role: 'MEMBER' },
    ] });
    const channel = await inject('owner', 'POST', `${base()}/channels`, { name: 'geral', kind: 'TEXT' });
    channelId = (channel.json() as { channel: { id: string } }).channel.id;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    const owned = await prisma.community.findMany({ where: { ownerId: users.owner.id }, select: { id: true } });
    for (const c of owned) await inject('owner', 'DELETE', `/api/communities/${c.id}`);
    await prisma.user.deleteMany({ where: { email: { in: names.map((who) => users[who].email) } } });
    await app.close();
  });

  it('castigo bloqueia mensagem, edicao e reacao; tirar o castigo libera', async () => {
    const sent = (await inject('member', 'POST', `/api/channels/${channelId}/messages`, { content: 'antes' })).json() as { message: { id: string } };
    const timeout = await inject('mod', 'PUT', `${base()}/members/${users.member.id}/timeout`, { duration: '1h', reason: 'flood' });
    expect(timeout.statusCode).toBe(200);
    const blocked = await inject('member', 'POST', `/api/channels/${channelId}/messages`, { content: 'oi' });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ error: 'Timed out' });
    expect((await inject('member', 'PATCH', `/api/channels/${channelId}/messages/${sent.message.id}`, { content: 'x' })).statusCode).toBe(403);
    expect((await inject('member', 'POST', `/api/channels/${channelId}/messages/${sent.message.id}/reactions`, { reaction: 'like' })).statusCode).toBe(403);
    const detail = (await inject('member', 'GET', base())).json() as { members: Array<{ userId: string; timeoutUntil: string | null }> };
    expect(detail.members.find((m) => m.userId === users.member.id)?.timeoutUntil).toBeTruthy();
    expect((await inject('mod', 'DELETE', `${base()}/members/${users.member.id}/timeout`)).statusCode).toBe(200);
    expect((await inject('member', 'POST', `/api/channels/${channelId}/messages`, { content: 'oi' })).statusCode).toBe(201);
  });

  it('castigo valida duracao e motivo (ate 300)', async () => {
    expect((await inject('owner', 'PUT', `${base()}/members/${users.member.id}/timeout`, { duration: '2h' })).statusCode).toBe(400);
    expect((await inject('owner', 'PUT', `${base()}/members/${users.member.id}/timeout`, { duration: '60s', reason: 'x'.repeat(301) })).statusCode).toBe(400);
  });

  it('hierarquia: nao age no dono, em igual ou superior, nem em si mesmo; sem permissao = 403', async () => {
    expect((await inject('admin', 'PUT', `${base()}/members/${users.owner.id}/timeout`, { duration: '60s' })).statusCode).toBe(403);
    expect((await inject('mod', 'PUT', `${base()}/bans/${users.admin.id}`, {})).statusCode).toBe(403);
    expect((await inject('member', 'POST', `${base()}/members/${users.other.id}/kick`, {})).statusCode).toBe(403);
    expect((await inject('admin', 'POST', `${base()}/members/${users.admin.id}/kick`, {})).statusCode).toBe(403);
    expect((await inject('outsider', 'POST', `${base()}/members/${users.member.id}/kick`, {})).statusCode).toBe(404);
    expect((await inject('owner', 'POST', `${base()}/members/${users.admin.id}/kick`, { reason: 'fim' })).statusCode).toBe(200);
  });

  it('ban remove, impede reentrar por convite, lista e desbane', async () => {
    const invite = (await inject('owner', 'POST', `${base()}/invites`, { expiresIn: '1h' })).json() as { invite: { code: string } };
    expect((await inject('admin', 'PUT', `${base()}/bans/${users.member.id}`, { reason: 'spam' })).statusCode).toBe(200);
    expect(await prisma.communityMember.count({ where: { communityId, userId: users.member.id } })).toBe(0);
    expect((await inject('member', 'POST', '/api/invites/accept', { code: invite.invite.code })).statusCode).toBe(403);
    expect((await inject('member', 'POST', '/api/invites/preview', { code: invite.invite.code })).statusCode).toBe(403);
    const bans = (await inject('admin', 'GET', `${base()}/bans`)).json() as { bans: Array<{ userId: string; reason: string | null; name: string }> };
    expect(bans.bans).toEqual([expect.objectContaining({ userId: users.member.id, reason: 'spam', name: 'member' })]);
    expect((await inject('other', 'GET', `${base()}/bans`)).statusCode).toBe(403);
    expect((await inject('admin', 'DELETE', `${base()}/bans/${users.member.id}`)).statusCode).toBe(200);
    expect((await inject('admin', 'DELETE', `${base()}/bans/${users.member.id}`)).statusCode).toBe(404);
    expect((await inject('member', 'POST', '/api/invites/accept', { code: invite.invite.code })).statusCode).toBe(200);
  });

  it('auditoria registra as acoes, pagina e so aparece para quem gerencia', async () => {
    await inject('owner', 'PUT', `${base()}/members/${users.member.id}/timeout`, { duration: '5m', reason: 'calma' });
    await inject('owner', 'PATCH', `${base()}/members/${users.other.id}`, { role: 'ADMIN' });
    await inject('owner', 'POST', `${base()}/members/${users.other.id}/kick`, {});
    const msg = (await inject('owner', 'POST', `/api/channels/${channelId}/messages`, { content: 'fixa' })).json() as { message: { id: string } };
    await inject('owner', 'PUT', `/api/channels/${channelId}/messages/${msg.message.id}/pin`);
    const first = (await inject('mod', 'GET', `${base()}/audit?limit=2`)).json() as { entries: Array<{ action: string; reason: string | null }>; nextCursor: string | null };
    expect(first.entries.map((e) => e.action)).toEqual(['message.pin', 'member.kick']);
    expect(first.nextCursor).toBeTruthy();
    const rest = (await inject('mod', 'GET', `${base()}/audit?cursor=${first.nextCursor}`)).json() as { entries: Array<{ action: string; reason: string | null; detail: string | null }> };
    expect(rest.entries.map((e) => e.action)).toEqual(['member.role', 'member.timeout', 'channel.create']);
    expect(rest.entries[1]).toMatchObject({ reason: 'calma', detail: '5 minutos' });
    expect((await inject('member', 'GET', `${base()}/audit`)).statusCode).toBe(403);
    expect((await inject('outsider', 'GET', `${base()}/audit`)).statusCode).toBe(404);
  });

  it('socket: castigo avisa o alvo, tira da voz e recusa entrar; ban avisa e remove', async () => {
    const voice = await prisma.room.findFirstOrThrow({ where: { communityId, channelKind: 'VOICE' } });
    const observer = await connect('owner');
    const member = await connect('member');
    expect((await ack(observer, 'community:subscribe', { communityId })).success).toBe(true);
    expect((await ack(member, 'community:subscribe', { communityId })).success).toBe(true);
    expect((await ack(member, 'join-room', { roomId: voice.id })).success).toBe(true);
    const warned = next<{ action: string; reason: string | null; until: string | null }>(member, 'community:moderation');
    const left = next<{ members: unknown[] }>(observer, 'community:voice-state');
    expect((await inject('owner', 'PUT', `${base()}/members/${users.member.id}/timeout`, { duration: '60s', reason: 'pausa' })).statusCode).toBe(200);
    expect(await warned).toMatchObject({ action: 'timeout', reason: 'pausa' });
    expect((await left).members).toEqual([]);
    expect(await ack(member, 'join-room', { roomId: voice.id })).toMatchObject({ error: 'Timed out' });
    const banned = next<{ action: string }>(member, 'community:moderation');
    const removed = next(member, 'community:removed');
    expect((await inject('owner', 'PUT', `${base()}/bans/${users.member.id}`, {})).statusCode).toBe(200);
    expect(await banned).toMatchObject({ action: 'ban' });
    await removed;
  });
});
