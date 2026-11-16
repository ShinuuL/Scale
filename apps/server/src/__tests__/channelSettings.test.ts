/**
 * Fase 3 (canais): permissoes por canal, canal de avisos e modo lento.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { formatCountdown, formatSlowMode, resolveChannelAccess } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetChannelReactionRateLimit, resetChatRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { channelMessageExtrasRoutes } from '../routes/channelMessageExtras.js';
import { communitySearchRoutes } from '../routes/communitySearch.js';
import { channelSettingsRoutes } from '../routes/channelSettings.js';

type Who = 'owner' | 'vip' | 'member';
const names: Who[] = ['owner', 'vip', 'member'];
const stamp = Date.now().toString(36);

describe('resolveChannelAccess', () => {
  const base = { manager: false, customRoleId: 'r1', announcement: false };
  it('herda tudo sem sobrescrita', () => {
    expect(resolveChannelAccess(base, [])).toEqual({ view: true, send: true, manage: false });
  });
  it('cargo vence o "todos"; aviso bloqueia envio; sem ver nao envia', () => {
    const o = [{ target: 'everyone', viewChannel: false, sendMessages: null }, { target: 'r1', viewChannel: true, sendMessages: null }];
    expect(resolveChannelAccess(base, o).view).toBe(true);
    expect(resolveChannelAccess({ ...base, customRoleId: null }, o)).toEqual({ view: false, send: false, manage: false });
    expect(resolveChannelAccess({ ...base, announcement: true }, []).send).toBe(false);
    expect(resolveChannelAccess({ ...base, manager: true, announcement: true }, o)).toEqual({ view: true, send: true, manage: true });
  });
  it('formata intervalos', () => {
    expect(formatSlowMode(0)).toBe('Desligado');
    expect(formatSlowMode(300)).toBe('5 min');
    expect(formatSlowMode(21600)).toBe('6 h');
    expect(formatCountdown(45)).toBe('45 s');
    expect(formatCountdown(245)).toBe('4:05');
    expect(formatCountdown(3723)).toBe('1:02:03');
  });
});

describe('canais: permissoes, avisos e modo lento', () => {
  let app: FastifyInstance;
  let communityId = '';
  let channelId = '';
  let roleId = '';
  const users = {} as Record<Who, { id: string; token: string }>;
  const inject = (who: Who, method: InjectOptions['method'], url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: `token=${users[who].token}` }, ...(payload === undefined ? {} : { payload }) });
  const settings = (payload: object) => inject('owner', 'PUT', `/api/channels/${channelId}/settings`, payload);
  const send = (who: Who, content = 'oi') => inject(who, 'POST', `/api/channels/${channelId}/messages`, { content });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.register(channelMessageExtrasRoutes);
    await app.register(communitySearchRoutes);
    await app.register(channelSettingsRoutes);
    await app.ready();
    for (const who of names) {
      const email = `f3c-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, token: signToken({ userId: user.id, email, name: who }) };
    }
  });

  beforeEach(async () => {
    for (const who of names) { resetChatRateLimit(`user:${users[who].id}`); resetChannelReactionRateLimit(`user:${users[who].id}`); }
    const created = await inject('owner', 'POST', '/api/communities', { name: 'F3' });
    communityId = (created.json() as { community: { id: string } }).community.id;
    roleId = (await prisma.communityCustomRole.create({ data: { communityId, name: 'VIP', color: '#123456' } })).id;
    await prisma.communityMember.createMany({ data: [
      { communityId, userId: users.vip.id, role: 'MEMBER', customRoleId: roleId },
      { communityId, userId: users.member.id, role: 'MEMBER' },
    ] });
    const channel = await inject('owner', 'POST', `/api/communities/${communityId}/channels`, { name: 'secreto', kind: 'TEXT' });
    channelId = (channel.json() as { channel: { id: string } }).channel.id;
  });

  afterAll(async () => {
    await prisma.community.deleteMany({ where: { ownerId: users.owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: names.map((w) => users[w].id) } } });
    await app.close();
  });

  it('so quem gerencia configura; valores fora da lista = 400', async () => {
    expect((await inject('member', 'PUT', `/api/channels/${channelId}/settings`, { announcement: false, slowModeSeconds: 0, overrides: [] })).statusCode).toBe(403);
    expect((await settings({ announcement: false, slowModeSeconds: 7, overrides: [] })).statusCode).toBe(400);
    expect((await settings({ announcement: false, slowModeSeconds: 0, overrides: [{ target: crypto.randomUUID(), viewChannel: false, sendMessages: null }] })).statusCode).toBe(400);
  });

  it('canal oculto some da lista, historico, envio, reacao e busca; o cargo liberado e o dono passam', async () => {
    const msg = (await send('owner', 'segredo')).json() as { message: { id: string } };
    expect((await settings({ announcement: false, slowModeSeconds: 0, overrides: [
      { target: 'everyone', viewChannel: false, sendMessages: null },
      { target: roleId, viewChannel: true, sendMessages: null },
    ] })).statusCode).toBe(200);
    const channelsOf = async (who: Who) => ((await inject(who, 'GET', `/api/communities/${communityId}`)).json() as { channels: Array<{ id: string; overrides?: unknown[] }> }).channels;
    expect((await channelsOf('member')).some((c) => c.id === channelId)).toBe(false);
    expect((await channelsOf('vip')).some((c) => c.id === channelId)).toBe(true);
    expect((await channelsOf('owner')).find((c) => c.id === channelId)?.overrides).toHaveLength(2);
    expect((await inject('member', 'GET', `/api/channels/${channelId}/messages`)).statusCode).toBe(404);
    expect((await send('member')).statusCode).toBe(404);
    expect((await inject('member', 'POST', `/api/channels/${channelId}/messages/${msg.message.id}/reactions`, { reaction: 'like' })).statusCode).toBe(404);
    const search = (await inject('member', 'GET', `/api/communities/${communityId}/search?q=segredo`)).json() as { results: unknown[] };
    expect(search.results).toHaveLength(0);
    expect((await inject('member', 'GET', `/api/communities/${communityId}/search?q=segredo&channelId=${channelId}`)).statusCode).toBe(404);
    expect((await send('vip')).statusCode).toBe(201);
  });

  it('negar envio deixa ler, mas nao postar', async () => {
    await settings({ announcement: false, slowModeSeconds: 0, overrides: [{ target: 'everyone', viewChannel: null, sendMessages: false }] });
    expect((await inject('member', 'GET', `/api/channels/${channelId}/messages`)).statusCode).toBe(200);
    expect((await send('member')).statusCode).toBe(403);
    expect((await send('owner')).statusCode).toBe(201);
  });

  it('canal de avisos: so quem gerencia posta; os demais leem e reagem', async () => {
    await settings({ announcement: true, slowModeSeconds: 0, overrides: [] });
    const posted = await send('owner', 'aviso');
    expect(posted.statusCode).toBe(201);
    expect((await send('member')).statusCode).toBe(403);
    const id = (posted.json() as { message: { id: string } }).message.id;
    expect((await inject('member', 'POST', `/api/channels/${channelId}/messages/${id}/reactions`, { reaction: 'like' })).statusCode).toBe(200);
    const detail = (await inject('member', 'GET', `/api/communities/${communityId}`)).json() as { channels: Array<{ id: string; announcement: boolean; canSend: boolean }> };
    expect(detail.channels.find((c) => c.id === channelId)).toMatchObject({ announcement: true, canSend: false });
  });

  it('modo lento: 429 com segundos restantes; quem gerencia fica isento', async () => {
    await settings({ announcement: false, slowModeSeconds: 60, overrides: [] });
    expect((await send('member')).statusCode).toBe(201);
    const blocked = await send('member');
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json() as { retryAfterSeconds: number; error: string };
    expect(body.retryAfterSeconds).toBeGreaterThan(55);
    expect(body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(blocked.headers['retry-after']).toBe(String(body.retryAfterSeconds));
    expect((await send('owner')).statusCode).toBe(201);
    expect((await send('owner')).statusCode).toBe(201);
  });
});
