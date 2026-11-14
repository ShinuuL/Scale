/**
 * Fase 4: apelido por comunidade e auditoria das configuracoes de canal,
 * limite de voz e boas-vindas.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetCommunityInviteRateLimit, resetCommunityNicknameRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { communityModerationRoutes } from '../routes/communityModeration.js';
import { communityNicknameRoutes } from '../routes/communityNickname.js';
import { channelSettingsRoutes } from '../routes/channelSettings.js';
import { communityWelcomeRoutes } from '../routes/communityWelcome.js';

type Who = 'owner' | 'admin' | 'mod' | 'member' | 'outsider';
const names: Who[] = ['owner', 'admin', 'mod', 'member', 'outsider'];
const stamp = `n${Date.now().toString(36)}`;
type Entry = { action: string; targetId: string | null; targetName: string | null; detail: string | null };

describe('apelido por comunidade e auditoria da fase 3', () => {
  let app: FastifyInstance;
  let communityId = '';
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const inject = (who: Who, method: InjectOptions['method'], url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: `token=${users[who].token}` }, ...(payload === undefined ? {} : { payload }) });
  const base = () => `/api/communities/${communityId}`;
  const nick = (who: Who, target: Who, nickname: string | null) =>
    inject(who, 'PUT', `${base()}/members/${users[target].id}/nickname`, { nickname });
  const members = async () =>
    ((await inject('owner', 'GET', base())).json() as { members: Array<{ userId: string; name: string; nickname: string | null }> }).members;
  const auditLog = async () => ((await inject('owner', 'GET', `${base()}/audit`)).json() as { entries: Entry[] }).entries;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.register(communityModerationRoutes);
    await app.register(communityNicknameRoutes);
    await app.register(channelSettingsRoutes);
    await app.register(communityWelcomeRoutes);
    await app.ready();
    for (const who of names) {
      const email = `f4-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });

  beforeEach(async () => {
    for (const who of names) resetCommunityNicknameRateLimit(users[who].id);
    resetCommunityInviteRateLimit('127.0.0.1');
    const created = await inject('owner', 'POST', '/api/communities', { name: 'F4' });
    communityId = (created.json() as { community: { id: string } }).community.id;
    const role = await prisma.communityCustomRole.create({ data: { communityId, name: 'Mod', color: '#123456', kickMembers: true } });
    await prisma.communityMember.createMany({ data: [
      { communityId, userId: users.admin.id, role: 'ADMIN' },
      { communityId, userId: users.mod.id, role: 'MEMBER', customRoleId: role.id },
      { communityId, userId: users.member.id, role: 'MEMBER' },
    ] });
  });

  afterAll(async () => {
    const owned = await prisma.community.findMany({ where: { ownerId: users.owner.id }, select: { id: true } });
    for (const c of owned) await inject('owner', 'DELETE', `/api/communities/${c.id}`);
    await prisma.user.deleteMany({ where: { email: { in: names.map((who) => users[who].email) } } });
    await app.close();
  });

  it('o proprio membro define e limpa o apelido, sem auditoria', async () => {
    const res = await nick('member', 'member', '  Dragao  ');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ nickname: 'Dragao' });
    expect((await members()).find((m) => m.userId === users.member.id)).toMatchObject({ name: 'member', nickname: 'Dragao' });
    expect((await nick('member', 'member', '')).json()).toEqual({ nickname: null });
    expect((await members()).find((m) => m.userId === users.member.id)?.nickname).toBeNull();
    expect((await auditLog()).some((e) => e.action === 'member.nickname')).toBe(false);
  });

  it('valida entrada e esconde a comunidade de quem nao e membro', async () => {
    expect((await nick('member', 'member', 'x'.repeat(33))).statusCode).toBe(400);
    expect((await inject('member', 'PUT', `${base()}/members/${users.member.id}/nickname`, {})).statusCode).toBe(400);
    expect((await nick('outsider', 'outsider', 'oi')).statusCode).toBe(404);
    expect((await nick('owner', 'outsider', 'oi')).statusCode).toBe(404);
  });

  it('mudar o de outro exige kickMembers e hierarquia, e entra na auditoria', async () => {
    expect((await nick('member', 'mod', 'x')).statusCode).toBe(403);
    expect((await nick('mod', 'admin', 'x')).statusCode).toBe(403);
    expect((await nick('admin', 'owner', 'x')).statusCode).toBe(403);
    expect((await nick('mod', 'member', 'Calmo')).statusCode).toBe(200);
    const entry = (await auditLog()).find((e) => e.action === 'member.nickname');
    expect(entry).toMatchObject({ targetId: users.member.id, targetName: 'member', detail: 'Calmo' });
    expect((await nick('owner', 'admin', null)).statusCode).toBe(200);
  });

  it('balde proprio: 11a mudanca em 10 min recebe 429', async () => {
    for (let i = 0; i < 10; i++) expect((await nick('member', 'member', `n${i}`)).statusCode).toBe(200);
    const res = await nick('member', 'member', 'demais');
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('audita configuracoes do canal, limite de voz e boas-vindas', async () => {
    const detail = (await inject('owner', 'GET', base())).json() as { channels: Array<{ id: string; name: string; kind: string }> };
    const text = detail.channels.find((c) => c.kind === 'TEXT');
    const voice = detail.channels.find((c) => c.kind === 'VOICE');
    if (!text || !voice) throw new Error('canais padrao ausentes');
    expect((await inject('owner', 'PUT', `/api/channels/${text.id}/settings`, { announcement: true, slowModeSeconds: 30, overrides: [] })).statusCode).toBe(200);
    expect((await inject('owner', 'PUT', `/api/channels/${voice.id}/user-limit`, { userLimit: 4 })).statusCode).toBe(200);
    expect((await inject('owner', 'PUT', `${base()}/welcome`, { channelId: text.id, message: 'Oi {nome}' })).statusCode).toBe(200);
    expect((await inject('owner', 'PUT', `${base()}/welcome`, { channelId: null, message: 'Oi {nome}' })).statusCode).toBe(200);
    const entries = await auditLog();
    expect(entries.find((e) => e.action === 'channel.settings')).toMatchObject({
      targetId: text.id, targetName: text.name, detail: 'aviso ligado, modo lento 30 s, 0 permissões',
    });
    expect(entries.find((e) => e.action === 'channel.user_limit')).toMatchObject({ targetId: voice.id, detail: '4 pessoas' });
    expect(entries.filter((e) => e.action === 'community.welcome').map((e) => e.detail)).toEqual(['desligadas', 'mensagem atualizada']);
  });
});
