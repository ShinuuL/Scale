import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';
import { roomRoutes } from '../routes/rooms.js';
import { turnRoutes } from '../routes/turn.js';
import { filesRoutes } from '../routes/files.js';

/**
 * Hardening da Etapa 4 — o app deixou de ser "Tailnet only" e passou a ser
 * alcançável por túnel público. Cobre os baldes por IP do auth, o balde por
 * email do login, o rate limit de upload e o gate de login em
 * GET /api/turn/credentials.
 *
 * Os baldes por IP ignoram loopback (dev/E2E) — por isso os testes de 429 por
 * IP usam um `remoteAddress` público explícito. O balde por email NÃO é isento,
 * então o teste dele roda no loopback padrão.
 */

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
  await app.register(authRoutes);
  await app.register(roomRoutes);
  await app.register(turnRoutes);
  await app.register(filesRoutes);
  return app;
}

/** Multipart body builder (zero-dep) — mesmo padrão de files.test.ts. */
function multipartBody(
  files: Array<{ filename: string; contentType: string; content: Buffer }>,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----scale${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  const push = (s: string): void => {
    chunks.push(Buffer.from(s, 'utf8'));
  };
  for (const f of files) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`,
    );
    chunks.push(f.content);
    push('\r\n');
  }
  push(`--${boundary}--\r\n`);
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter++;
  return `${prefix}-${Date.now()}-${emailCounter}@hardening.test`;
}

const LOGIN_ATTEMPTS = 11; // 10 permitidas + a que estoura
const REGISTER_ATTEMPTS = 6; // 5 permitidas + a que estoura
const UPLOAD_ATTEMPTS = 31; // 30 permitidas + a que estoura

// IPs públicos reservados p/ documentação (RFC 5737) — nunca loopback.
const IP_LOGIN = '198.51.100.10';
const IP_REGISTER = '198.51.100.20';
const IP_TURN = '198.51.100.30';
const IP_UPLOAD = '198.51.100.40';

describe('Etapa 4 — hardening de exposição pública', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let auth: { authorization: string };
  let ownerEmail: string;
  let persistRoomId: string;
  // Users criados pelo teste de register (para limpar depois).
  const createdEmails: string[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await prisma.$connect();

    // Usuário base para login/turn (email único, sem wipe global).
    ownerEmail = uniqueEmail('hardening-owner');
    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: ownerEmail, password: 'pass12345', name: 'Owner' },
    });
    expect(reg.statusCode).toBe(201);
    auth = { authorization: `Bearer ${JSON.parse(reg.payload).token}` };

    const persist = await prisma.room.create({
      data: { name: 'Hardening Upload', isPersistent: true, ownerId: null },
    });
    persistRoomId = persist.id;
  });

  afterAll(async () => {
    await prisma.room
      .deleteMany({ where: { name: 'Hardening Upload' } })
      .catch(() => {});
    await prisma.user
      .deleteMany({
        where: { email: { in: [ownerEmail, ...createdEmails].filter(Boolean) } },
      })
      .catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it('login: 10/5min por IP → 429 na 11ª com Retry-After', async () => {
    const results = [];
    for (let i = 0; i < LOGIN_ATTEMPTS; i += 1) {
      results.push(
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          remoteAddress: IP_LOGIN,
          // Emails distintos: isola o balde por IP do balde por email.
          payload: { email: uniqueEmail('login-ip'), password: 'senhaerrada' },
        }),
      );
    }

    // 10 primeiras: credencial inválida (401). Não vaza se a conta existe.
    expect(results.slice(0, 10).map((r) => r.statusCode)).toEqual(Array(10).fill(401));
    expect(JSON.parse(results[0].payload).error).toBe('Invalid credentials');

    // 11ª: barrada pelo balde por IP.
    expect(results[10].statusCode).toBe(429);
    expect(JSON.parse(results[10].payload)).toMatchObject({
      error: 'Too many login attempts. Try again later.',
    });
    expect(Number(results[10].headers['retry-after'])).toBeGreaterThan(0);
  });

  it('login: 10/5min por email (mesmo IP loopback) → 429 na 11ª', async () => {
    // remoteAddress padrão (127.0.0.1) isenta o balde por IP → o único balde que
    // pode barrar é o de email, que NÃO é isento de loopback (protege a conta
    // de credential stuffing distribuído).
    const email = uniqueEmail('login-email');
    const results = [];
    for (let i = 0; i < LOGIN_ATTEMPTS; i += 1) {
      results.push(
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email, password: 'senhaerrada' },
        }),
      );
    }

    expect(results.slice(0, 10).map((r) => r.statusCode)).toEqual(Array(10).fill(401));
    expect(results[10].statusCode).toBe(429);
    expect(JSON.parse(results[10].payload)).toMatchObject({
      error: 'Too many login attempts. Try again later.',
    });
  });

  it('register: 5/hora por IP → 429 na 6ª', async () => {
    const results = [];
    for (let i = 0; i < REGISTER_ATTEMPTS; i += 1) {
      const email = uniqueEmail('reg');
      createdEmails.push(email);
      results.push(
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          remoteAddress: IP_REGISTER,
          payload: { email, password: 'pass12345', name: `Reg ${i}` },
        }),
      );
    }

    expect(results.slice(0, 5).map((r) => r.statusCode)).toEqual(Array(5).fill(201));
    expect(results[5].statusCode).toBe(429);
    expect(JSON.parse(results[5].payload)).toMatchObject({
      error: 'Too many accounts created from this IP. Try again later.',
    });
    expect(Number(results[5].headers['retry-after'])).toBeGreaterThan(0);
  });

  it('GET /api/turn/credentials sem login → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/turn/credentials' });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).error).toBe('Authentication required');
  });

  it('GET /api/turn/credentials com login → 200 (STUN quando TURN desligado)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/turn/credentials',
      headers: auth,
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(Array.isArray(body.iceServers)).toBe(true);
    expect(body.turnEnabled).toBe(false);
  });

  it('GET /api/turn/credentials: 30/min por IP → 429 na 31ª', async () => {
    const results = [];
    for (let i = 0; i < UPLOAD_ATTEMPTS; i += 1) {
      results.push(
        await app.inject({
          method: 'GET',
          url: '/api/turn/credentials',
          remoteAddress: IP_TURN,
          headers: auth,
        }),
      );
    }

    expect(results.slice(0, 30).map((r) => r.statusCode)).toEqual(Array(30).fill(200));
    expect(results[30].statusCode).toBe(429);
    expect(Number(results[30].headers['retry-after'])).toBeGreaterThan(0);
  });

  it('POST /:id/files: 30/min por IP → 429 na 31ª (sem afetar outro IP)', async () => {
    // Mime fora da allowlist → 400 (barato, não grava arquivo), mas cada chamada
    // consome o balde. Prova que o limite é checado antes de bufferizar/persistir.
    const upload = (remoteAddress: string) =>
      app.inject({
        method: 'POST',
        url: `/api/rooms/${persistRoomId}/files`,
        remoteAddress,
        ...multipartBody([
          {
            filename: 'evil.exe',
            contentType: 'application/x-msdownload',
            content: Buffer.from('MZ', 'utf8'),
          },
        ]),
      });

    const results = [];
    for (let i = 0; i < UPLOAD_ATTEMPTS; i += 1) {
      results.push(await upload(IP_UPLOAD));
    }

    expect(results.slice(0, 30).map((r) => r.statusCode)).toEqual(Array(30).fill(400));
    expect(results[30].statusCode).toBe(429);
    expect(JSON.parse(results[30].payload)).toMatchObject({
      error: 'Too many uploads. Try again later.',
    });
    expect(Number(results[30].headers['retry-after'])).toBeGreaterThan(0);

    // O balde é por IP: outro cliente continua sendo atendido normalmente.
    const other = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      remoteAddress: '198.51.100.41',
      ...multipartBody([
        { filename: 'ok.png', contentType: 'image/png', content: PNG },
      ]),
    });
    expect(other.statusCode).toBe(201);
  });
});
