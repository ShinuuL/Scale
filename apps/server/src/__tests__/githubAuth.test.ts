/**
 * Login com GitHub: inicio (302 + state), callback (state anti-CSRF, conta
 * nova, conta vinculada, e-mail em uso, sem e-mail verificado, cancelamento)
 * e recurso desligado. A API do GitHub e simulada com um fetch falso.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { githubAuthRoutes } from '../routes/githubAuth.js';
import { verifyToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { redactUrl } from '../lib/logger.js';
import { resetGithubOAuthRateLimit, resetRegisterRateLimit } from '../lib/rateLimit.js';

const STAMP = Date.now();
const NEW_EMAIL = `gh-new-${STAMP}@exemplo.com`;
const TAKEN_EMAIL = `gh-taken-${STAMP}@exemplo.com`;
const GH_ID_NEW = 900_000_000 + (STAMP % 1_000_000);
const STATE_COOKIE = 'scale_gh_state';

interface FakeGithub {
  id: number;
  login: string;
  name: string | null;
  emails: Array<{ email: string; primary: boolean; verified: boolean }>;
  tokenOk?: boolean;
}

function stubGithub(gh: FakeGithub): ReturnType<typeof vi.fn> {
  const fake = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.startsWith('https://github.com/login/oauth/access_token')) {
      return json(gh.tokenOk === false ? { error: 'bad_verification_code' } : { access_token: 'gho_x', token_type: 'bearer' });
    }
    if (url === 'https://api.github.com/user') return json({ id: gh.id, login: gh.login, name: gh.name });
    if (url === 'https://api.github.com/user/emails') return json(gh.emails);
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

describe('login com GitHub', () => {
  let app: FastifyInstance;

  /** Inicia o fluxo e devolve o state emitido (cookie) para usar no callback. */
  async function start(): Promise<string> {
    const res = await app.inject({ method: 'GET', url: '/api/auth/github' });
    expect(res.statusCode).toBe(302);
    const c = res.cookies.find((x) => x.name === STATE_COOKIE);
    expect(c?.value).toBeTruthy();
    return c!.value;
  }

  function callback(query: string, state?: string) {
    return app.inject({
      method: 'GET',
      url: `/api/auth/github/callback?${query}`,
      headers: state ? { cookie: `${STATE_COOKIE}=${state}` } : {},
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.GITHUB_CLIENT_ID = 'cid';
    process.env.GITHUB_CLIENT_SECRET = 'csecret';
    process.env.PUBLIC_URL = 'https://scale.exemplo.com:8443/';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(githubAuthRoutes);
    await app.ready();
    await prisma.user.create({ data: { email: TAKEN_EMAIL, passwordHash: 'x', name: 'Dono' } });
  });

  beforeEach(() => {
    resetGithubOAuthRateLimit('127.0.0.1');
    resetRegisterRateLimit('127.0.0.1');
  });

  afterEach(() => vi.unstubAllGlobals());

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [NEW_EMAIL, TAKEN_EMAIL] } } });
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.PUBLIC_URL;
    await app.close();
  });

  it('providers indica github ligado', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(res.json()).toEqual({ github: true, google: false });
  });

  it('inicio redireciona ao GitHub com state, escopos e redirect_uri sem barra dupla', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/github' });
    const loc = new URL(res.headers.location as string);
    expect(loc.origin + loc.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(loc.searchParams.get('client_id')).toBe('cid');
    expect(loc.searchParams.get('redirect_uri')).toBe('https://scale.exemplo.com:8443/api/auth/github/callback');
    expect(loc.searchParams.get('scope')).toBe('read:user user:email');
    const c = res.cookies.find((x) => x.name === STATE_COOKIE);
    expect(loc.searchParams.get('state')).toBe(c?.value);
    expect(c?.httpOnly).toBe(true);
    expect(String(c?.sameSite).toLowerCase()).toBe('lax');
  });

  it('callback sem cookie de state (CSRF) e recusado sem chamar o GitHub', async () => {
    const fake = stubGithub({ id: GH_ID_NEW, login: 'x', name: null, emails: [] });
    const res = await callback('code=abc&state=forjado');
    expect(res.headers.location).toBe('/login?github=falhou');
    expect(fake).not.toHaveBeenCalled();
  });

  it('callback com state diferente do cookie e recusado', async () => {
    const fake = stubGithub({ id: GH_ID_NEW, login: 'x', name: null, emails: [] });
    await start();
    const res = await callback('code=abc&state=outro', 'o-do-cookie');
    expect(res.headers.location).toBe('/login?github=falhou');
    expect(fake).not.toHaveBeenCalled();
  });

  it('usuario cancelou no GitHub -> cancelado', async () => {
    const state = await start();
    const res = await callback(`error=access_denied&state=${state}`, state);
    expect(res.headers.location).toBe('/login?github=cancelado');
  });

  it('code recusado pelo GitHub -> falhou', async () => {
    stubGithub({ id: GH_ID_NEW, login: 'x', name: null, emails: [], tokenOk: false });
    const state = await start();
    const res = await callback(`code=ruim&state=${state}`, state);
    expect(res.headers.location).toBe('/login?github=falhou');
  });

  it('sem e-mail primario verificado -> sem_email', async () => {
    stubGithub({
      id: GH_ID_NEW, login: 'semmail', name: null,
      emails: [{ email: NEW_EMAIL, primary: true, verified: false }],
    });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/login?github=sem_email');
  });

  it('e-mail ja cadastrado sem vinculo NAO e vinculado sozinho', async () => {
    stubGithub({
      id: GH_ID_NEW + 1, login: 'intruso', name: null,
      emails: [{ email: TAKEN_EMAIL.toUpperCase(), primary: true, verified: true }],
    });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/login?github=email_em_uso');
    expect(res.cookies.find((c) => c.name === 'token')).toBeUndefined();
    expect(await prisma.githubAccount.count({ where: { githubId: String(GH_ID_NEW + 1) } })).toBe(0);
  });

  it('conta nova: cria usuario vinculado e emite a sessao', async () => {
    stubGithub({
      id: GH_ID_NEW, login: 'novato', name: 'Novo Usuario',
      emails: [
        { email: `outro-${STAMP}@exemplo.com`, primary: false, verified: true },
        { email: NEW_EMAIL, primary: true, verified: true },
      ],
    });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/');
    const session = res.cookies.find((c) => c.name === 'token');
    expect(session?.httpOnly).toBe(true);
    expect(String(session?.sameSite).toLowerCase()).toBe('strict');
    const user = await prisma.user.findUnique({ where: { email: NEW_EMAIL }, include: { githubAccount: true } });
    expect(user?.name).toBe('Novo Usuario');
    expect(user?.githubAccount?.login).toBe('novato');
    expect(verifyToken(session!.value).userId).toBe(user?.id);
    // state de uso unico: o cookie e apagado no callback.
    expect(res.cookies.find((c) => c.name === STATE_COOKIE)?.value).toBe('');
  });

  it('conta ja vinculada: entra nela e atualiza o login do GitHub', async () => {
    stubGithub({ id: GH_ID_NEW, login: 'renomeado', name: 'Outro Nome', emails: [] });
    const state = await start();
    const res = await callback(`code=ok&state=${state}`, state);
    expect(res.headers.location).toBe('/');
    const user = await prisma.user.findUnique({ where: { email: NEW_EMAIL }, include: { githubAccount: true } });
    expect(verifyToken(res.cookies.find((c) => c.name === 'token')!.value).userId).toBe(user?.id);
    expect(user?.githubAccount?.login).toBe('renomeado');
    expect(user?.name).toBe('Novo Usuario'); // nome do Scale nao e sobrescrito
  });

  it('code e state nunca aparecem no log', () => {
    expect(redactUrl('/api/auth/github/callback?code=segredo&state=abc')).toBe(
      '/api/auth/github/callback?code=[REDACTED]&state=[REDACTED]',
    );
  });

  it('recurso desligado sem configuracao', async () => {
    delete process.env.GITHUB_CLIENT_SECRET;
    const providers = await app.inject({ method: 'GET', url: '/api/auth/providers' });
    expect(providers.json()).toEqual({ github: false, google: false });
    const res = await app.inject({ method: 'GET', url: '/api/auth/github' });
    expect(res.headers.location).toBe('/login?github=desligado');
    process.env.GITHUB_CLIENT_SECRET = 'csecret';
  });
});
