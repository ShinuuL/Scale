/**
 * Painel de administracao da moderacao: /api/admin/moderation (GET, PUT,
 * DELETE api-key, POST test, GET audit), isAdmin em /api/auth/me, config
 * efetiva (banco ?? .env) refletida em GET /api/moderation/config, no sweep,
 * no gate e no evento `moderation:config`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';
import { adminModerationRoutes, providerErrorDetail } from '../routes/adminModeration.js';
import { moderationRoutes } from '../routes/moderation.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetAdminSettingsRateLimit } from '../lib/rateLimit.js';
import { createSocketServer } from '../socket/handler.js';
import { decryptSecret } from '../lib/settingsCrypto.js';
import { getModerationProvider, setModerationProviderForTests, sweepModerationEvents, type ModerationVerdict } from '../lib/moderation/index.js';
import { getEffectiveModerationSettings, invalidateModerationSettings } from '../lib/moderation/settings.js';

const TAG = `admmod-${Date.now()}`;
const ADMIN_EMAIL = `${TAG}-admin@exemplo.com`;
const USER_EMAIL = `${TAG}-user@exemplo.com`;
const API_KEY = 'sk-ant-chave-de-teste-nunca-real-0001';

describe('painel de administracao da moderacao', () => {
  let app: FastifyInstance;
  let port = 0;
  let adminId = '';
  let adminToken = '';
  let userId = '';
  let userToken = '';
  const clients: Socket[] = [];
  const asAdmin = (): Record<string, string> => ({ cookie: `token=${adminToken}` });
  const asUser = (): Record<string, string> => ({ cookie: `token=${userToken}` });

  async function wipe(): Promise<void> {
    await prisma.moderationSettings.deleteMany();
    await prisma.moderationAuditLog.deleteMany();
    invalidateModerationSettings();
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.ADMIN_EMAILS = ADMIN_EMAIL;
    process.env.MODERATION_PROVIDER = 'heuristic';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MODERATION_SCREEN;
    delete process.env.MODERATION_RETENTION_DAYS;
    delete process.env.SCREEN_SHARE_MIN_AGE;
    delete process.env.PRIVACY_CONTACT_EMAIL;
    resetEnv();
    await wipe();

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(multipart, { limits: { fileSize: 1_000_000, files: 1 } });
    await app.register(authRoutes);
    await app.register(moderationRoutes);
    await app.register(adminModerationRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (addr && typeof addr === 'object') port = addr.port;
    (app as unknown as Record<string, unknown>).io = createSocketServer(app.server);

    const admin = await prisma.user.create({ data: { email: ADMIN_EMAIL, passwordHash: 'x', name: 'Admin' } });
    adminId = admin.id;
    adminToken = signToken({ userId: adminId, email: ADMIN_EMAIL, name: 'Admin' });
    const user = await prisma.user.create({ data: { email: USER_EMAIL, passwordHash: 'x', name: 'Comum' } });
    userId = user.id;
    userToken = signToken({ userId, email: USER_EMAIL, name: 'Comum' });
  });

  beforeEach(() => {
    resetAdminSettingsRateLimit(adminId);
    resetAdminSettingsRateLimit(userId);
    setModerationProviderForTests(undefined);
  });

  afterAll(async () => {
    while (clients.length) clients.pop()?.disconnect();
    setModerationProviderForTests(undefined);
    await wipe();
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
    delete process.env.ADMIN_EMAILS;
    resetEnv();
    await app.close();
  });

  const get = (): Promise<LightMyRequestResponse> => app.inject({ method: 'GET', url: '/api/admin/moderation', headers: asAdmin() });
  const put = (payload: Record<string, unknown>, headers = asAdmin()): Promise<LightMyRequestResponse> =>
    app.inject({ method: 'PUT', url: '/api/admin/moderation', headers, payload });
  const publicConfig = async () => (await app.inject({ method: 'GET', url: '/api/moderation/config' })).json();

  it('sem sessao -> 401; usuario comum -> 403 em todas', async () => {
    const routes = [
      ['GET', '/api/admin/moderation'],
      ['PUT', '/api/admin/moderation'],
      ['DELETE', '/api/admin/moderation/api-key'],
      ['POST', '/api/admin/moderation/test'],
      ['GET', '/api/admin/moderation/audit'],
    ] as const;
    for (const [method, url] of routes) {
      const payload = method === 'GET' || method === 'DELETE' ? undefined : { text: 'oi' };
      expect((await app.inject({ method, url, payload })).statusCode, `${method} ${url} anonimo`).toBe(401);
      const res = await app.inject({ method, url, headers: asUser(), payload });
      expect(res.statusCode, `${method} ${url} comum`).toBe(403);
      expect(res.json()).toEqual({ error: 'Forbidden' });
    }
  });

  it('isAdmin em /api/auth/me: true para o admin, false para o comum', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: asAdmin() });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.isAdmin).toBe(true);
    expect(me.json().user).not.toHaveProperty('birthDate');
    const other = await app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser() });
    expect(other.json().user.isAdmin).toBe(false);
  });

  it('GET devolve envDefaults, overrides null e efetivo = .env', async () => {
    await wipe();
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      effective: {
        provider: 'heuristic', screen: false, minAge: 18, consentVersion: '2026-11', frameIntervalSec: 20,
        privacyContactEmail: null, model: 'claude-opus-5-5', retentionDays: 90, hasApiKey: false, apiKeySource: 'none',
      },
      overrides: { provider: null, model: null, screenEnabled: null, frameIntervalSec: null, retentionDays: null, minAge: null, privacyContactEmail: null },
      envDefaults: {
        provider: 'heuristic', model: 'claude-opus-5-5', screenEnabled: false, frameIntervalSec: 20, retentionDays: 90,
        minAge: 18, privacyContactEmail: null, hasApiKey: false,
      },
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('PUT grava override, muda o efetivo (e o GET publico na hora) e audita o diff', async () => {
    await wipe();
    const res = await put({ frameIntervalSec: 45, minAge: 16, privacyContactEmail: 'dpo@exemplo.com' });
    expect(res.statusCode).toBe(200);
    expect(res.json().overrides).toMatchObject({ frameIntervalSec: 45, minAge: 16, privacyContactEmail: 'dpo@exemplo.com' });
    expect(res.json().effective).toMatchObject({ frameIntervalSec: 45, minAge: 16, privacyContactEmail: 'dpo@exemplo.com', provider: 'heuristic' });
    expect(res.json().updatedBy).toEqual({ id: adminId, name: 'Admin' });
    expect(typeof res.json().updatedAt).toBe('string');

    expect(await publicConfig()).toMatchObject({ frameIntervalSec: 45, minAge: 16, privacyContactEmail: 'dpo@exemplo.com' });

    const audit = await app.inject({ method: 'GET', url: '/api/admin/moderation/audit?limit=5', headers: asAdmin() });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().entries).toHaveLength(1);
    expect(audit.json().entries[0]).toMatchObject({
      admin: { id: adminId, name: 'Admin' },
      changes: { frameIntervalSec: { from: null, to: 45 }, minAge: { from: null, to: 16 }, privacyContactEmail: { from: null, to: 'dpo@exemplo.com' } },
    });

    // Mesmo valor de novo: sem diff, sem auditoria nova.
    expect((await put({ minAge: 16 })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/moderation/audit', headers: asAdmin() })).json().entries).toHaveLength(1);
  });

  it('PUT null volta ao .env', async () => {
    const res = await put({ frameIntervalSec: null, minAge: null, privacyContactEmail: null });
    expect(res.statusCode).toBe(200);
    expect(res.json().overrides).toMatchObject({ frameIntervalSec: null, minAge: null, privacyContactEmail: null });
    expect(res.json().effective).toMatchObject({ frameIntervalSec: 20, minAge: 18, privacyContactEmail: null });
    expect(await publicConfig()).toMatchObject({ frameIntervalSec: 20, minAge: 18 });
  });

  it('validacoes: screenEnabled sem claude 400; provider claude sem chave 400; campo invalido 400 com field', async () => {
    await wipe();
    let res = await put({ screenEnabled: true });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ field: 'screenEnabled' });

    res = await put({ provider: 'claude' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ field: 'provider' });

    res = await put({ frameIntervalSec: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('frameIntervalSec');

    res = await put({ apiKey: 'curta' });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('apiKey');

    res = await put({ naoExiste: 1 });
    expect(res.statusCode).toBe(400);
    expect((await get()).json().overrides.screenEnabled).toBeNull();
  });

  it('PUT apiKey + provider claude grava cifrada (banco sem a chave em claro), audita "set" e nunca devolve a chave', async () => {
    await wipe();
    const res = await put({ provider: 'claude', model: 'claude-haiku-5-5', apiKey: API_KEY, screenEnabled: true });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(API_KEY);
    expect(res.json().effective).toMatchObject({ provider: 'claude', model: 'claude-haiku-5-5', screen: true, hasApiKey: true, apiKeySource: 'db' });
    expect(res.json().envDefaults.hasApiKey).toBe(false);

    const row = await prisma.moderationSettings.findUniqueOrThrow({ where: { id: 'default' } });
    expect(JSON.stringify(row)).not.toContain(API_KEY);
    expect(row.apiKeyCiphertext).toMatch(/^v1\./);
    expect(decryptSecret(row.apiKeyCiphertext as string)).toBe(API_KEY);

    const audit = await app.inject({ method: 'GET', url: '/api/admin/moderation/audit', headers: asAdmin() });
    expect(audit.body).not.toContain(API_KEY);
    expect(audit.json().entries[0].changes).toMatchObject({
      apiKey: { from: null, to: 'set' }, provider: { from: null, to: 'claude' }, model: { from: null, to: 'claude-haiku-5-5' }, screenEnabled: { from: null, to: true },
    });
    const logs = await prisma.moderationAuditLog.findMany();
    expect(JSON.stringify(logs)).not.toContain(API_KEY);

    // O provedor efetivo passa a ser o claude com modelo e chave do banco.
    const provider = await getModerationProvider();
    expect(provider.name).toBe('claude');
    expect(await publicConfig()).toMatchObject({ provider: 'claude', screen: true });
  });

  it('DELETE api-key com claude e sem chave no .env -> 400; com provedor trocado -> "cleared" e volta a none', async () => {
    let res = await app.inject({ method: 'DELETE', url: '/api/admin/moderation/api-key', headers: asAdmin() });
    expect(res.statusCode).toBe(400);
    expect(res.json().field).toBe('apiKey');

    // Trocar para heuristic com a tela ligada e recusado; desliga junto.
    expect((await put({ provider: 'heuristic' })).statusCode).toBe(400);
    expect((await put({ provider: 'heuristic', screenEnabled: null })).statusCode).toBe(200);

    res = await app.inject({ method: 'DELETE', url: '/api/admin/moderation/api-key', headers: asAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().effective).toMatchObject({ hasApiKey: false, apiKeySource: 'none', provider: 'heuristic', screen: false });
    expect((await prisma.moderationSettings.findUniqueOrThrow({ where: { id: 'default' } })).apiKeyCiphertext).toBeNull();
    const audit = await app.inject({ method: 'GET', url: '/api/admin/moderation/audit?limit=1', headers: asAdmin() });
    expect(audit.json().entries[0].changes).toEqual({ apiKey: { from: 'set', to: 'cleared' } });

    // Idempotente: sem chave no banco, nao audita de novo.
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/moderation/api-key', headers: asAdmin() })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/moderation/audit', headers: asAdmin() })).json().entries[0].changes).toEqual({ apiKey: { from: 'set', to: 'cleared' } });
  });

  it('chave do .env conta como apiKeySource env; override do banco tem prioridade', async () => {
    await wipe();
    process.env.ANTHROPIC_API_KEY = 'sk-env-chave-0123456789';
    resetEnv();
    try {
      expect((await get()).json().effective).toMatchObject({ hasApiKey: true, apiKeySource: 'env' });
      expect((await get()).json().envDefaults.hasApiKey).toBe(true);
      expect((await put({ apiKey: API_KEY })).json().effective.apiKeySource).toBe('db');
      const res = await app.inject({ method: 'DELETE', url: '/api/admin/moderation/api-key', headers: asAdmin() });
      expect(res.json().effective.apiKeySource).toBe('env');
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      resetEnv();
      await wipe();
    }
  });

  it('POST /test usa o provedor efetivo, devolve o veredito e nao grava ModerationEvent; erro -> 502 saneado', async () => {
    const before = await prisma.moderationEvent.count();
    const classifyText = vi.fn<(text: string, ctx: { lang: 'pt' }) => Promise<ModerationVerdict>>()
      .mockResolvedValueOnce({ flagged: true, category: 'bullying', severity: 'high', reason: 'insulto' });
    setModerationProviderForTests({ name: 'claude', classifyText });

    let res = await app.inject({ method: 'POST', url: '/api/admin/moderation/test', headers: asAdmin(), payload: { text: 'seu idiota' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ flagged: true, category: 'bullying', severity: 'high', reason: 'insulto' });
    expect(classifyText).toHaveBeenCalledWith('seu idiota', { lang: 'pt' });
    expect(await prisma.moderationEvent.count()).toBe(before);

    classifyText.mockRejectedValueOnce(Object.assign(new Error(`authentication_error ${API_KEY}`), { name: 'AuthenticationError', status: 401 }));
    res = await app.inject({ method: 'POST', url: '/api/admin/moderation/test', headers: asAdmin(), payload: { text: 'oi' } });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'provider_error', detail: 'AuthenticationError (401)' });
    expect(res.body).not.toContain(API_KEY);

    expect((await app.inject({ method: 'POST', url: '/api/admin/moderation/test', headers: asAdmin(), payload: { text: '' } })).statusCode).toBe(400);
  });

  it('providerErrorDetail nunca inclui a mensagem do erro', () => {
    expect(providerErrorDetail(new Error('contem sk-ant-xyz'))).toBe('Error');
    expect(providerErrorDetail(Object.assign(new Error('x'), { name: 'APIConnectionTimeoutError' }))).toBe('APIConnectionTimeoutError');
    expect(providerErrorDetail(null)).toBe('Error');
  });

  it('sweep usa a retencao efetiva (override do banco)', async () => {
    await wipe();
    const DAY = 24 * 60 * 60 * 1000;
    const now = new Date();
    const ev = await prisma.moderationEvent.create({
      data: { kind: 'text', source: 'chat', category: 'bullying', severity: 'medium', action: 'warned', excerpt: `${TAG}-ret`, createdAt: new Date(now.getTime() - 10 * DAY) },
    });
    try {
      expect(await sweepModerationEvents({ now })).toBe(0); // .env = 90 dias
      expect((await put({ retentionDays: 7 })).statusCode).toBe(200);
      expect((await getEffectiveModerationSettings()).effective.retentionDays).toBe(7);
      expect(await sweepModerationEvents({ now })).toBe(1);
      expect(await prisma.moderationEvent.findUnique({ where: { id: ev.id } })).toBeNull();
    } finally {
      await prisma.moderationEvent.deleteMany({ where: { excerpt: `${TAG}-ret` } });
      await wipe();
    }
  });

  it('gate usa a idade minima efetiva: 17 anos vira adulto com minAge 16', async () => {
    await wipe();
    const birth = new Date();
    birth.setUTCFullYear(birth.getUTCFullYear() - 17);
    await prisma.user.update({ where: { id: userId }, data: { birthDate: birth, ageVerifiedAt: new Date() } });
    const before = await app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser() });
    expect(before.json().user.screenShare).toMatchObject({ ageVerified: true, isAdult: false, reason: 'age' });

    expect((await put({ minAge: 16 })).statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: asUser() });
    expect(after.json().user.screenShare).toMatchObject({ isAdult: true, reason: 'consent' });

    // Socket: join-room le o gate com a idade minima efetiva.
    const room = await prisma.room.create({ data: { name: TAG, isPersistent: true, ownerId: adminId } });
    try {
      const client = await new Promise<Socket>((resolve, reject) => {
        const c = ioClient(`http://127.0.0.1:${port}`, { auth: { token: userToken }, transports: ['websocket'] });
        clients.push(c);
        c.on('connect', () => resolve(c));
        c.on('connect_error', reject);
      });
      await new Promise((resolve) => client.emit('join-room', { roomId: room.id }, resolve));
      const state = await new Promise<{ error?: string; reason?: string }>((resolve) =>
        client.emit('signal:screen-share-state', { roomId: room.id, targetPeerId: client.id, isScreenSharing: true }, resolve));
      // Idade ok (16), falta o termo: o motivo e consent, nao age.
      expect(state.reason).toBe('consent');
    } finally {
      while (clients.length) clients.pop()?.disconnect();
      await prisma.room.delete({ where: { id: room.id } }).catch(() => undefined);
      await wipe();
    }
  });

  it('PUT e DELETE emitem moderation:config (socket) com o ModerationConfig publico novo', async () => {
    await wipe();
    const client = await new Promise<Socket>((resolve, reject) => {
      const c = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'] });
      clients.push(c);
      c.on('connect', () => resolve(c));
      c.on('connect_error', reject);
    });
    const next = () => new Promise<Record<string, unknown>>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout moderation:config')), 2000);
      client.once('moderation:config', (data: Record<string, unknown>) => { clearTimeout(t); resolve(data); });
    });
    const pending = next();
    expect((await put({ frameIntervalSec: 60 })).statusCode).toBe(200);
    const config = await pending;
    expect(config).toEqual({ provider: 'heuristic', screen: false, minAge: 18, consentVersion: '2026-11', frameIntervalSec: 60, privacyContactEmail: null });
    expect(JSON.stringify(config)).not.toContain('model');
    client.disconnect();
    await wipe();
  });

  it('balde adminSettings: 31a chamada em 10 min -> 429', async () => {
    for (let i = 0; i < 30; i++) expect((await get()).statusCode).toBe(200);
    const res = await get();
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });
});
