import type { Server as HttpServer } from 'node:http';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, type Socket } from 'socket.io-client';
import { CHANNEL_TOPIC_MAX } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { createSocketServer } from '../socket/handler.js';

type Who = 'owner' | 'member' | 'outsider';
type Ack = Record<string, unknown>;
type Channel = { id: string; name: string; kind: string; topic: string | null };
const stamp = Date.now().toString(36);
const names: Who[] = ['owner', 'member', 'outsider'];

describe('comunidade: digitando e topico do canal', () => {
  let app: FastifyInstance;
  let port: number;
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const sockets: Socket[] = [];
  const communityIds: string[] = [];
  const inject = (who: Who, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) => {
    const options: InjectOptions = { method, url, headers: { cookie: `token=${users[who].token}` } };
    if (payload !== undefined) options.payload = payload;
    return app.inject(options);
  };
  const ack = (socket: Socket, event: string, data: object): Promise<Ack> =>
    new Promise((resolve, reject) => socket.timeout(3000).emit(event, data, (err: Error | null, result: Ack) => err ? reject(err) : resolve(result)));
  const connect = (who: Who): Promise<Socket> => new Promise((resolve, reject) => {
    const socket = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `token=${users[who].token}` } });
    sockets.push(socket);
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
  const collect = (socket: Socket, event: string): unknown[] => {
    const seen: unknown[] = [];
    socket.on(event, (data: unknown) => seen.push(data));
    return seen;
  };
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  async function setup() {
    const created = await inject('owner', 'POST', '/api/communities', { name: 'Digitando' });
    const id = (created.json() as { community: { id: string } }).community.id;
    communityIds.push(id);
    const inv = await inject('owner', 'POST', `/api/communities/${id}/invites`, { expiresIn: '7d' });
    const code = (inv.json() as { invite: { code: string } }).invite.code;
    expect((await inject('member', 'POST', '/api/invites/accept', { code })).statusCode).toBe(200);
    const channels = ((await inject('owner', 'GET', `/api/communities/${id}`)).json() as { channels: Channel[] }).channels;
    return { id, text: channels.find((c) => c.kind === 'TEXT') as Channel, voice: channels.find((c) => c.kind === 'VOICE') as Channel };
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
    await app.listen({ port: 0, host: '127.0.0.1' });
    const server: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(server);
    const address = server.address();
    port = address && typeof address === 'object' ? address.port : 0;
    for (const who of names) {
      const email = `typing-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    await prisma.community.deleteMany({ where: { id: { in: communityIds.splice(0) } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: names.map((who) => users[who].email) } } });
    await app.close();
  });

  it('repassa digitando aos outros membros, sem eco, e ignora canal de voz e nao inscrito', async () => {
    const { id, text, voice } = await setup();
    const owner = await connect('owner');
    const member = await connect('member');
    const outsider = await connect('outsider');
    await ack(owner, 'community:subscribe', { communityId: id });
    await ack(member, 'community:subscribe', { communityId: id });
    expect((await ack(outsider, 'community:subscribe', { communityId: id })).success).not.toBe(true);
    const ownerSeen = collect(owner, 'channel:typing');
    const memberSeen = collect(member, 'channel:typing');
    const outsiderSeen = collect(outsider, 'channel:typing');
    member.emit('channel:typing', { channelId: text.id, typing: true });
    member.emit('channel:typing', { channelId: voice.id, typing: true });
    member.emit('channel:typing', { channelId: 'nao-uuid', typing: true });
    outsider.emit('channel:typing', { channelId: text.id, typing: true });
    await wait(300);
    expect(ownerSeen).toEqual([{ communityId: id, channelId: text.id, userId: users.member.id, name: 'member', typing: true }]);
    expect(memberSeen).toEqual([]);
    expect(outsiderSeen).toEqual([]);
    member.emit('channel:typing', { channelId: text.id, typing: false });
    await wait(200);
    expect(ownerSeen).toHaveLength(2);
    expect((ownerSeen[1] as { typing: boolean }).typing).toBe(false);
    expect(await prisma.chatMessage.count({ where: { roomId: text.id } })).toBe(0);
  });

  it('topico: gerente edita e limpa, detalhe devolve; sem permissao, voz e vazio sao recusados', async () => {
    const { id, text, voice } = await setup();
    expect(text.topic).toBeNull();
    const observer = await connect('member');
    await ack(observer, 'community:subscribe', { communityId: id });
    const changed = new Promise((resolve) => observer.once('community:changed', resolve));
    expect((await inject('owner', 'PATCH', `/api/channels/${text.id}`, { topic: '  Regras e avisos  ' })).statusCode).toBe(200);
    await expect(changed).resolves.toEqual({ communityId: id });
    const detail = (await inject('member', 'GET', `/api/communities/${id}`)).json() as { channels: Channel[] };
    expect(detail.channels.find((c) => c.id === text.id)).toMatchObject({ name: text.name, topic: 'Regras e avisos' });
    expect((await inject('member', 'PATCH', `/api/channels/${text.id}`, { topic: 'x' })).statusCode).toBe(403);
    expect((await inject('owner', 'PATCH', `/api/channels/${text.id}`, { topic: 'x'.repeat(CHANNEL_TOPIC_MAX + 1) })).statusCode).toBe(400);
    expect((await inject('owner', 'PATCH', `/api/channels/${voice.id}`, { topic: 'x' })).statusCode).toBe(400);
    expect((await inject('owner', 'PATCH', `/api/channels/${text.id}`, {})).statusCode).toBe(400);
    expect((await inject('owner', 'PATCH', `/api/channels/${text.id}`, { topic: '' })).statusCode).toBe(200);
    expect((await prisma.room.findUnique({ where: { id: text.id } }))?.topic).toBeNull();
    expect((await inject('owner', 'PATCH', `/api/channels/${text.id}`, { name: 'novo' })).statusCode).toBe(200);
  });
});
