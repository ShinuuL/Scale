import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { corsPlugin } from '../plugins/cors.js';
import { helmetPlugin } from '../plugins/helmet.js';
import { resetEnv } from '../lib/env.js';

/**
 * Achado 2 (Etapa 5) — CORS e CSP precisam valer para as rotas da aplicação.
 *
 * Regressão: corsPlugin/helmetPlugin eram plugins SEM `skip-override`, então os
 * hooks iam para um contexto filho. As rotas vivem em contextos irmãos e
 * respondiam SEM `access-control-allow-origin`, SEM CSP e SEM X-Frame-Options.
 *
 * A montagem abaixo espelha server.ts: os plugins no escopo raiz e a rota num
 * plugin irmão (contexto filho) — exatamente o cenário que falhava.
 */
const ALLOWED = 'http://localhost:3000';

async function healthRoutes(fastify: Fastify.FastifyInstance): Promise<void> {
  fastify.get('/api/health', async () => ({ status: 'ok' }));
}

describe('CORS/CSP aplicados às rotas da aplicação', () => {
  let app: Fastify.FastifyInstance;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.ALLOWED_ORIGINS = ALLOWED;
    process.env.NODE_ENV = 'test';
    // getEnv() cacheia em nível de módulo; resetEnv força releitura limpa.
    resetEnv();

    app = Fastify({ logger: false });
    await app.register(corsPlugin);
    await app.register(helmetPlugin);
    await app.register(healthRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ALLOWED_ORIGINS;
    resetEnv();
  });

  it('origin permitida → access-control-allow-origin + CSP + X-Frame-Options', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: ALLOWED },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('origin NÃO permitida → sem access-control-allow-origin (whitelist fechada)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://evil.example' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    // CSP e anti-clickjacking NÃO dependem da origin: continuam presentes.
    expect(String(res.headers['content-security-policy'])).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('preflight da origin permitida responde com ACAO', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/api/health',
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'GET',
      },
    });

    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });
});