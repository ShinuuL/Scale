import type { Server as HttpServer } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, type Socket } from 'socket.io-client';
import { UNREAD_COUNT_CAP } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetChatRateLimit, resetCommunityInviteRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { createSocketServer } from '../socket/handler.js';

type Who = 'owner' | 'member' | 'outsider';
type Detail = { channels: Array<{ id: string; kind: string; unread: number }> };
type List = { communities: Array<{ id: string; unread: number }> };
const stamp = Date.now().toString(36);
const names: Who[] = ['owner', 'member', 'outsider'];

describe('mensagens nao lidas', () => {
  let app: FastifyInstance;
  let port: number;
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const sockets: Socket[] = [];
  const communityIds: string[] = [];
  const inject = (who: Who, method: 'GET' | 'POST', url: string, payload?: object) => {
    const options: InjectOptions = { method, url, headers: { cookie: `token=${users[who].token}` } };
    if (payload !== undefined) options.payload = payload;
    return app.inject(options);
  };
  const connect = (who: Who): Promise<Socket> => new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `token=${users[who].token}` } });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  /** Comunidade com o membro dentro; a entrada fica no passado (base da contagem). */
  async function setup() {
    const created = (await inject('owner', 'POST', '/api/communities', { name: 'Nao lidas' })).json() as { community: { id: string } };
    const id = created.community.id;
    communityIds.push(id);
    const invite = (await inject('owner', 'POST', `/api/communities/${id}/invites`, { expiresIn: '7d' })).json() as { invite: { code: string } };
    expect((await inject('member', 'POST', '/api/invites/accept', { code: invite.invite.code })).statusCode).toBe(200);
    await prisma.communityMember.updateMany({ where: { communityId: id }, data: { joinedAt: new Date(Date.now() - 60_000) } });
    const detail = (await inject('member', 'GET', `/api/communities/${id}`)).json() as Detail;
    const text = detail.channels.find(c => c.kind === 'TEXT')!.id;
    return { id, text };
  }
  const seed = (roomId: string, authorId: string | null, count: number, extra: { deletedAt?: Date } = {}) =>
    prisma.chatMessage.createMany({ data: Array.from({ length: count }, (_, i) => ({ roomId, authorId, guestName: authorId ? null : 'Convidado', content: `m${i}`, createdAt: new Date(Date.now() - 30_000 + i), ...extra })) });
  const memberDetail = async (id: string) => (await inject('member', 'GET', `/api/communities/${id}`)).json() as Detail;
  const memberTotal = async (id: string) => ((await inject('member', 'GET', '/api/communities')).json() as List).communities.find(c => c.id === id)?.unread;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const server: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(server);
    const address = server.address();
    port = address && typeof address === 'object' ? address.port : 0;
    for (const who of names) {
      const email = `unread-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });
  beforeEach(() => {
    resetCommunityInviteRateLimit('127.0.0.1');
    for (const who of names) resetChatRateLimit(`user:${users[who].id}`);
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    await prisma.community.deleteMany({ where: { id: { in: communityIds.splice(0) } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: names.map(who => users[who].email) } } });
    await app.close();
  });

  it('conta mensagens de outros, ignora as proprias e as apagadas, e soma por comunidade', async () => {
    const { id, text } = await setup();
    await seed(text, users.owner.id, 3);
    await seed(text, null, 1);
    await seed(text, users.member.id, 2);
    await seed(text, users.owner.id, 1, { deletedAt: new Date() });
    const detail = await memberDetail(id);
    expect(detail.channels.find(c => c.id === text)?.unread).toBe(4);
    expect(detail.channels.filter(c => c.kind === 'VOICE').every(c => c.unread === 0)).toBe(true);
    expect(await memberTotal(id)).toBe(4);
    // Para o dono, as do membro (e do convidado) contam e as dele nao.
    const owner = (await inject('owner', 'GET', `/api/communities/${id}`)).json() as Detail;
    expect(owner.channels.find(c => c.id === text)?.unread).toBe(3);
  });

  it('mensagens anteriores a entrada na comunidade nao contam', async () => {
    const { id, text } = await setup();
    await seed(text, users.owner.id, 2);
    await prisma.communityMember.updateMany({ where: { communityId: id, userId: users.member.id }, data: { joinedAt: new Date() } });
    expect((await memberDetail(id)).channels.find(c => c.id === text)?.unread).toBe(0);
  });

  it('marcar canal e comunidade como lidos zera; nova mensagem volta a contar', async () => {
    const { id, text } = await setup();
    const other = ((await inject('owner', 'POST', `/api/communities/${id}/channels`, { name: 'outro', kind: 'TEXT' })).json() as { channel: { id: string } }).channel.id;
    await seed(text, users.owner.id, 2);
    await seed(other, users.owner.id, 5);
    expect((await inject('member', 'POST', `/api/channels/${text}/read`, {})).statusCode).toBe(200);
    expect(await memberTotal(id)).toBe(5);
    expect((await inject('member', 'POST', `/api/communities/${id}/read`, {})).statusCode).toBe(200);
    expect(await memberTotal(id)).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 5));
    expect((await inject('owner', 'POST', `/api/channels/${other}/messages`, { content: 'nova' })).statusCode).toBe(201);
    expect((await memberDetail(id)).channels.find(c => c.id === other)?.unread).toBe(1);
  });

  it('limita a contagem por canal ao teto', async () => {
    const { id, text } = await setup();
    await seed(text, users.owner.id, UNREAD_COUNT_CAP + 20);
    expect((await memberDetail(id)).channels.find(c => c.id === text)?.unread).toBe(UNREAD_COUNT_CAP);
  });

  it('so membros marcam como lido', async () => {
    const { id, text } = await setup();
    expect((await inject('outsider', 'POST', `/api/channels/${text}/read`, {})).statusCode).toBe(404);
    expect((await inject('outsider', 'POST', `/api/communities/${id}/read`, {})).statusCode).toBe(404);
    expect((await inject('member', 'POST', '/api/channels/nao-uuid/read', {})).statusCode).toBe(400);
  });

  it('avisa community:activity na sala pessoal de cada membro, sem conteudo', async () => {
    const { id, text } = await setup();
    const member = await connect('member');
    const outsider = await connect('outsider');
    let leaked = false;
    outsider.on('community:activity', () => { leaked = true; });
    const received = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sem community:activity')), 3000);
      member.once('community:activity', (data: Record<string, unknown>) => { clearTimeout(timer); resolve(data); });
    });
    expect((await inject('owner', 'POST', `/api/channels/${text}/messages`, { content: 'oi' })).statusCode).toBe(201);
    expect(await received).toEqual({ communityId: id, channelId: text, authorId: users.owner.id });
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(leaked).toBe(false);
  });
});
