import type { Server as HttpServer } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetCommunityEventRateLimit, resetCommunityInviteRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { communityModerationRoutes } from '../routes/communityModeration.js';
import { channelSettingsRoutes } from '../routes/channelSettings.js';
import { communityEventRoutes } from '../routes/communityEvents.js';
import { createSocketServer } from '../socket/handler.js';

type Who = 'owner' | 'admin' | 'manager' | 'member' | 'outsider';
type EventDto = { id: string; title: string; description: string | null; channelId: string | null; channelName: string | null; interestedCount: number; interested: boolean; creatorName: string };
type Detail = { channels: Array<{ id: string; kind: string }> };
const stamp = `e${Date.now().toString(36)}`;
const names: Who[] = ['owner', 'admin', 'manager', 'member', 'outsider'];
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

describe('comunidades: eventos agendados (Fase 4)', () => {
  let app: FastifyInstance;
  let port: number;
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const sockets: Socket[] = [];
  const communityIds: string[] = [];
  const inject = (who: Who, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) => {
    const options: InjectOptions = { method, url, headers: { cookie: `token=${users[who].token}` } };
    if (payload !== undefined) options.payload = payload;
    return app.inject(options);
  };
  const list = async (id: string, who: Who = 'member') =>
    ((await inject(who, 'GET', `/api/communities/${id}/events`)).json() as { events: EventDto[] }).events;

  async function setup() {
    const created = await inject('owner', 'POST', '/api/communities', { name: 'Eventos' });
    const id = (created.json() as { community: { id: string } }).community.id;
    communityIds.push(id);
    for (const who of ['admin', 'manager', 'member'] as const) {
      const invite = (await inject('owner', 'POST', `/api/communities/${id}/invites`, { expiresIn: '7d' })).json() as { invite: { code: string } };
      expect((await inject(who, 'POST', '/api/invites/accept', { code: invite.invite.code })).statusCode).toBe(200);
    }
    expect((await inject('owner', 'PATCH', `/api/communities/${id}/members/${users.admin.id}`, { role: 'ADMIN' })).statusCode).toBe(200);
    const role = await inject('owner', 'POST', `/api/communities/${id}/roles`, { name: 'Agenda', color: '#336699', permissions: { manageChannels: true, manageInvites: false, manageMessages: false, kickMembers: false } });
    const roleId = (role.json() as { role: { id: string } }).role.id;
    expect((await inject('owner', 'PUT', `/api/communities/${id}/members/${users.manager.id}/custom-role`, { customRoleId: roleId })).statusCode).toBe(200);
    const detail = (await inject('owner', 'GET', `/api/communities/${id}`)).json() as Detail;
    return { id, voice: detail.channels.find((c) => c.kind === 'VOICE')!.id, text: detail.channels.find((c) => c.kind === 'TEXT')!.id };
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
    await app.register(communityModerationRoutes);
    await app.register(channelSettingsRoutes);
    await app.register(communityEventRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const server: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(server);
    const address = server.address();
    port = address && typeof address === 'object' ? address.port : 0;
    for (const who of names) {
      const email = `event-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });
  beforeEach(() => {
    resetCommunityInviteRateLimit('127.0.0.1');
    for (const who of names) resetCommunityEventRateLimit(users[who].id);
  });
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.disconnect();
    await prisma.community.deleteMany({ where: { id: { in: communityIds.splice(0) } } });
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: names.map((who) => users[who].email) } } });
    await app.close();
  });

  it('cria, edita e cancela: so dono, ADMIN ou manageChannels; tudo na auditoria', async () => {
    const { id, voice } = await setup();
    const input = { title: 'Noite de jogos', description: 'Traga o fone', startsAt: inHours(2), endsAt: inHours(4), channelId: voice };
    expect((await inject('member', 'POST', `/api/communities/${id}/events`, input)).statusCode).toBe(403);
    expect((await inject('outsider', 'POST', `/api/communities/${id}/events`, input)).statusCode).toBe(404);
    expect((await inject('outsider', 'GET', `/api/communities/${id}/events`)).statusCode).toBe(404);
    for (const who of ['owner', 'admin', 'manager'] as const) {
      expect((await inject(who, 'POST', `/api/communities/${id}/events`, { ...input, title: `Evento ${who}` })).statusCode).toBe(201);
    }
    const events = await list(id);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ channelId: voice, channelName: expect.any(String), interestedCount: 0, interested: false });
    const target = events[0]!.id;
    expect((await inject('member', 'PATCH', `/api/community-events/${target}`, { ...input, title: 'x' })).statusCode).toBe(403);
    expect((await inject('manager', 'PATCH', `/api/community-events/${target}`, { ...input, title: 'Renomeado', channelId: null })).statusCode).toBe(200);
    expect((await list(id)).find((e) => e.id === target)).toMatchObject({ title: 'Renomeado', channelId: null });
    expect((await inject('member', 'DELETE', `/api/community-events/${target}`)).statusCode).toBe(403);
    expect((await inject('admin', 'DELETE', `/api/community-events/${target}`)).statusCode).toBe(200);
    expect(await list(id)).toHaveLength(2);
    const audit = (await inject('owner', 'GET', `/api/communities/${id}/audit`)).json() as { entries: Array<{ action: string }> };
    const actions = audit.entries.map((e) => e.action);
    expect(actions.filter((a) => a === 'event.create')).toHaveLength(3);
    expect(actions).toContain('event.update');
    expect(actions).toContain('event.cancel');
  });

  it('valida titulo, datas e canal (so voz da comunidade, visivel ao criador)', async () => {
    const { id, voice, text } = await setup();
    const base = { title: 'Ok', startsAt: inHours(1) };
    const bad = [
      { ...base, title: '' }, { ...base, title: 'a'.repeat(101) }, { ...base, description: 'a'.repeat(1001) },
      { ...base, startsAt: 'amanha' }, { ...base, endsAt: inHours(0.5) }, { title: 'Passado', startsAt: inHours(-2) },
      { ...base, channelId: text }, { ...base, channelId: crypto.randomUUID() },
    ];
    for (const payload of bad) expect((await inject('owner', 'POST', `/api/communities/${id}/events`, payload)).statusCode).toBe(400);
    // Cargo perde manageChannels: deixa de criar.
    const roleId = (await prisma.communityMember.findFirstOrThrow({ where: { communityId: id, userId: users.manager.id } })).customRoleId!;
    await prisma.communityCustomRole.update({ where: { id: roleId }, data: { manageChannels: false, manageInvites: true } });
    expect((await inject('manager', 'POST', `/api/communities/${id}/events`, base)).statusCode).toBe(403);
    // Evento em andamento (comecou, termina no futuro) ainda aparece; sem fim e ja comecado some.
    await prisma.communityEvent.createMany({ data: [
      { communityId: id, creatorId: users.owner.id, creatorName: 'owner', title: 'Agora', startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000) },
      { communityId: id, creatorId: users.owner.id, creatorName: 'owner', title: 'Acabou', startsAt: new Date(Date.now() - 3_600_000) },
    ] });
    expect((await list(id)).map((e) => e.title)).toEqual(['Agora']);
    expect((await inject('owner', 'POST', `/api/communities/${id}/events`, { ...base, channelId: voice })).statusCode).toBe(201);
  });

  it('canal escondido do leitor sai como sem canal na listagem', async () => {
    const { id, voice } = await setup();
    expect((await inject('owner', 'POST', `/api/communities/${id}/events`, { title: 'Privado', startsAt: inHours(1), channelId: voice })).statusCode).toBe(201);
    expect((await inject('owner', 'PUT', `/api/channels/${voice}/settings`, { announcement: false, slowModeSeconds: 0, overrides: [{ target: 'everyone', viewChannel: false, sendMessages: null }] })).statusCode).toBe(200);
    expect((await list(id, 'member'))[0]).toMatchObject({ channelId: null, channelName: null });
    expect((await list(id, 'owner'))[0]).toMatchObject({ channelId: voice });
  });

  it('interesse: marca, desmarca, conta e avisa em tempo real', async () => {
    const { id } = await setup();
    await inject('owner', 'POST', `/api/communities/${id}/events`, { title: 'Live', startsAt: inHours(3) });
    const [event] = await list(id);
    const watcher = await new Promise<Socket>((resolve, reject) => {
      const socket = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `token=${users.owner.token}` } });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });
    await new Promise((resolve) => watcher.emit('community:subscribe', { communityId: id }, resolve));
    const live = new Promise((resolve) => watcher.once('community:changed', resolve));
    const marked = await inject('member', 'PUT', `/api/community-events/${event!.id}/interest`, { interested: true });
    expect(marked.json()).toEqual({ interested: true, interestedCount: 1 });
    await expect(live).resolves.toEqual({ communityId: id });
    expect((await inject('member', 'PUT', `/api/community-events/${event!.id}/interest`, { interested: true })).json()).toEqual({ interested: true, interestedCount: 1 });
    await inject('admin', 'PUT', `/api/community-events/${event!.id}/interest`, { interested: true });
    expect((await list(id, 'member'))[0]).toMatchObject({ interestedCount: 2, interested: true });
    expect((await list(id, 'owner'))[0]).toMatchObject({ interestedCount: 2, interested: false });
    expect((await inject('member', 'PUT', `/api/community-events/${event!.id}/interest`, { interested: false })).json()).toEqual({ interested: false, interestedCount: 1 });
    expect((await inject('outsider', 'PUT', `/api/community-events/${event!.id}/interest`, { interested: true })).statusCode).toBe(404);
    expect((await inject('member', 'PUT', `/api/community-events/${event!.id}/interest`, { interested: 'sim' })).statusCode).toBe(400);
  });

  it('rate limit por usuario: 429 com Retry-After', async () => {
    const { id } = await setup();
    await inject('owner', 'POST', `/api/communities/${id}/events`, { title: 'Live', startsAt: inHours(3) });
    const [event] = await list(id);
    let last = 0;
    for (let i = 0; i < 31; i += 1) last = (await inject('member', 'PUT', `/api/community-events/${event!.id}/interest`, { interested: i % 2 === 0 })).statusCode;
    expect(last).toBe(429);
  });
});
