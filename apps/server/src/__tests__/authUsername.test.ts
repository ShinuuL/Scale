import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';

/**
 * @nome no cadastro e login por e-mail OU @nome.
 */
describe('auth: @nome no cadastro e login por @nome', () => {
  const app = Fastify({ logger: false });
  const created: string[] = [];
  const suffix = Date.now().toString(36).slice(-6);
  const handle = `tst_${suffix}`;
  const email = `user-${suffix}@example.com`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(authRoutes);
    await app.ready();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: created } } }).catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it('o @nome aparece livre antes do cadastro', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/auth/username-available?username=@${handle.toUpperCase()}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ username: handle, available: true });
  });

  it('recusa @nome com formato invalido na checagem', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/username-available?username=a!' });
    expect(res.statusCode).toBe(400);
  });

  it('cadastra com @nome e grava o nome normalizado', async () => {
    created.push(email);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'pass12345', name: 'Teste', username: `@${handle.toUpperCase()}` },
    });
    expect(res.statusCode).toBe(201);
    const row = await prisma.username.findUnique({ where: { name: handle } });
    expect(row?.userId).toBe(res.json().user.id);
  });

  it('depois do cadastro o @nome aparece ocupado', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/auth/username-available?username=${handle}` });
    expect(res.json().available).toBe(false);
  });

  it('recusa outro cadastro com o mesmo @nome (409) sem criar a conta', async () => {
    const other = `other-${suffix}@example.com`;
    created.push(other);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: other, password: 'pass12345', name: 'Outro', username: handle },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('Username already taken');
    expect(await prisma.user.findUnique({ where: { email: other } })).toBeNull();
  });

  it('cadastro sem @nome continua aceito (escolhe depois)', async () => {
    const plain = `plain-${suffix}@example.com`;
    created.push(plain);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: plain, password: 'pass12345', name: 'Sem nome' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('loga com o @nome (com ou sem "@", qualquer caixa)', async () => {
    for (const login of [handle, `@${handle}`, handle.toUpperCase()]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: login, password: 'pass12345' },
      });
      expect(res.statusCode, login).toBe(200);
      expect(res.json().user.email).toBe(email);
    }
  });

  it('continua logando com o e-mail', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'pass12345' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('@nome inexistente e senha errada dao a mesma resposta 401', async () => {
    const wrongPass = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: handle, password: 'errada123' },
    });
    const noUser = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: `nx_${suffix}`, password: 'errada123' },
    });
    expect(wrongPass.statusCode).toBe(401);
    expect(noUser.statusCode).toBe(401);
    expect(noUser.json()).toEqual(wrongPass.json());
  });
});
