/**
 * Rotas de idade e consentimento (gate de partilha de tela), DTO `screenShare`
 * sem birthDate e exportacao de privacidade (LGPD).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { SCREEN_SHARE_CONSENT_VERSION } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { profileRoutes, parseBirthDate } from '../routes/profile.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetProfileUpdateRateLimit } from '../lib/rateLimit.js';

const EMAIL = `gate-${Date.now()}@exemplo.com`;

describe('parseBirthDate', () => {
  const now = new Date('2026-11-11T00:00:00Z');
  it('aceita data valida; recusa futura, inexistente e > 120 anos', () => {
    expect(parseBirthDate('2000-02-29', now)?.toISOString()).toBe('2000-02-29T00:00:00.000Z');
    expect(parseBirthDate('2001-02-29', now)).toBeNull();
    expect(parseBirthDate('2027-01-01', now)).toBeNull();
    expect(parseBirthDate('1900-01-01', now)).toBeNull();
  });
});

describe('rotas de idade, consentimento e exportacao', () => {
  let app: FastifyInstance;
  let userId = '';
  let token = '';
  const auth = (): Record<string, string> => ({ cookie: `token=${token}` });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(profileRoutes);
    await app.ready();
    const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: 'segredo-hash', name: 'Gabi' } });
    userId = user.id;
    token = signToken({ userId, email: EMAIL, name: 'Gabi' });
  });

  beforeEach(() => resetProfileUpdateRateLimit(userId));

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } }).catch(() => {});
    await app.close();
  });

  it('sem sessao -> 401 em todas', async () => {
    for (const [method, url] of [['PUT', '/api/me/age'], ['DELETE', '/api/me/age'], ['PUT', '/api/me/screen-share-consent'], ['DELETE', '/api/me/screen-share-consent'], ['GET', '/api/me/privacy/export']] as const) {
      const res = await app.inject({ method, url, payload: method === 'PUT' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('PUT /api/me/age: formato invalido e data futura -> 400', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/me/age', headers: auth(), payload: { birthDate: '01/01/2000' } })).statusCode).toBe(400);
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    expect((await app.inject({ method: 'PUT', url: '/api/me/age', headers: auth(), payload: { birthDate: future } })).statusCode).toBe(400);
  });

  it('menor -> ageVerified true, isAdult false, reason age; birthDate nunca no DTO', async () => {
    const y = new Date().getUTCFullYear() - 15;
    const res = await app.inject({ method: 'PUT', url: '/api/me/age', headers: auth(), payload: { birthDate: `${y}-01-01` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ageVerified: true, isAdult: false, screenShare: { allowed: false, reason: 'age' } });
    expect(JSON.stringify(res.json())).not.toContain(`${y}-01-01`);
    expect(res.json().screenShare).not.toHaveProperty('birthDate');
  });

  it('adulto sem termo -> reason consent; versao errada -> 400; versao atual libera; revogacao volta', async () => {
    const age = await app.inject({ method: 'PUT', url: '/api/me/age', headers: auth(), payload: { birthDate: '1990-06-15' } });
    expect(age.json()).toMatchObject({ isAdult: true, screenShare: { allowed: false, reason: 'consent' } });

    const wrong = await app.inject({ method: 'PUT', url: '/api/me/screen-share-consent', headers: auth(), payload: { version: '1999-01' } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().currentVersion).toBe(SCREEN_SHARE_CONSENT_VERSION);

    const ok = await app.inject({ method: 'PUT', url: '/api/me/screen-share-consent', headers: auth(), payload: { version: SCREEN_SHARE_CONSENT_VERSION } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().screenShare).toEqual({ ageVerified: true, isAdult: true, consentVersion: SCREEN_SHARE_CONSENT_VERSION, allowed: true, reason: 'ok' });

    const revoke = await app.inject({ method: 'DELETE', url: '/api/me/screen-share-consent', headers: auth() });
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().screenShare).toMatchObject({ consentVersion: null, allowed: false, reason: 'consent' });

    const delAge = await app.inject({ method: 'DELETE', url: '/api/me/age', headers: auth() });
    expect(delAge.json().screenShare).toMatchObject({ ageVerified: false, isAdult: false, allowed: false, reason: 'age' });
    const row = await prisma.user.findUnique({ where: { id: userId } });
    expect(row?.birthDate).toBeNull();
    expect(row?.ageVerifiedAt).toBeNull();
  });

  it('PATCH /api/me (meSelect/toMe) devolve screenShare e nao birthDate', async () => {
    await app.inject({ method: 'PUT', url: '/api/me/age', headers: auth(), payload: { birthDate: '1990-06-15' } });
    const res = await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(), payload: { name: 'Gabi' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.screenShare).toMatchObject({ ageVerified: true, isAdult: true });
    expect(res.json().user).not.toHaveProperty('birthDate');
    expect(res.json().user).not.toHaveProperty('ageVerifiedAt');
  });

  it('GET /api/me/privacy/export: perfil sem passwordHash/birthDate, consentimento e eventos proprios', async () => {
    await prisma.moderationEvent.create({
      data: { kind: 'text', source: 'chat', userId, category: 'bullying', severity: 'medium', action: 'warned', excerpt: 'x' },
    });
    await prisma.moderationEvent.create({
      data: { kind: 'report', source: 'user', reporterId: userId, guestId: 'guest-secreto', category: 'hate', severity: 'medium', action: 'reported' },
    });
    const res = await app.inject({ method: 'GET', url: '/api/me/privacy/export', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    const body = res.json();
    const text = JSON.stringify(body);
    expect(text).not.toContain('segredo-hash');
    expect(text).not.toContain('1990-06-15');
    expect(text).not.toContain('guest-secreto');
    expect(body.profile).not.toHaveProperty('passwordHash');
    expect(body.profile).not.toHaveProperty('birthDate');
    expect(body.profile.screenShare.isAdult).toBe(true);
    expect(body.consent.ageVerifiedAt).toBeTruthy();
    expect(body.moderationEvents).toHaveLength(2);
    expect(body.moderationEvents.map((e: { role: string }) => e.role).sort()).toEqual(['reporter', 'subject']);
  });
});
