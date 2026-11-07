/**
 * Login externo (GitHub, Google) — uma fabrica de rotas, um adaptador por provedor.
 *
 *   GET /api/auth/providers            -> { github, google }  (botoes do front)
 *   GET /api/me/links                  -> contas vinculadas do usuario logado
 *   GET /api/auth/<p>                  -> 302 ao provedor (login/cadastro)
 *   GET /api/auth/<p>/link             -> 302 ao provedor (vincular a conta logada)
 *   GET /api/auth/<p>/callback         -> valida `state`, le a identidade e
 *                                         entra (login) ou vincula (link)
 *
 * Regras de conta: lib/oauthAccount.ts.
 *
 * `state` anti-CSRF: cookie HttpOnly SameSite=Lax (o callback e navegacao
 * vinda do provedor; Strict nao seria enviado), `__Host-` em producao (site
 * irmao nao planta um state), uso unico, 10 min, comparado em tempo constante.
 *
 * Fim do fluxo: sempre 302 — login: `/` ou `/login?<p>=<codigo>`;
 * vinculo: `/?vinculo=<p>.<status>`.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { signToken, verifyToken } from '../lib/auth.js';
import { getEnv } from '../lib/env.js';
import { getClientIp } from '../lib/clientIp.js';
import type { RateLimitResult } from '../lib/rateLimit.js';
import { isGithubOAuthRateLimited, isGoogleOAuthRateLimited } from '../lib/rateLimit.js';
import {
  GITHUB_CALLBACK_PATH,
  GithubApiError,
  buildGithubAuthorizeUrl,
  exchangeGithubCode,
  fetchGithubIdentity,
  getGithubConfig,
} from '../lib/github.js';
import {
  GOOGLE_CALLBACK_PATH,
  GoogleApiError,
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  fetchGoogleIdentity,
  getGoogleConfig,
} from '../lib/google.js';
import {
  type OAuthIdentity,
  type OAuthProvider,
  type SessionUser,
  getLinkedAccounts,
  linkOAuthAccount,
  rememberLinkIntent,
  resolveOAuthLogin,
  takeLinkIntent,
} from '../lib/oauthAccount.js';

const STATE_TTL_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Codigos que o frontend (/login?<p>=<codigo>) traduz em mensagem. */
export type OAuthLoginErrorCode = 'cancelado' | 'falhou' | 'outra_conta' | 'sem_email' | 'limite' | 'desligado';
/** Resultado do vinculo (/?vinculo=<p>.<status>). */
export type OAuthLinkResult = 'ok' | 'outra_conta' | 'ja_vinculado' | 'cancelado' | 'falhou' | 'limite';

interface ProviderAdapter {
  provider: OAuthProvider;
  callbackPath: string;
  stateCookie: string;
  isRateLimited: (ip: string) => RateLimitResult;
  isApiError: (err: unknown) => boolean;
  /** null = recurso desligado. */
  authorizeUrl: (state: string) => string | null;
  /** null = code recusado pelo provedor. */
  identify: (code: string) => Promise<OAuthIdentity | null>;
}

const githubAdapter: ProviderAdapter = {
  provider: 'github',
  callbackPath: GITHUB_CALLBACK_PATH,
  stateCookie: 'scale_gh_state',
  isRateLimited: isGithubOAuthRateLimited,
  isApiError: (err) => err instanceof GithubApiError,
  authorizeUrl: (state) => {
    const config = getGithubConfig();
    return config ? buildGithubAuthorizeUrl(config, state) : null;
  },
  identify: async (code) => {
    const config = getGithubConfig();
    if (!config) return null;
    const token = await exchangeGithubCode(config, code);
    if (!token) return null;
    const gh = await fetchGithubIdentity(token);
    return { provider: 'github', providerId: gh.githubId, login: gh.login, name: gh.name, email: gh.email };
  },
};

const googleAdapter: ProviderAdapter = {
  provider: 'google',
  callbackPath: GOOGLE_CALLBACK_PATH,
  stateCookie: 'scale_google_state',
  isRateLimited: isGoogleOAuthRateLimited,
  isApiError: (err) => err instanceof GoogleApiError,
  authorizeUrl: (state) => {
    const config = getGoogleConfig();
    return config ? buildGoogleAuthorizeUrl(config, state) : null;
  },
  identify: async (code) => {
    const config = getGoogleConfig();
    if (!config) return null;
    const token = await exchangeGoogleCode(config, code);
    if (!token) return null;
    const g = await fetchGoogleIdentity(token);
    return { provider: 'google', providerId: g.googleId, login: null, name: g.name, email: g.email };
  },
};

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(200).optional(),
  error: z.string().max(100).optional(),
});

function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

