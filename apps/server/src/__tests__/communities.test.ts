import { createHash } from 'node:crypto';
import { MAX_CHANNELS_PER_COMMUNITY, MAX_COMMUNITIES_OWNED, MAX_COMMUNITY_MEMBERS, CHAT_MESSAGE_MAX } from '@scale/shared';
import type { Server as HttpServer } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetChatRateLimit, resetCommunityInviteRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { roomRoutes } from '../routes/rooms.js';
import { messagesRoutes } from '../routes/messages.js';
import { filesRoutes } from '../routes/files.js';
import { turnRoutes } from '../routes/turn.js';
import { createSocketServer } from '../socket/handler.js';

type Who = 'owner' | 'admin' | 'member' | 'outsider';
type Ack = Record<string, unknown>;
type Detail = { channels: Array<{ id: string; name: string; kind: string }> };
const stamp = Date.now().toString(36);
const names: Who[] = ['owner', 'admin', 'member', 'outsider'];

describe('comunidades', () => {
  let app: FastifyInstance;
  let port: number;
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const sockets: Socket[] = [];
  const communityIds: string[] = [];
  const inject = (who: Who | null, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
    const options: InjectOptions = { method, url, headers: who ? { cookie: `token=${users[who].token}` } : {} };
    if (payload !== undefined) options.payload = payload;
    return app.inject(options);
  };
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
  async function create() {
    const response = await inject('owner', 'POST', '/api/communities', { name: 'Comunidade teste' });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { community: { id: string } };
    communityIds.push(body.community.id);
    return body.community.id;
  }
  async function invite(id: string, who: Who = 'owner', maxUses?: number) {
    const response = await inject(who, 'POST', `/api/communities/${id}/invites`, { expiresIn: '7d', ...(maxUses === undefined ? {} : { maxUses }) });
    expect(response.statusCode).toBe(201);
    return (response.json() as { invite: { id: string; code: string } }).invite;
  }
  async function join(id: string, who: Who) {
    const entry = await invite(id);
    expect((await inject(who, 'POST', '/api/invites/accept', { code: entry.code })).statusCode).toBe(200);
  }
  async function detail(id: string): Promise<Detail> {
    return (await inject('owner', 'GET', `/api/communities/${id}`)).json() as Detail;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.register(roomRoutes);
    await app.register(messagesRoutes);
    await app.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
    await app.register(filesRoutes);
    await app.register(turnRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const server: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(server);
    const address = server.address();
    port = address && typeof address === 'object' ? address.port : 0;
    for (const who of names) {
      const email = `community-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });
  beforeEach(() => {
    resetCommunityInviteRateLimit('127.0.0.1');
    resetCommunityInviteRateLimit('203.0.113.10');
    for (const who of names) resetChatRateLimit(`user:${users[who].id}`);
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    await prisma.community.deleteMany({ where: { id: { in: communityIds.splice(0) } } });
  });
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await prisma.community.deleteMany({ where: { id: { in: communityIds } } });
    await prisma.user.deleteMany({ where: { email: { in: names.map((who) => users[who].email) } } });
    await app.close();
  });

  it('cria canais padrao e oculta comunidade de nao membro', async () => {
    const id = await create();
    const result = await detail(id);
    expect(result.channels.map(({ name, kind }) => ({ name, kind }))).toEqual(expect.arrayContaining([
      { name: 'geral', kind: 'TEXT' }, { name: 'Sala de voz', kind: 'VOICE' },
    ]));
    expect((await inject('outsider', 'GET', `/api/communities/${id}`)).statusCode).toBe(404);
    expect((await inject(null, 'GET', '/api/communities')).statusCode).toBe(401);
  });

  it('nao revela codigo armazenado ou listado e rejeita convite revogado, expirado e esgotado', async () => {
    const id = await create();
    const revoked = await invite(id);
    const stored = await prisma.communityInvite.findUniqueOrThrow({ where: { id: revoked.id } });
    expect(stored.codeHash).toBe(createHash('sha256').update(revoked.code).digest('hex'));
    expect(JSON.stringify(stored)).not.toContain(revoked.code);
    const listed = await inject('owner', 'GET', `/api/communities/${id}/invites`);
    expect(listed.body).not.toContain(revoked.code);
    expect((await inject('owner', 'DELETE', `/api/invites/${revoked.id}`)).statusCode).toBeLessThan(300);
    expect((await inject('member', 'POST', '/api/invites/accept', { code: revoked.code })).statusCode).toBeGreaterThanOrEqual(400);
    const expired = await invite(id);
    await prisma.communityInvite.update({ where: { id: expired.id }, data: { expiresAt: new Date(0) } });
    expect((await inject('member', 'POST', '/api/invites/preview', { code: expired.code })).statusCode).toBeGreaterThanOrEqual(400);
    expect((await inject('member', 'POST', '/api/invites/accept', { code: expired.code })).statusCode).toBeGreaterThanOrEqual(400);
    const limited = await invite(id, 'owner', 1);
    expect((await inject('member', 'POST', '/api/invites/accept', { code: limited.code })).statusCode).toBe(200);
    expect((await inject('outsider', 'POST', '/api/invites/accept', { code: limited.code })).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('aceite concorrente respeita maxUses e membro existente nao consome uso', async () => {
    const id = await create();
    const entry = await invite(id, 'owner', 1);
    const responses = await Promise.all(['member', 'outsider'].map((who) => inject(who as Who, 'POST', '/api/invites/accept', { code: entry.code })));
    expect(responses.filter((response) => response.statusCode === 200)).toHaveLength(1);
    expect((await prisma.communityInvite.findUniqueOrThrow({ where: { id: entry.id } })).uses).toBe(1);
    const existing = await invite(id);
    expect((await inject('owner', 'POST', '/api/invites/accept', { code: existing.code })).statusCode).toBe(200);
    expect((await prisma.communityInvite.findUniqueOrThrow({ where: { id: existing.id } })).uses).toBe(0);
  });

  it('aplica permissoes dos cargos', async () => {
    const id = await create();
    await join(id, 'admin');
    await join(id, 'member');
    expect((await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.admin.id}`, { role: 'ADMIN' })).statusCode).toBe(200);
    expect((await inject('member', 'POST', `/api/communities/${id}/channels`, { name: 'novo', kind: 'TEXT' })).statusCode).toBe(403);
    expect((await inject('admin', 'POST', `/api/communities/${id}/channels`, { name: 'novo', kind: 'TEXT' })).statusCode).toBe(201);
    expect((await inject('member', 'GET', `/api/communities/${id}/invites`)).statusCode).toBe(403);
    expect((await inject('admin', 'GET', `/api/communities/${id}/invites`)).statusCode).toBe(200);
    expect((await inject('admin', 'PATCH', `/api/communities/${id}`, { name: 'outro' })).statusCode).toBe(403);
    expect((await inject('admin', 'PATCH', `/api/communities/${id}/members/${users.member.id}`, { role: 'ADMIN' })).statusCode).toBe(403);
    expect((await inject('member', 'DELETE', `/api/communities/${id}/members/${users.admin.id}`)).statusCode).toBe(403);
    expect((await inject('admin', 'DELETE', `/api/communities/${id}/members/${users.owner.id}`)).statusCode).toBe(403);
    expect((await inject('owner', 'POST', `/api/communities/${id}/leave`)).statusCode).toBeGreaterThanOrEqual(400);
    const memberInvite = await invite(id, 'member');
    const ownerInvite = await invite(id);
    expect((await inject('member', 'DELETE', `/api/invites/${ownerInvite.id}`)).statusCode).toBe(403);
    expect((await inject('member', 'DELETE', `/api/invites/${memberInvite.id}`)).statusCode).toBe(200);
    expect((await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.member.id}`, { role: 'ADMIN' })).statusCode).toBe(200);
    expect((await inject('admin', 'DELETE', `/api/communities/${id}/members/${users.member.id}`)).statusCode).toBe(403);
    expect((await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.member.id}`, { role: 'MEMBER' })).statusCode).toBe(200);
    expect((await inject('admin', 'DELETE', `/api/communities/${id}/members/${users.admin.id}`)).statusCode).toBe(403);
    expect((await inject('owner', 'DELETE', `/api/communities/${id}/members/${users.admin.id}`)).statusCode).toBe(200);
  });

  it('recusa voz em TEXT, publica entrada e saida e revoga acesso ao expulso', async () => {
    const id = await create();
    await join(id, 'member');
    const channels = (await detail(id)).channels;
    const text = channels.find((channel) => channel.kind === 'TEXT');
    const voice = channels.find((channel) => channel.kind === 'VOICE');
    expect(text).toBeDefined();
    expect(voice).toBeDefined();
    if (!text || !voice) return;
    const observer = await connect('owner');
    const member = await connect('member');
    expect((await ack(observer, 'community:subscribe', { communityId: id })).success).toBe(true);
    expect((await ack(member, 'community:subscribe', { communityId: id })).success).toBe(true);
    expect((await ack(member, 'join-room', { roomId: text.id })).success).not.toBe(true);
    const entered = next<{ channelId: string; members: Array<{ userId: string }> }>(observer, 'community:voice-state');
    const outsider = await connect('outsider');
    expect((await ack(outsider, 'join-room', { roomId: voice.id })).success).not.toBe(true);
    const joined = await ack(member, 'join-room', { roomId: voice.id });
    expect(joined.success).toBe(true);
    expect((await entered).members.some((user) => user.userId === users.member.id)).toBe(true);
    expect((await ack(observer, 'community:subscribe', { communityId: id })).voiceStates).toEqual(expect.arrayContaining([expect.objectContaining({ channelId: voice.id, members: expect.arrayContaining([expect.objectContaining({ userId: users.member.id })]) })]));
    const fileMessage = await prisma.chatMessage.create({ data: { roomId: voice.id, authorId: users.owner.id, content: 'arquivo' } });
    const file = await prisma.chatFile.create({ data: { roomId: voice.id, messageId: fileMessage.id, filename: 'teste.txt', mime: 'text/plain', size: 1, path: `uploads/${voice.id}/teste.txt` } });
    expect((await inject('member', 'GET', `/api/turn/credentials?roomId=${voice.id}`)).statusCode).toBe(200);
    const removed = next(observer, 'community:voice-state');
    const notice = next(member, 'community:removed');
    expect((await inject('owner', 'DELETE', `/api/communities/${id}/members/${users.member.id}`)).statusCode).toBeLessThan(300);
    expect(await removed).toMatchObject({ channelId: voice.id, members: [] });
    await notice;
    expect((await ack(member, 'join-room', { roomId: voice.id })).success).not.toBe(true);
    expect((await ack(member, 'community:subscribe', { communityId: id })).success).not.toBe(true);
    const ticket = joined.ticket;
    expect(typeof ticket).toBe('string');
    const history = await app.inject({ method: 'GET', url: `/api/rooms/${voice.id}/messages`, headers: { cookie: `token=${users.member.token}`, 'x-room-ticket': String(ticket) } });
    expect(history.statusCode).toBe(403);
    const headers = { cookie: `token=${users.member.token}`, 'x-room-ticket': String(ticket) };
    expect((await app.inject({ method: 'POST', url: `/api/rooms/${voice.id}/files`, headers })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: `/api/files/${file.id}`, headers })).statusCode).toBe(403);
    expect((await inject('member', 'GET', `/api/turn/credentials?roomId=${voice.id}`)).statusCode).toBe(403);
  });

  it('publica estado de voz na saida e desconexao', async () => {
    const id = await create();
    await join(id, 'member');
    const voice = (await detail(id)).channels.find((channel) => channel.kind === 'VOICE');
    expect(voice).toBeDefined();
    if (!voice) return;
    const observer = await connect('owner');
    const member = await connect('member');
    await ack(observer, 'community:subscribe', { communityId: id });
    const entered = next(observer, 'community:voice-state');
    expect((await ack(member, 'join-room', { roomId: voice.id })).success).toBe(true);
    await entered;
    const left = next(observer, 'community:voice-state');
    await ack(member, 'leave-room', { roomId: voice.id });
    expect(await left).toMatchObject({ channelId: voice.id, members: [] });
    const reentered = next(observer, 'community:voice-state');
    expect((await ack(member, 'join-room', { roomId: voice.id })).success).toBe(true);
    await reentered;
    const disconnected = next(observer, 'community:voice-state');
    member.disconnect();
    expect(await disconnected).toMatchObject({ channelId: voice.id, members: [] });
  });

  it('presenca: estado inicial no subscribe e transicoes online/offline por comunidade', async () => {
    const id = await create();
    await join(id, 'member');
    const observer = await connect('owner');
    const first = await ack(observer, 'community:subscribe', { communityId: id });
    expect(first.onlineUserIds).toEqual(expect.arrayContaining([users.owner.id]));
    expect(first.onlineUserIds).not.toContain(users.member.id);
    const online = next<{ communityId: string; userId: string; online: boolean }>(observer, 'community:presence');
    const tab1 = await connect('member');
    expect(await online).toEqual({ communityId: id, userId: users.member.id, online: true });
    const tab2 = await connect('member');
    expect((await ack(observer, 'community:subscribe', { communityId: id })).onlineUserIds).toContain(users.member.id);
    let sawOffline = false;
    const watch = (data: { online: boolean }) => { if (!data.online) sawOffline = true; };
    observer.on('community:presence', watch);
    tab1.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(sawOffline).toBe(false);
    observer.off('community:presence', watch);
    const offline = next<{ online: boolean; userId: string }>(observer, 'community:presence');
    tab2.disconnect();
    expect(await offline).toMatchObject({ userId: users.member.id, online: false });
  });

  it('indicadores de voz: mudo, deafen, tela e falando chegam a comunidade', async () => {
    const id = await create();
    await join(id, 'member');
    const voice = (await detail(id)).channels.find((channel) => channel.kind === 'VOICE');
    if (!voice) throw new Error('sem canal de voz');
    const observer = await connect('owner');
    const member = await connect('member');
    await ack(observer, 'community:subscribe', { communityId: id });
    const entered = next<{ members: Array<Record<string, unknown>> }>(observer, 'community:voice-state');
    expect((await ack(member, 'join-room', { roomId: voice.id })).success).toBe(true);
    expect((await entered).members[0]).toMatchObject({ muted: false, deafened: false, screenSharing: false });
    const muted = next<{ members: Array<Record<string, unknown>> }>(observer, 'community:voice-state');
    await ack(member, 'peer:audio-state', { roomId: voice.id, muted: true });
    expect((await muted).members[0]).toMatchObject({ muted: true });
    const deaf = next<{ members: Array<Record<string, unknown>> }>(observer, 'community:voice-state');
    expect((await ack(member, 'peer:voice-flags', { roomId: voice.id, deafened: true })).success).toBe(true);
    expect((await deaf).members[0]).toMatchObject({ deafened: true });
    const speaking = next(observer, 'community:voice-speaking');
    await ack(member, 'peer:voice-flags', { roomId: voice.id, speaking: true });
    // Mudo nunca aparece falando.
    expect(await speaking).toEqual({ channelId: voice.id, userId: users.member.id, speaking: false });
    expect((await ack(member, 'peer:voice-flags', { roomId: voice.id, bogus: true })).error).toBeDefined();
    expect((await ack(observer, 'peer:voice-flags', { roomId: voice.id, deafened: true })).error).toBe('Not in room');
    const sub = await ack(observer, 'community:subscribe', { communityId: id });
    expect(sub.voiceStates).toEqual([expect.objectContaining({ members: [expect.objectContaining({ muted: true, deafened: true })] })]);
  });

  it('protege chat REST e entrega mensagens e paginacao aos membros', async () => {
    const id = await create();
    await join(id, 'member');
    const channels = (await detail(id)).channels;
    const text = channels.find((channel) => channel.kind === 'TEXT')!;
    const voice = channels.find((channel) => channel.kind === 'VOICE')!;
    const observer = await connect('owner');
    expect((await ack(observer, 'community:subscribe', { communityId: id })).success).toBe(true);
    const event = next<{ content: string; channelId: string }>(observer, 'channel:message');
    const sent = await inject('member', 'POST', `/api/channels/${text.id}/messages`, { content: '  ola comunidade  ' });
    expect(sent.statusCode).toBe(201);
    const message = sent.json().message as { id: string; content: string };
    expect(message.content).toBe('ola comunidade');
    expect(await event).toMatchObject({ channelId: text.id, content: 'ola comunidade' });
    expect((await inject('member', 'GET', `/api/channels/${text.id}/messages?limit=1`)).json()).toMatchObject({ messages: [{ id: message.id }], nextCursor: message.id });
    expect((await inject('outsider', 'GET', `/api/channels/${text.id}/messages`)).statusCode).toBe(404);
    expect((await inject('outsider', 'POST', `/api/channels/${text.id}/messages`, { content: 'nao' })).statusCode).toBe(404);
    expect((await inject('member', 'GET', `/api/channels/${voice.id}/messages`)).statusCode).toBe(404);
    expect((await inject('member', 'POST', `/api/channels/${text.id}/messages`, { content: '   ' })).statusCode).toBe(400);
    expect((await inject('member', 'POST', `/api/channels/${text.id}/messages`, { content: 'x'.repeat(CHAT_MESSAGE_MAX + 1) })).statusCode).toBe(400);
    const otherMessage = await prisma.chatMessage.create({ data: { roomId: voice.id, authorId: users.owner.id, content: 'cursor externo' } });
    expect((await inject('member', 'GET', `/api/channels/${text.id}/messages?cursor=${otherMessage.id}`)).statusCode).toBe(404);
    expect((await inject('member', 'GET', `/api/channels/${text.id}/messages?limit=51`)).statusCode).toBe(400);
    const tieDate = new Date('2020-01-01T00:00:00.000Z');
    const tied = await Promise.all(['empate 1', 'empate 2'].map((content) => prisma.chatMessage.create({ data: { roomId: text.id, authorId: users.member.id, content, createdAt: tieDate } })));
    const firstPage = await inject('member', 'GET', `/api/channels/${text.id}/messages?cursor=${message.id}&limit=1`);
    const first = firstPage.json() as { messages: Array<{ id: string }>; nextCursor: string };
    const secondPage = await inject('member', 'GET', `/api/channels/${text.id}/messages?cursor=${first.nextCursor}&limit=1`);
    const second = secondPage.json() as { messages: Array<{ id: string }> };
    expect([first.messages[0]?.id, second.messages[0]?.id].sort()).toEqual(tied.map((item) => item.id).sort());
    expect((await inject('owner', 'DELETE', `/api/communities/${id}/members/${users.member.id}`)).statusCode).toBe(200);
    expect((await inject('member', 'GET', `/api/channels/${text.id}/messages`)).statusCode).toBe(404);
    expect((await inject('member', 'POST', `/api/channels/${text.id}/messages`, { content: 'expulso' })).statusCode).toBe(404);
  });

  it('aplica limites de canais e limita tentativas de convite sem revelar codigos', async () => {
    const id = await create();
    const initial = (await detail(id)).channels.length;
    await prisma.room.createMany({ data: Array.from({ length: MAX_CHANNELS_PER_COMMUNITY - initial }, (_, index) => ({ communityId: id, name: `canal-${index}`, channelKind: 'TEXT' as const, position: index + initial, isPersistent: true, isPrivate: true })) });
    expect((await inject('owner', 'POST', `/api/communities/${id}/channels`, { name: 'excedente', kind: 'TEXT' })).statusCode).toBe(409);
    const invalidCode = 'A'.repeat(22);
    const attemptInvite = (endpoint: string) => app.inject({ method: 'POST', url: `/api/invites/${endpoint}`, remoteAddress: '203.0.113.10', headers: { cookie: `token=${users.outsider.token}` }, payload: { code: invalidCode } });
    for (let attempt = 0; attempt < 30; attempt++) {
      const endpoint = attempt % 2 === 0 ? 'preview' : 'accept';
      expect((await attemptInvite(endpoint)).statusCode).toBe(404);
    }
    const limited = await attemptInvite('preview');
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('restringe edicao e exclusao de mensagens por autoria e cargo', async () => {
    const id = await create();
    await join(id, 'admin');
    await join(id, 'member');
    expect((await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.admin.id}`, { role: 'ADMIN' })).statusCode).toBe(200);
    const channel = (await detail(id)).channels.find((item) => item.kind === 'TEXT')!;
    const sent = await inject('member', 'POST', `/api/channels/${channel.id}/messages`, { content: 'original' });
    const messageId = (sent.json() as { message: { id: string } }).message.id;
    const other = await prisma.community.create({ data: { name: 'Outra', ownerId: users.outsider.id, members: { create: { userId: users.outsider.id, role: 'OWNER' } }, rooms: { create: { name: 'outro', channelKind: 'TEXT', isPersistent: true, isPrivate: true } } }, include: { rooms: true } });
    communityIds.push(other.id);
    const wrongUrl = `/api/channels/${other.rooms[0]!.id}/messages/${messageId}`;
    expect((await inject('outsider', 'PATCH', wrongUrl, { content: 'fora' })).statusCode).toBe(404);
    expect((await inject('outsider', 'DELETE', wrongUrl)).statusCode).toBe(404);
    expect((await inject('member', 'PATCH', `/api/channels/${other.rooms[0]!.id}`, { name: 'fora' })).statusCode).toBe(404);
    expect((await inject('member', 'DELETE', `/api/channels/${other.rooms[0]!.id}`)).statusCode).toBe(404);
    const url = `/api/channels/${channel.id}/messages/${messageId}`;
    const observer = await connect('owner');
    await ack(observer, 'community:subscribe', { communityId: id });
    expect((await inject('outsider', 'PATCH', url, { content: 'fora' })).statusCode).toBe(404);
    expect((await inject('admin', 'PATCH', url, { content: 'outro autor' })).statusCode).toBe(403);
    const edited = next(observer, 'channel:message-edit');
    expect((await inject('member', 'PATCH', url, { content: 'editada' })).statusCode).toBe(200);
    expect(await edited).toMatchObject({ channelId: channel.id, messageId, content: 'editada', editedAt: expect.any(String) });
    expect((await inject('member', 'GET', `/api/channels/${channel.id}/messages`)).json()).toMatchObject({ messages: [{ id: messageId, content: 'editada', editedAt: expect.any(String) }] });
    expect((await inject('outsider', 'DELETE', url)).statusCode).toBe(404);
    const deleted = next(observer, 'channel:message-delete');
    expect((await inject('admin', 'DELETE', url)).statusCode).toBe(200);
    expect(await deleted).toMatchObject({ channelId: channel.id, messageId, deletedAt: expect.any(String) });
    expect((await inject('admin', 'DELETE', url)).statusCode).toBe(200);
    expect((await inject('member', 'PATCH', url, { content: 'apagada' })).statusCode).toBe(400);
    const second = await inject('admin', 'POST', `/api/channels/${channel.id}/messages`, { content: 'do admin' });
    const secondUrl = `/api/channels/${channel.id}/messages/${(second.json() as { message: { id: string } }).message.id}`;
    expect((await inject('member', 'DELETE', secondUrl)).statusCode).toBe(403);
    expect((await inject('admin', 'DELETE', secondUrl)).statusCode).toBe(200);
    const old = await prisma.chatMessage.create({ data: { roomId: channel.id, authorId: users.member.id, content: 'antiga', createdAt: new Date(Date.now() - 16 * 60_000) } });
    expect((await inject('member', 'PATCH', `/api/channels/${channel.id}/messages/${old.id}`, { content: 'tarde' })).statusCode).toBe(400);
    expect((await inject('member', 'GET', `/api/channels/${channel.id}/messages`)).json()).toMatchObject({ messages: expect.arrayContaining([expect.objectContaining({ id: messageId, deletedAt: expect.any(String) })]) });
  });

  it('membro envia imagem no canal de texto; fora da comunidade e nao-imagem sao recusados', async () => {
    const id = await create();
    await join(id, 'member');
    const text = (await detail(id)).channels.find((channel) => channel.kind === 'TEXT')!;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
    const upload = (who: Who, filename: string, type: string, content: Buffer) => {
      const boundary = `----scale${Math.random().toString(16).slice(2)}`;
      const crlf = '\r\n';
      const head = [`--${boundary}`, 'Content-Disposition: form-data; name="content"', '', 'olha', `--${boundary}`, `Content-Disposition: form-data; name="file"; filename="${filename}"`, `Content-Type: ${type}`, '', ''].join(crlf);
      const payload = Buffer.concat([Buffer.from(head), content, Buffer.from(`${crlf}--${boundary}--${crlf}`)]);
      return app.inject({ method: 'POST', url: `/api/rooms/${text.id}/files`, payload, headers: { cookie: `token=${users[who].token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    };
    const observer = await connect('owner');
    await ack(observer, 'community:subscribe', { communityId: id });
    const event = next<{ channelId: string; files: Array<{ id: string }> }>(observer, 'channel:message');
    const sent = await upload('member', 'foto.png', 'image/png', png);
    expect(sent.statusCode).toBe(201);
    const message = sent.json().message as { id: string; content: string; files: Array<{ id: string; mime: string }> };
    expect(message).toMatchObject({ content: 'olha', files: [{ mime: 'image/png' }] });
    expect(await event).toMatchObject({ channelId: text.id, files: [{ id: message.files[0]!.id }] });
    expect((await inject('member', 'GET', `/api/channels/${text.id}/messages`)).json()).toMatchObject({ messages: [{ id: message.id, files: [{ id: message.files[0]!.id }] }] });
    expect((await inject('owner', 'GET', `/api/files/${message.files[0]!.id}`)).statusCode).toBe(200);
    expect((await inject('outsider', 'GET', `/api/files/${message.files[0]!.id}`)).statusCode).toBe(403);
    expect((await upload('outsider', 'foto.png', 'image/png', png)).statusCode).toBe(403);
    expect((await upload('member', 'nota.txt', 'text/plain', Buffer.from('oi'))).statusCode).toBe(400);
  });

  it('cargo personalizado: so o dono gerencia; permissao soma ao MEMBER', async () => {
    const id = await create();
    await join(id, 'member');
    await join(id, 'admin');
    const input = { name: 'Moderador', color: '#22AA88', permissions: { manageChannels: true, manageInvites: false, manageMessages: true, kickMembers: false } };
    expect((await inject('member', 'POST', `/api/communities/${id}/roles`, input)).statusCode).toBe(403);
    expect((await inject('owner', 'POST', `/api/communities/${id}/roles`, { ...input, color: 'verde' })).statusCode).toBe(400);
    const created = await inject('owner', 'POST', `/api/communities/${id}/roles`, input);
    expect(created.statusCode).toBe(201);
    const roleId = (created.json() as { role: { id: string } }).role.id;
    // Sem cargo: MEMBER nao cria canal.
    expect((await inject('member', 'POST', `/api/communities/${id}/channels`, { name: 'antes', kind: 'TEXT' })).statusCode).toBe(403);
    const assign = (who: Who, customRoleId: string | null) => app.inject({ method: 'PUT', url: `/api/communities/${id}/members/${users.member.id}/custom-role`, headers: { cookie: `token=${users[who].token}` }, payload: { customRoleId } });
    expect((await assign('member', roleId)).statusCode).toBe(403);
    expect((await assign('owner', '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await assign('owner', roleId)).statusCode).toBe(200);
    const asMember = (await inject('member', 'GET', `/api/communities/${id}`)).json() as { myPermissions: Record<string, boolean>; roles: Array<{ id: string; color: string }>; members: Array<{ userId: string; customRoleId: string | null }> };
    expect(asMember.myPermissions).toEqual({ manageChannels: true, manageInvites: false, manageMessages: true, kickMembers: false });
    expect(asMember.roles).toEqual([expect.objectContaining({ id: roleId, color: '#22aa88' })]);
    expect(asMember.members.find((m) => m.userId === users.member.id)?.customRoleId).toBe(roleId);
    expect((await inject('member', 'POST', `/api/communities/${id}/channels`, { name: 'com-cargo', kind: 'TEXT' })).statusCode).toBe(201);
    expect((await inject('member', 'GET', `/api/communities/${id}/invites`)).statusCode).toBe(403);
    expect((await inject('member', 'DELETE', `/api/communities/${id}/members/${users.admin.id}`)).statusCode).toBe(403);
    const text = (await detail(id)).channels.find((channel) => channel.kind === 'TEXT')!;
    const adminMsg = (await inject('admin', 'POST', `/api/channels/${text.id}/messages`, { content: 'do admin' })).json() as { message: { id: string } };
    expect((await inject('member', 'DELETE', `/api/channels/${text.id}/messages/${adminMsg.message.id}`)).statusCode).toBe(200);
    expect((await inject('owner', 'PATCH', `/api/community-roles/${roleId}`, { ...input, permissions: { ...input.permissions, manageChannels: false } })).statusCode).toBe(200);
    expect((await inject('member', 'POST', `/api/communities/${id}/channels`, { name: 'depois', kind: 'TEXT' })).statusCode).toBe(403);
    expect((await inject('member', 'DELETE', `/api/community-roles/${roleId}`)).statusCode).toBe(403);
    expect((await inject('owner', 'DELETE', `/api/community-roles/${roleId}`)).statusCode).toBe(200);
    const after = (await inject('member', 'GET', `/api/communities/${id}`)).json() as { roles: unknown[]; members: Array<{ userId: string; customRoleId: string | null }> };
    expect(after.roles).toEqual([]);
    expect(after.members.find((m) => m.userId === users.member.id)?.customRoleId).toBeNull();
  });

  it('recusa criar comunidade acima do limite e aceitar convite de comunidade cheia', async () => {
    const id = await create();
    const owned = await prisma.community.count({ where: { ownerId: users.owner.id } });
    const extra = await Promise.all(Array.from({ length: Math.max(0, MAX_COMMUNITIES_OWNED - owned) }, () =>
      prisma.community.create({ data: { name: 'Limite', ownerId: users.owner.id } })));
    communityIds.push(...extra.map((community) => community.id));
    expect((await inject('owner', 'POST', '/api/communities', { name: 'Excedente' })).statusCode).toBe(409);
    const entry = await invite(id);
    const prefix = `community-fill-${stamp}-`;
    const fillers = Array.from({ length: MAX_COMMUNITY_MEMBERS - 1 }, (_, index) => ({ id: `${prefix}${index}`, email: `${prefix}${index}@exemplo.com`, name: 'membro', passwordHash: 'x' }));
    try {
      await prisma.user.createMany({ data: fillers });
      await prisma.communityMember.createMany({ data: fillers.map((user) => ({ communityId: id, userId: user.id, role: 'MEMBER' as const })) });
      expect((await inject('outsider', 'POST', '/api/invites/accept', { code: entry.code })).statusCode).toBe(409);
      expect((await prisma.communityInvite.findUniqueOrThrow({ where: { id: entry.id } })).uses).toBe(0);
    } finally {
      await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
      await prisma.community.deleteMany({ where: { id: { in: extra.map((community) => community.id) } } });
    }
  });

  describe('contratos individuais de comunidade', () => {
    let id: string;
    let textId: string;
    let voiceId: string;
    beforeEach(async () => {
      id = await create();
      await join(id, 'admin');
      await join(id, 'member');
      await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.admin.id}`, { role: 'ADMIN' });
      const channels = (await detail(id)).channels;
      textId = channels.find((channel) => channel.kind === 'TEXT')!.id;
      voiceId = channels.find((channel) => channel.kind === 'VOICE')!.id;
    });
    it.each(['GET', 'POST'] as const)('chat REST nega %s a nao membro', async (method) => {
      expect((await inject('outsider', method, `/api/channels/${textId}/messages`, method === 'POST' ? { content: 'oi' } : undefined)).statusCode).toBe(404);
    });
    it.each([['vazio', '   '], ['longo', 'x'.repeat(CHAT_MESSAGE_MAX + 1)]])('chat REST rejeita conteudo %s', async (_label, content) => {
      expect((await inject('member', 'POST', `/api/channels/${textId}/messages`, { content })).statusCode).toBe(400);
    });
    it('rejeita cursor de outro canal', async () => {
      const message = await prisma.chatMessage.create({ data: { roomId: voiceId, authorId: users.owner.id, content: 'outro' } });
      expect((await inject('member', 'GET', `/api/channels/${textId}/messages?cursor=${message.id}`)).statusCode).toBe(404);
    });
    it('retorna nextCursor na pagina cheia', async () => {
      const message = await prisma.chatMessage.create({ data: { roomId: textId, authorId: users.owner.id, content: 'oi' } });
      expect((await inject('member', 'GET', `/api/channels/${textId}/messages?limit=1`)).json()).toMatchObject({ nextCursor: message.id });
    });
    it('pagina mensagens com createdAt igual sem perder nenhuma', async () => {
      const createdAt = new Date('2020-01-01T00:00:00Z');
      const messages = await Promise.all(['a', 'b'].map((content) => prisma.chatMessage.create({ data: { roomId: textId, authorId: users.owner.id, content, createdAt } })));
      const first = (await inject('member', 'GET', `/api/channels/${textId}/messages?limit=1`)).json() as { messages: Array<{ id: string }>; nextCursor: string };
      const second = (await inject('member', 'GET', `/api/channels/${textId}/messages?limit=1&cursor=${first.nextCursor}`)).json() as { messages: Array<{ id: string }> };
      expect([first.messages[0]?.id, second.messages[0]?.id].sort()).toEqual(messages.map((message) => message.id).sort());
    });
    it.each([
      ['autor edita', 'member', 'member', 'PATCH', 200], ['admin nao edita mensagem alheia', 'admin', 'member', 'PATCH', 403],
      ['membro nao edita mensagem alheia', 'member', 'admin', 'PATCH', 403],
      ['autor apaga', 'member', 'member', 'DELETE', 200], ['admin apaga mensagem alheia', 'admin', 'member', 'DELETE', 200],
      ['membro nao apaga mensagem alheia', 'member', 'admin', 'DELETE', 403],
    ] as const)('%s', async (_label, actor, author, method, status) => {
      const message = await prisma.chatMessage.create({ data: { roomId: textId, authorId: users[author].id, content: 'original' } });
      expect((await inject(actor, method, `/api/channels/${textId}/messages/${message.id}`, method === 'PATCH' ? { content: 'editada' } : undefined)).statusCode).toBe(status);
    });
    it('recusa edicao fora da janela', async () => {
      const message = await prisma.chatMessage.create({ data: { roomId: textId, authorId: users.member.id, content: 'antiga', createdAt: new Date(Date.now() - 16 * 60_000) } });
      expect((await inject('member', 'PATCH', `/api/channels/${textId}/messages/${message.id}`, { content: 'tarde' })).statusCode).toBe(400);
    });
    it.each(['PATCH', 'DELETE'] as const)('emite evento de %s com data ISO', async (method) => {
      const message = await prisma.chatMessage.create({ data: { roomId: textId, authorId: users.member.id, content: 'original' } });
      const observer = await connect('owner');
      await ack(observer, 'community:subscribe', { communityId: id });
      const event = next(observer, method === 'PATCH' ? 'channel:message-edit' : 'channel:message-delete');
      expect((await inject('member', method, `/api/channels/${textId}/messages/${message.id}`, method === 'PATCH' ? { content: 'alterada' } : undefined)).statusCode).toBe(200);
      expect(await event).toMatchObject({ channelId: textId, messageId: message.id, ...(method === 'PATCH' ? { editedAt: expect.any(String), content: 'alterada' } : { deletedAt: expect.any(String) }) });
    });
    it('OWNER expulsa ADMIN', async () => {
      expect((await inject('owner', 'DELETE', `/api/communities/${id}/members/${users.admin.id}`)).statusCode).toBe(200);
    });
    it('ADMIN nao expulsa outro ADMIN', async () => {
      await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.member.id}`, { role: 'ADMIN' });
      expect((await inject('admin', 'DELETE', `/api/communities/${id}/members/${users.member.id}`)).statusCode).toBe(403);
    });
    it('OWNER rebaixa ADMIN', async () => {
      expect((await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.admin.id}`, { role: 'MEMBER' })).statusCode).toBe(200);
      expect((await prisma.communityMember.findUniqueOrThrow({ where: { communityId_userId: { communityId: id, userId: users.admin.id } } })).role).toBe('MEMBER');
    });
    it('MEMBER cria convite', async () => { await invite(id, 'member'); });
    it('MEMBER nao revoga convite alheio', async () => {
      const entry = await invite(id);
      expect((await inject('member', 'DELETE', `/api/invites/${entry.id}`)).statusCode).toBe(403);
    });
    it.each(['PATCH', 'DELETE'] as const)('%s canal de outra comunidade retorna 404', async (method) => {
      const other = await prisma.community.create({ data: { name: 'Outra', ownerId: users.outsider.id, rooms: { create: { name: 'outro', channelKind: 'TEXT', isPersistent: true, isPrivate: true } } }, include: { rooms: true } });
      communityIds.push(other.id);
      expect((await inject('member', method, `/api/channels/${other.rooms[0]!.id}`, method === 'PATCH' ? { name: 'fora' } : undefined)).statusCode).toBe(404);
    });
    it('nao membro nao entra em VOICE', async () => {
      expect((await ack(await connect('outsider'), 'join-room', { roomId: voiceId })).success).not.toBe(true);
    });
    it('ack de subscribe contem voiceStates atuais', async () => {
      expect((await ack(await connect('member'), 'join-room', { roomId: voiceId })).success).toBe(true);
      expect((await ack(await connect('owner'), 'community:subscribe', { communityId: id })).voiceStates).toEqual(expect.arrayContaining([expect.objectContaining({ channelId: voiceId, members: expect.arrayContaining([expect.objectContaining({ userId: users.member.id })]) })]));
    });
    it('recusa canal acima do limite', async () => {
      await prisma.room.createMany({ data: Array.from({ length: MAX_CHANNELS_PER_COMMUNITY - 2 }, (_, index) => ({ communityId: id, name: `canal-${index}`, channelKind: 'TEXT' as const, isPersistent: true, isPrivate: true })) });
      expect((await inject('owner', 'POST', `/api/communities/${id}/channels`, { name: 'excedente', kind: 'TEXT' })).statusCode).toBe(409);
    });
    it('recusa comunidade acima do limite de OWNER', async () => {
      const extra = await Promise.all(Array.from({ length: MAX_COMMUNITIES_OWNED - 1 }, () => prisma.community.create({ data: { name: 'Limite', ownerId: users.owner.id } })));
      communityIds.push(...extra.map((community) => community.id));
      expect((await inject('owner', 'POST', '/api/communities', { name: 'excedente' })).statusCode).toBe(409);
    });
    it('recusa convite quando comunidade esta cheia', async () => {
      const entry = await invite(id);
      const prefix = `community-capacity-${stamp}-`;
      const fillers = Array.from({ length: MAX_COMMUNITY_MEMBERS - 3 }, (_, index) => ({ id: `${prefix}${index}`, email: `${prefix}${index}@exemplo.com`, name: 'membro', passwordHash: 'x' }));
      try {
        await prisma.user.createMany({ data: fillers });
        await prisma.communityMember.createMany({ data: fillers.map((user) => ({ communityId: id, userId: user.id })) });
        expect((await inject('outsider', 'POST', '/api/invites/accept', { code: entry.code })).statusCode).toBe(409);
        expect((await prisma.communityInvite.findUniqueOrThrow({ where: { id: entry.id } })).uses).toBe(0);
      } finally { await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } }); }
    });
    it.each(['upload', 'download', 'turn'] as const)('expulso perde acesso a %s', async (operation) => {
      const socket = await connect('member');
      const joined = await ack(socket, 'join-room', { roomId: voiceId });
      expect(joined.success).toBe(true);
      const message = await prisma.chatMessage.create({ data: { roomId: voiceId, authorId: users.owner.id, content: 'arquivo' } });
      const file = await prisma.chatFile.create({ data: { roomId: voiceId, messageId: message.id, filename: 'teste.txt', mime: 'text/plain', size: 1, path: `uploads/${voiceId}/teste.txt` } });
      expect((await inject('owner', 'DELETE', `/api/communities/${id}/members/${users.member.id}`)).statusCode).toBe(200);
      const url = operation === 'upload' ? `/api/rooms/${voiceId}/files` : operation === 'download' ? `/api/files/${file.id}` : `/api/turn/credentials?roomId=${voiceId}`;
      const response = await app.inject({ method: operation === 'upload' ? 'POST' : 'GET', url, headers: { cookie: `token=${users.member.token}`, 'x-room-ticket': String(joined.ticket) } });
      expect(response.statusCode).toBe(403);
    });
    it.each(['preview', 'accept'])('%s retorna 404 para codigo inexistente', async (endpoint) => {
      expect((await inject('outsider', 'POST', `/api/invites/${endpoint}`, { code: 'A'.repeat(22) })).statusCode).toBe(404);
    });
    it.each(['preview', 'accept'])('%s retorna 429 apos limite', async (endpoint) => {
      const request = () => app.inject({ method: 'POST', url: `/api/invites/${endpoint}`, remoteAddress: '203.0.113.10', headers: { cookie: `token=${users.outsider.token}` }, payload: { code: 'A'.repeat(22) } });
      for (let attempt = 0; attempt < 30; attempt++) expect((await request()).statusCode).toBe(404);
      const response = await request();
      expect(response.statusCode).toBe(429);
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

});
