import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';

/**
 * Logoff: o JWT fica num cookie HttpOnly, então só o servidor consegue apagá-lo.
 * `POST /api/auth/logout` expira o cookie `token` com os mesmos atributos da
 * criação (path, HttpOnly, SameSite=Strict); depois disso `GET /api/auth/me`
 * volta a responder como visitante.
 */
async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(authRoutes);
  return app;
}

function tokenCookie(setCookie: string | string[] | undefined): string | undefined {
  const all = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return all.find((c) => c.startsWith('token='));
}

describe('POST /api/auth/logout', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const email = `logout-${Date.now()}@scale.test`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests-logout-0001';
    app = await buildApp();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } }).catch(() => undefined);
    await app.close();
  });

  it('expira o cookie de sessão e a sessão deixa de valer', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'senha-logout-123', name: 'Logout' },
    });
    expect(reg.statusCode).toBe(201);
    const session = tokenCookie(reg.headers['set-cookie']);
    expect(session).toBeDefined();
    const sessionPair = session!.split(';')[0];

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: sessionPair } });
    expect(me.statusCode).toBe(200);

    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: sessionPair } });
    expect(out.statusCode).toBe(204);
    const cleared = tokenCookie(out.headers['set-cookie']);
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/^token=;/);
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    expect(cleared).toMatch(/Path=\//);
    expect(cleared).toMatch(/HttpOnly/);
    expect(cleared).toMatch(/SameSite=Strict/);
  });

  it('sem sessão também responde 204 (idempotente)', async () => {
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(out.statusCode).toBe(204);
  });
});