function cookieName(base: string): string {
  return isProduction() ? `__Host-${base}` : base;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function setSessionCookie(reply: FastifyReply, user: SessionUser): void {
  const token = signToken({ userId: user.id, email: user.email, name: user.name });
  reply.setCookie('token', token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Usuario da sessao (cookie `token`), sem depender do plugin de auth. */
function sessionUserId(request: FastifyRequest): string | null {
  if (request.userId) return request.userId;
  const token = request.cookies?.token;
  if (!token) return null;
  try {
    return verifyToken(token).userId;
  } catch {
    return null;
  }
}

function providerRoutes(adapter: ProviderAdapter) {
  const { provider } = adapter;
  const loginFail = (reply: FastifyReply, code: OAuthLoginErrorCode) =>
    reply.redirect(`/login?${provider}=${code}`, 302);
  const linkDone = (reply: FastifyReply, status: OAuthLinkResult) =>
    reply.redirect(`/?vinculo=${provider}.${status}`, 302);

  return async function routes(fastify: FastifyInstance): Promise<void> {
    /** Emite o state e redireciona ao provedor. Devolve o state (ou null se desligado). */
    function startFlow(reply: FastifyReply): string | null {
      const state = randomBytes(32).toString('base64url');
      const url = adapter.authorizeUrl(state);
      if (!url) return null;
      reply.setCookie(cookieName(adapter.stateCookie), state, {
        httpOnly: true,
        secure: isProduction(),
        sameSite: 'lax',
        path: '/',
        maxAge: STATE_TTL_SECONDS,
      });
      void reply.redirect(url, 302);
      return state;
    }

    fastify.get(`/api/auth/${provider}`, async (request, reply) => {
      if (adapter.isRateLimited(getClientIp(request)).limited) return loginFail(reply, 'limite');
      if (!startFlow(reply)) return loginFail(reply, 'desligado');
      return reply;
    });

    fastify.get(`/api/auth/${provider}/link`, async (request, reply) => {
      // Navegacao same-site a partir das Configuracoes: o cookie de sessao vem.
      const userId = sessionUserId(request);
      if (!userId) return reply.redirect('/login', 302);
      if (adapter.isRateLimited(getClientIp(request)).limited) return linkDone(reply, 'limite');
      const state = startFlow(reply);
      if (!state) return linkDone(reply, 'falhou');
      rememberLinkIntent(state, userId, provider);
      return reply;
    });

    fastify.get(adapter.callbackPath, async (request, reply) => {
      const ip = getClientIp(request);
      const name = cookieName(adapter.stateCookie);
      const expected = request.cookies[name];
      reply.clearCookie(name, { path: '/' }); // state de uso unico

      const query = callbackQuerySchema.safeParse(request.query);
      const state = query.success ? query.data.state : undefined;
      const validState = Boolean(state && expected && safeEqual(state, expected));
      // Intencao de vinculo so conta com state valido (consumida de qualquer jeito).
      const linkUserId = state ? takeLinkIntent(state, provider) : null;
      const isLink = validState && linkUserId !== null;
      const fail = (code: 'cancelado' | 'falhou' | 'limite') =>
        isLink ? linkDone(reply, code) : loginFail(reply, code);

      if (adapter.isRateLimited(ip).limited) return fail('limite');
      if (!query.success) return fail('falhou');
      if (query.data.error) return fail('cancelado'); // ex.: access_denied
      if (!query.data.code || !validState) {
        request.log.warn(`${provider} oauth: state ausente ou diferente`);
        return fail('falhou');
      }

      try {
        const identity = await adapter.identify(query.data.code);
        if (!identity) return fail('falhou');

        if (isLink && linkUserId) {
          const status = await linkOAuthAccount(identity, linkUserId);
          request.log.info({ userId: linkUserId, provider, status }, 'oauth: vinculo pela sessao');
          return linkDone(reply, status);
        }

        const result = await resolveOAuthLogin(identity, ip, request.log);
        if ('error' in result) return loginFail(reply, result.error);
        setSessionCookie(reply, result.user);
        return reply.redirect('/', 302);
      } catch (err) {
        if (adapter.isApiError(err)) {
          request.log.warn({ reason: (err as Error).message }, `${provider} oauth: falha na API do provedor`);
        } else {
          request.log.error({ err }, `${provider} oauth: erro inesperado`);
        }
        return fail('falhou');
      }
    });
  };
}

/** GitHub + rotas comuns (provedores ligados e contas vinculadas). */
export async function githubAuthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/auth/providers', async () => ({
    github: getGithubConfig() !== null,
    google: getGoogleConfig() !== null,
  }));

  fastify.get('/api/me/links', async (request, reply) => {
    const userId = sessionUserId(request);
    if (!userId) return reply.code(401).send({ error: 'Not authenticated' });
    return getLinkedAccounts(userId);
  });

  await fastify.register(providerRoutes(githubAdapter));
}

export const googleAuthRoutes = providerRoutes(googleAdapter);
