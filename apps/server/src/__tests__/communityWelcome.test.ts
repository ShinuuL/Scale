import { VOICE_CHANNEL_FULL_ERROR } from '@scale/shared';
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
import { communityWelcomeRoutes } from '../routes/communityWelcome.js';
import { roomRoutes } from '../routes/rooms.js';
import { messagesRoutes } from '../routes/messages.js';
import { filesRoutes } from '../routes/files.js';
import { turnRoutes } from '../routes/turn.js';
import { createSocketServer } from '../socket/handler.js';

type Who = 'owner' | 'admin' | 'member' | 'outsider';
type Ack = Record<string, unknown>;
type Detail = { community: { welcome: { channelId: string; message: string } | null }; channels: Array<{ id: string; name: string; kind: string; userLimit: number | null }> };
type Message = { id: string; content: string; system: boolean; author: { id: string | null; name: string } };
const stamp = `w${Date.now().toString(36)}`;
const names: Who[] = ['owner', 'admin', 'member', 'outsider'];

describe('comunidades: limite de voz e boas-vindas', () => {
  let app: FastifyInstance;
  let port: number;
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const sockets: Socket[] = [];
  const communityIds: string[] = [];
  const inject = (who: Who | null, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
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
    await app.register(communityWelcomeRoutes);
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

  const channelOf = async (id: string, kind: 'TEXT' | 'VOICE') => (await detail(id)).channels.find((c) => c.kind === kind)!;

  it('limite do canal de voz: valida 2..8, so canal de voz, so quem gere canais', async () => {
    const id = await create();
    await join(id, 'member');
    const voice = await channelOf(id, 'VOICE');
    const text = await channelOf(id, 'TEXT');
    expect(voice.userLimit).toBeNull();
    for (const userLimit of [1, 9, 2.5, '4']) expect((await inject('owner', 'PUT', `/api/channels/${voice.id}/user-limit`, { userLimit })).statusCode).toBe(400);
    expect((await inject('owner', 'PUT', `/api/channels/${text.id}/user-limit`, { userLimit: 4 })).statusCode).toBe(400);
    expect((await inject('member', 'PUT', `/api/channels/${voice.id}/user-limit`, { userLimit: 4 })).statusCode).toBe(403);
    expect((await inject('outsider', 'PUT', `/api/channels/${voice.id}/user-limit`, { userLimit: 4 })).statusCode).toBe(404);
    expect((await inject('owner', 'PUT', `/api/channels/${voice.id}/user-limit`, { userLimit: 8 })).statusCode).toBe(200);
    expect((await channelOf(id, 'VOICE')).userLimit).toBe(8);
    expect((await inject('owner', 'PUT', `/api/channels/${voice.id}/user-limit`, { userLimit: null })).statusCode).toBe(200);
    expect((await channelOf(id, 'VOICE')).userLimit).toBeNull();
  });

  it('join-room recusa com erro claro quando o canal de voz esta cheio', async () => {
    const id = await create();
    await join(id, 'admin');
    await join(id, 'member');
    const voice = await channelOf(id, 'VOICE');
    expect((await inject('owner', 'PUT', `/api/channels/${voice.id}/user-limit`, { userLimit: 2 })).statusCode).toBe(200);
    expect((await ack(await connect('owner'), 'join-room', { roomId: voice.id })).success).toBe(true);
    expect((await ack(await connect('admin'), 'join-room', { roomId: voice.id })).success).toBe(true);
    const full = await ack(await connect('member'), 'join-room', { roomId: voice.id });
    expect(full.success).not.toBe(true);
    expect(full.error).toBe(VOICE_CHANNEL_FULL_ERROR);
    expect(full.userLimit).toBe(2);
    // Sem limite volta a entrar (o teto do mesh continua valendo).
    expect((await inject('owner', 'PUT', `/api/channels/${voice.id}/user-limit`, { userLimit: null })).statusCode).toBe(200);
    expect((await ack(await connect('member'), 'join-room', { roomId: voice.id })).success).toBe(true);
  });

  it('boas-vindas: canal de texto, mensagem de sistema e canal devolvido no aceite', async () => {
    const id = await create();
    const text = await channelOf(id, 'TEXT');
    const voice = await channelOf(id, 'VOICE');
    expect((await detail(id)).community.welcome).toBeNull();
    expect((await inject('owner', 'PUT', `/api/communities/${id}/welcome`, { channelId: voice.id, message: 'Oi {nome}' })).statusCode).toBe(400);
    expect((await inject('owner', 'PUT', `/api/communities/${id}/welcome`, { channelId: text.id, message: '   ' })).statusCode).toBe(400);
    expect((await inject('owner', 'PUT', `/api/communities/${id}/welcome`, { channelId: text.id, message: 'Oi {nome}, bem-vindo! {nome}' })).statusCode).toBe(200);
    expect((await detail(id)).community.welcome).toEqual({ channelId: text.id, message: 'Oi {nome}, bem-vindo! {nome}' });

    const watcher = await connect('owner');
    expect((await ack(watcher, 'community:subscribe', { communityId: id })).success).toBe(true);
    const live = next<Message>(watcher, 'channel:message');
    const accepted = await inject('member', 'POST', '/api/invites/accept', { code: (await invite(id)).code });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ communityId: id, welcomeChannelId: text.id });
    const event = await live;
    expect(event).toMatchObject({ content: 'Oi member, bem-vindo! member', system: true, author: { id: null, name: 'Sistema' } });

    const history = (await inject('member', 'GET', `/api/channels/${text.id}/messages`)).json() as { messages: Message[] };
    expect(history.messages.find((m) => m.id === event.id)).toMatchObject({ system: true, author: { id: null, name: 'Sistema' } });
    // Ninguem edita mensagem de sistema.
    expect((await inject('owner', 'PATCH', `/api/channels/${text.id}/messages/${event.id}`, { content: 'x' })).statusCode).toBe(403);
    expect((await inject('member', 'PATCH', `/api/channels/${text.id}/messages/${event.id}`, { content: 'x' })).statusCode).toBe(403);
    // Ja membro: nao posta de novo, mas devolve o canal.
    const again = await inject('member', 'POST', '/api/invites/accept', { code: (await invite(id)).code });
    expect(again.json()).toEqual({ communityId: id, welcomeChannelId: text.id });
    expect(await prisma.chatMessage.count({ where: { roomId: text.id, isSystem: true } })).toBe(1);
  });

  it('boas-vindas: so OWNER/ADMIN configuram; desligado nao posta', async () => {
    const id = await create();
    const text = await channelOf(id, 'TEXT');
    expect((await inject('outsider', 'PUT', `/api/communities/${id}/welcome`, { channelId: text.id, message: 'Oi {nome}' })).statusCode).toBe(404);
    await join(id, 'admin');
    expect((await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.admin.id}`, { role: 'ADMIN' })).statusCode).toBe(200);
    await join(id, 'member');
    expect((await inject('member', 'PUT', `/api/communities/${id}/welcome`, { channelId: text.id, message: 'Oi {nome}' })).statusCode).toBe(403);
    expect((await inject('admin', 'PUT', `/api/communities/${id}/welcome`, { channelId: null, message: 'Oi {nome}' })).statusCode).toBe(200);
    expect((await detail(id)).community.welcome).toBeNull();
    const accepted = await inject('outsider', 'POST', '/api/invites/accept', { code: (await invite(id)).code });
    expect(accepted.json()).toEqual({ communityId: id, welcomeChannelId: null });
    expect(await prisma.chatMessage.count({ where: { roomId: text.id, isSystem: true } })).toBe(0);
  });
});
