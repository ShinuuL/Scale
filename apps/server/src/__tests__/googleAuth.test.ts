/**
 * Login com Google: inicio (302 + state), callback (state anti-CSRF, conta
 * nova, conta vinculada, e-mail em uso, e-mail nao verificado, cancelamento,
 * code recusado) e recurso desligado. A API do Google e simulada com fetch falso.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { googleAuthRoutes } from '../routes/oauthAuth.js';
import { githubAuthRoutes } from '../routes/oauthAuth.js';
import { signToken, verifyToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetGoogleOAuthRateLimit, resetRegisterRateLimit } from '../lib/rateLimit.js';

const STAMP = Date.now();
const NEW_EMAIL = `go-new-${STAMP}@exemplo.com`;
const TAKEN_EMAIL = `go-taken-${STAMP}@exemplo.com`;
const SUB_NEW = `sub-new-${STAMP}`;
const STATE_COOKIE = 'scale_google_state';

interface FakeGoogle {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  tokenOk?: boolean;
}

function stubGoogle(g: FakeGoogle): ReturnType<typeof vi.fn> {
  const fake = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url === 'https://oauth2.googleapis.com/token') {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') !== 'authorization_code') return json({ error: 'unsupported_grant_type' }, 400);
      return g.tokenOk === false ? json({ error: 'invalid_grant' }, 400) : json({ access_token: 'ya29.x', token_type: 'Bearer' });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return json({ sub: g.sub, email: g.email, email_verified: g.emailVerified, name: g.name });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

describe('login com Google', () => {
  let app: FastifyInstance;

  async function start(): Promise<string> {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google' });
    expect(res.statusCode).toBe(302);
    const c = res.cookies.find((x) => x.name === STATE_COOKIE);
    expect(c?.value).toBeTruthy();
    return c!.value;
  }

  function callback(query: string, state?: string) {
    return app.inject({
      method: 'GET',
      url: `/api/auth/google/callback?${query}`,
      headers: state ? { cookie: `${STATE_COOKIE}=${state}` } : {},
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.GOOGLE_CLIENT_ID = 'gcid';
    process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
    process.env.PUBLIC_URL = 'https://scale.exemplo.com:8443/';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(githubAuthRoutes);
    await app.register(googleAuthRoutes);
    await app.ready();
    await prisma.user.create({ data: { email: TAKEN_EMAIL, passwordHash: 'x', name: 'Dono' } });
  });

  beforeEach(() => {
    resetGoogleOAuthRateLimit('127.0.0.1');
    resetRegisterRateLimit('127.0.0.1');
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [NEW_EMAIL, TAKEN_EMAIL] } } });
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.PUBLIC_URL;
    await app.close();
  });

  it('providers indica google ligado', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(res.json()).toEqual({ github: false, google: true });
  });

  it('inicio redireciona ao Google com state, escopos e redirect_uri', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/google' });
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(loc.searchParams.get('client_id')).toBe('gcid');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://scale.exemplo.com:8443/api/auth/google/callback');
    expect(loc.searchParams.get('response_type')).toBe('code');
    expect(loc.searchParams.get('scope')).toBe('openid email profile');
    const c = res.cookies.find((x) => x.name === STATE_COOKIE);
    expect(loc.searchParams.get('state')).toBe(c?.value);
    expect(c?.httpOnly).toBe(true);
    expect(String(c?.sameSite).toLowerCase()).toBe('lax');
  });

  it('callback sem cookie de state (CSRF) e recusado sem chamar o Google', async () => {
    const fake = stubGoogle({ sub: SUB_NEW });
    const res = await callback('code=abc&state=forjado');
    expect(res.headers.location).toBe('/login?google=falhou');
    expect(fake).not.toHaveBeenCalled();
  });

  it('usuario cancelou no Google -> cancelado', async () => {
    const state = await start();
    const res = await callback(`error=access_denied&state=${state}`, state);
    expect(res.headers.location).toBe('/login?google=cancelado');
  });

  it('code recusado (invalid_grant) -> falhou', async () => {
    stubGoogle({ sub: SUB_NEW, tokenOk: false });
    const state = await start();
    const res = await callback(`code=ruim&state=${state}`, state);
    expect(res.headers.location).toBe('/login?google=falhou');
  });

  it('e-mail nao verificado -> sem_email', async () => {
    stubGoogle({ sub: SUB_NEW, email: NEW_EMAIL, emailVerified: false });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/login?google=sem_email');
  });

  it('e-mail ja cadastrado: vincula automaticamente pelo e-mail verificado e entra', async () => {
    stubGoogle({ sub: `${SUB_NEW}-x`, email: TAKEN_EMAIL.toUpperCase(), emailVerified: true });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/');
    const owner = await prisma.user.findUnique({ where: { email: TAKEN_EMAIL }, include: { googleAccount: true } });
    expect(verifyToken(res.cookies.find((c) => c.name === 'token')!.value).userId).toBe(owner?.id);
    expect(owner?.googleAccount?.googleId).toBe(`${SUB_NEW}-x`);
  });

  it('e-mail de conta que ja tem OUTRO Google vinculado -> outra_conta', async () => {
    stubGoogle({ sub: `${SUB_NEW}-y`, email: TAKEN_EMAIL, emailVerified: true });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/login?google=outra_conta');
    expect(res.cookies.find((c) => c.name === 'token')).toBeUndefined();
  });

  it('conta nova: cria usuario vinculado e emite a sessao', async () => {
    stubGoogle({ sub: SUB_NEW, email: NEW_EMAIL, emailVerified: true, name: 'Nova Pessoa' });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/');
    const session = res.cookies.find((c) => c.name === 'token');
    expect(session?.httpOnly).toBe(true);
    expect(String(session?.sameSite).toLowerCase()).toBe('strict');
    const user = await prisma.user.findUnique({ where: { email: NEW_EMAIL }, include: { googleAccount: true } });
    expect(user?.name).toBe('Nova Pessoa');
    expect(user?.googleAccount?.googleId).toBe(SUB_NEW);
    expect(verifyToken(session!.value).userId).toBe(user?.id);
    expect(res.cookies.find((c) => c.name === STATE_COOKIE)?.value).toBe('');
  });

  it('conta ja vinculada: entra nela pelo sub, mesmo com outro e-mail no Google', async () => {
    stubGoogle({ sub: SUB_NEW, email: `trocado-${STAMP}@exemplo.com`, emailVerified: true, name: 'Outro' });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/');
    const user = await prisma.user.findUnique({ where: { email: NEW_EMAIL } });
    expect(verifyToken(res.cookies.find((c) => c.name === 'token')!.value).userId).toBe(user?.id);
    expect(user?.name).toBe('Nova Pessoa');
  });

  describe('vinculo pela sessao (Configuracoes)', () => {
    const LINK_EMAIL = `go-link-${STAMP}@exemplo.com`;
    let linkUserId = '';
    let session = '';

    beforeAll(async () => {
      const u = await prisma.user.create({ data: { email: LINK_EMAIL, passwordHash: 'x', name: 'Logado' } });
      linkUserId = u.id;
      session = signToken({ userId: u.id, email: u.email, name: u.name });
    });
    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email: LINK_EMAIL } });
    });

    async function startLink(): Promise<string> {
      const res = await app.inject({ method: 'GET', url: '/api/auth/google/link', headers: { cookie: `token=${session}` } });
      expect(new URL(res.headers.location as string).origin).toBe('https://accounts.google.com');
      return res.cookies.find((x) => x.name === STATE_COOKIE)!.value;
    }

    it('sem sessao manda para o login', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/auth/google/link' });
      expect(res.headers.location).toBe('/login');
    });

    it('vincula conta Google com e-mail DIFERENTE ao usuario logado', async () => {
      stubGoogle({ sub: `${SUB_NEW}-link`, email: `pessoal-${STAMP}@gmail.test`, emailVerified: true });
      const state = await startLink();
      const res = await callback(`code=ok&state=${state}`, state);
      expect(res.headers.location).toBe('/?vinculo=google.ok');
      expect(await prisma.googleAccount.findUnique({ where: { googleId: `${SUB_NEW}-link` } })).toMatchObject({ userId: linkUserId });
      // Vinculo nao troca a sessao.
      expect(res.cookies.find((c) => c.name === 'token')).toBeUndefined();
      const links = await app.inject({ method: 'GET', url: '/api/me/links', headers: { cookie: `token=${session}` } });
      expect(links.json()).toEqual({ github: null, google: true });
    });

    it('Google ja vinculado a OUTRO usuario -> outra_conta, sem mudar dono', async () => {
      stubGoogle({ sub: SUB_NEW, email: NEW_EMAIL, emailVerified: true });
      const state = await startLink();
      const res = await callback(`code=ok&state=${state}`, state);
      expect(res.headers.location).toBe('/?vinculo=google.outra_conta');
      const owner = await prisma.user.findUnique({ where: { email: NEW_EMAIL } });
      expect(await prisma.googleAccount.findUnique({ where: { googleId: SUB_NEW } })).toMatchObject({ userId: owner?.id });
    });

    it('intencao de vinculo nao vale com state forjado', async () => {
      const fake = stubGoogle({ sub: `${SUB_NEW}-z`, email: 'x@exemplo.com', emailVerified: true });
      const state = await startLink();
      const res = await callback(`code=ok&state=${state}`, 'outro-cookie');
      expect(res.headers.location).toBe('/login?google=falhou');
      expect(fake).not.toHaveBeenCalled();
    });
  });

  it('recurso desligado sem configuracao', async () => {
    delete process.env.GOOGLE_CLIENT_SECRET;
    const providers = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(providers.json()).toEqual({ github: false, google: false });
    const res = await app.inject({ method: 'GET', url: '/api/auth/google' });
    expect(res.headers.location).toBe('/login?google=desligado');
    process.env.GOOGLE_CLIENT_SECRET = 'gsecret';
  });
});
