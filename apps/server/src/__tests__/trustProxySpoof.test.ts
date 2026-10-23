import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';
import { resolveTrustProxy, getClientIp, isRateLimitExempt } from '../lib/clientIp.js';
import { getEnv, resetEnv } from '../lib/env.js';

/**
 * Anti-spoof do default `TRUST_PROXY=false` (fail-closed).
 *
 * Antes: o default era `true`, então o Fastify confiava no `X-Forwarded-For`
 * mais à esquerda — forjável. Com ele rotativo (ou `cf-connecting-ip`), cada
 * request caía num balde novo e NENHUM 429 acontecia (reproduzido em dev:
 * login 401×13, register 201×6, upload 404×31, sempre sem 429).
 *
 * Aqui o app é construído exatamente como o server.ts faz
 * (`trustProxy: resolveTrustProxy(process.env.TRUST_PROXY)`, com a env ausente)
 * e os headers são forjados em toda request: o balde precisa continuar sendo o
 * mesmo (o IP do socket) e o 429 tem que aparecer.
 */

/** IP público reservado p/ documentação (RFC 5737) — nunca loopback. */
const IP_LOGIN = '198.51.100.77';
const IP_REGISTER = '198.51.100.78';

const LOGIN_ATTEMPTS = 11; // 10 permitidas + a que estoura
const REGISTER_ATTEMPTS = 6; // 5 permitidas + a que estoura

/** Headers forjados, sempre rotativos: nenhum deles pode virar chave de balde. */
function forgedHeaders(i: number): Record<string, string> {
  return {
    'x-forwarded-for': `203.0.113.${(i % 250) + 1}`,
    'cf-connecting-ip': `192.0.2.${(i % 250) + 1}`,
    'x-real-ip': `198.18.0.${(i % 250) + 1}`,
  };
}

let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter += 1;
  return `${prefix}-${Date.now()}-${emailCounter}@spoof.test`;
}

/** Request falsa mínima para exercitar getClientIp sem HTTP. */
function fakeRequest(opts: {
  socketIp: string;
  ip: string;
  headers?: Record<string, string>;
}): FastifyRequest {
  return {
    ip: opts.ip,
    socket: { remoteAddress: opts.socketIp },
    headers: opts.headers ?? {},
  } as unknown as FastifyRequest;
}

/** Mesma construção de server.ts: TRUST_PROXY ausente => fail-closed. */
function buildApp(): ReturnType<typeof Fastify> {
  const app = Fastify({
    logger: false,
    trustProxy: resolveTrustProxy(process.env.TRUST_PROXY),
  });
  return app;
}

describe('default TRUST_PROXY=false — anti-spoof dos baldes por IP', () => {
  let app: ReturnType<typeof buildApp>;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    delete process.env.TRUST_PROXY;
    resetEnv();

    app = buildApp();
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(authRoutes);
    await app.ready();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.user
      .deleteMany({ where: { email: { in: createdEmails } } })
      .catch(() => {});
    await app.close();
    await prisma.$disconnect();
  });

  it('resolveTrustProxy: vazio/false => false (default fail-closed)', () => {
    expect(resolveTrustProxy(undefined)).toBe(false);
    expect(resolveTrustProxy('')).toBe(false);
    expect(resolveTrustProxy('  ')).toBe(false);
    expect(resolveTrustProxy('false')).toBe(false);
    // `true` só quando pedido explicitamente; CIDRs viram lista.
    expect(resolveTrustProxy('true')).toBe(true);
    expect(resolveTrustProxy('loopback')).toEqual(['loopback']);
    expect(resolveTrustProxy('127.0.0.1/8, ::1/128')).toEqual(['127.0.0.1/8', '::1/128']);
    expect(() => resolveTrustProxy('2')).toThrow(/TRUST_PROXY inválido/);
  });

  it('env.TRUST_PROXY assume "false" quando a variavel nao existe', () => {
    delete process.env.TRUST_PROXY;
    resetEnv();
    expect(getEnv().TRUST_PROXY).toBe('false');
  });

  it('getClientIp: sem proxy confiavel o IP e o do socket, headers sao ignorados', () => {
    // trustProxy=false => o Fastify mantem request.ip = peer; mesmo com os
    // headers forjados preenchidos, a chave do balde e o peer.
    const peer = '198.51.100.90';
    expect(
      getClientIp(
        fakeRequest({
          socketIp: peer,
          ip: peer,
          headers: forgedHeaders(1),
        }),
      ),
    ).toBe(peer);
  });

  it('login: XFF/cf-connecting-ip/x-real-ip rotativos nao furam o balde → 429 na 11ª', async () => {
    const results = [];
    for (let i = 0; i < LOGIN_ATTEMPTS; i += 1) {
      results.push(
        await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          remoteAddress: IP_LOGIN,
          headers: forgedHeaders(i),
          // Emails distintos: isola o balde por IP do balde por email.
          payload: { email: uniqueEmail('spoof-login'), password: 'senhaerrada' },
        }),
      );
    }

    expect(results.slice(0, 10).map((r) => r.statusCode)).toEqual(Array(10).fill(401));
    expect(results[10].statusCode).toBe(429);
    expect(JSON.parse(results[10].payload)).toMatchObject({
      error: 'Too many login attempts. Try again later.',
    });
    expect(Number(results[10].headers['retry-after'])).toBeGreaterThan(0);
  });

  it('register: headers rotativos nao furam o balde → 429 na 6ª', async () => {
    const results = [];
    for (let i = 0; i < REGISTER_ATTEMPTS; i += 1) {
      const email = uniqueEmail('spoof-reg');
      createdEmails.push(email);
      results.push(
        await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          remoteAddress: IP_REGISTER,
          headers: forgedHeaders(i),
          payload: { email, password: 'pass12345', name: `Spoof ${i}` },
        }),
      );
    }

    expect(results.slice(0, 5).map((r) => r.statusCode)).toEqual(Array(5).fill(201));
    expect(results[5].statusCode).toBe(429);
  });

  it('isencao de loopback vale fora de producao e NAO vale em producao', () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'development';
      expect(isRateLimitExempt('127.0.0.1')).toBe(true);
      expect(isRateLimitExempt('::ffff:127.0.0.1')).toBe(true);
      expect(isRateLimitExempt('198.51.100.10')).toBe(false);

      // Producao atras de tunel no mesmo host: TODOS os requests chegam como
      // 127.0.0.1 — isentar aqui desligaria todos os baldes por IP.
      process.env.NODE_ENV = 'production';
      expect(isRateLimitExempt('127.0.0.1')).toBe(false);
      expect(isRateLimitExempt('::1')).toBe(false);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
