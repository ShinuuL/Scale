import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';
import { hashPassword } from '../lib/auth.js';
import { findUserByEmail } from '../lib/userEmail.js';

/**
 * Normalizacao de email (regressão reproduzida em dev).
 *
 * Antes: o register gravava o email CRU (`CriticProbe@Example.com`) e o login
 * procurava `trim().toLowerCase()` — no SQLite a coluna é `TEXT UNIQUE` com
 * comparação BINARY, então a conta NUNCA logava:
 *   register {email:"CriticProbe@Example.com"} -> 201
 *   login    {"CriticProbe@Example.com"}       -> 401
 *   login    {"criticprobe@example.com"}       -> 401
 *
 * Agora o schema normaliza no parse (registro e login), a checagem de
 * duplicidade usa a mesma forma canônica e linhas legadas (gravadas cruas) são
 * lidas por `lower(email)` e migradas no primeiro login válido.
 */

/** Constrói o app como os testes de auth: plugins + rotas reais, sem rede. */
function buildApp(): ReturnType<typeof Fastify> {
  return Fastify({ logger: false });
}

describe('email: normalizacao em registro/login/duplicidade + legado', () => {
  let app: ReturnType<typeof buildApp>;
  const created: string[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';

    app = buildApp();
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

  it('registra com maiusculas e loga com o MESMO texto e com minusculas', async () => {
    const mixed = `MixedCase-${Date.now()}@Example.COM`;
    const canonical = mixed.trim().toLowerCase();
    created.push(canonical);

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: mixed, password: 'pass12345', name: 'Mixed Case' },
    });
    expect(reg.statusCode).toBe(201);
    // A resposta (e o banco) ja saem na forma canonica.
    expect(JSON.parse(reg.payload).user.email).toBe(canonical);

    const sameText = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: mixed, password: 'pass12345' },
    });
    expect(sameText.statusCode).toBe(200);
    expect(JSON.parse(sameText.payload).user.email).toBe(canonical);

    const lower = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: canonical, password: 'pass12345' },
    });
    expect(lower.statusCode).toBe(200);
  });

  it('409 ao tentar registrar o mesmo email em outra caixa', async () => {
    const canonical = `dup-${Date.now()}@example.com`;
    created.push(canonical);

    const first = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: canonical, password: 'pass12345', name: 'Dup 1' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: canonical.toUpperCase(), password: 'pass12345', name: 'Dup 2' },
    });
    expect(second.statusCode).toBe(409);
  });

  it('le linhas legadas (email cru) e as normaliza no login', async () => {
    // Simula dado gravado antes da correcao: email com maiusculas direto no
    // banco, exatamente como o register antigo fazia.
    const raw = `Legacy-${Date.now()}@Example.com`;
    const legacy = await prisma.user.create({
      data: { email: raw, passwordHash: await hashPassword('pass12345'), name: 'Legacy' },
    });
    created.push(raw.trim().toLowerCase());

    // O login com minusculas precisa encontrar a linha legada.
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: raw.toLowerCase(), password: 'pass12345' },
    });
    expect(login.statusCode).toBe(200);

    // ...e o login valido migra o email para a forma canonica.
    const healed = await prisma.user.findUnique({ where: { id: legacy.id } });
    expect(healed?.email).toBe(raw.trim().toLowerCase());

    // O cadastro nao cria um irmao case-variant da linha legada.
    const dup = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: raw, password: 'pass12345', name: 'Legacy Dup' },
    });
    expect(dup.statusCode).toBe(409);

    const found = await prisma.user.findMany({ where: { id: legacy.id } });
    expect(found).toHaveLength(1);
  });

  it('findUserByEmail acha pelo email normalizado', async () => {
    const email = `Lookup-${Date.now()}@Example.com`;
    created.push(email.trim().toLowerCase());
    const lookupUser = await prisma.user.create({
      data: { email: email.trim().toLowerCase(), passwordHash: 'x', name: 'Lookup' },
    });

    const byMixed = await prisma.user.findUnique({ where: { email } });
    // Prova que o SQLite e BINARY (o valor cru nao casa)...
    expect(byMixed).toBeNull();
    // ...e que o helper normaliza antes de consultar.
    const found = await findUserByEmail(email);
    expect(found?.id).toBe(lookupUser.id);
  });
});
