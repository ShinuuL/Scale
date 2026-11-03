/**
 * Login/cadastro com GitHub.
 *
 *   GET /api/auth/providers         -> { github: boolean }  (o frontend mostra o botao)
 *   GET /api/auth/github            -> 302 para o GitHub (com `state` anti-CSRF)
 *   GET /api/auth/github/callback   -> valida `state`, le a identidade e entra
 *
 * Regras de conta:
 *   1. githubId ja vinculado            -> entra nessa conta.
 *   2. e-mail ja cadastrado sem vinculo -> NAO vincula sozinho (o cadastro por
 *      senha nao verifica e-mail: quem cadastrou um e-mail alheio ganharia a
 *      conta do dono real). Volta para o login com aviso.
 *   3. senao                            -> cria a conta com o e-mail primario
 *      VERIFICADO do GitHub e uma senha aleatoria inutilizavel.
 *
 * Fim do fluxo: sempre 302 para uma pagina do app (`/` ou `/login?github=...`),
 * nunca JSON — o callback e navegacao de topo vinda do github.com.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, signToken } from '../lib/auth.js';
import { getEnv } from '../lib/env.js';
import { getClientIp } from '../lib/clientIp.js';
import { findUserByEmail, normalizeEmail } from '../lib/userEmail.js';
import { isGithubOAuthRateLimited, isRegisterRateLimited } from '../lib/rateLimit.js';
import {
  GITHUB_CALLBACK_PATH,
  GithubApiError,
  buildGithubAuthorizeUrl,
  exchangeGithubCode,
  fetchGithubIdentity,
  getGithubConfig,
} from '../lib/github.js';

const STATE_TTL_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Codigos que o frontend (/login?github=<codigo>) traduz em mensagem. */
export type GithubLoginError =
  | 'cancelado'
  | 'falhou'
  | 'email_em_uso'
  | 'sem_email'
  | 'limite'
  | 'desligado';

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(200).optional(),
  state: z.string().min(1).max(200).optional(),
  error: z.string().max(100).optional(),
});

function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/**
 * `__Host-` em producao: exige Secure, Path=/ e proibe Domain, entao um site
 * irmao (ex.: nexushosts.tech) nao consegue plantar um `state` proprio e
 * forcar login CSRF. Em dev (http) o prefixo nao e aceito pelo browser.
 */
function stateCookieName(): string {
  return isProduction() ? '__Host-scale_gh_state' : 'scale_gh_state';
}

function stateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    // Lax (nao Strict): o callback chega por navegacao vinda do github.com e
    // um cookie Strict nao seria enviado nela.
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function failTo(reply: FastifyReply, code: GithubLoginError): FastifyReply {
  return reply.redirect(`/login?github=${code}`, 302);
}

function setSessionCookie(reply: FastifyReply, user: { id: string; email: string; name: string }): void {
  const token = signToken({ userId: user.id, email: user.email, name: user.name });
  reply.setCookie('token', token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function githubAuthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/auth/providers', async () => ({ github: getGithubConfig() !== null }));

  fastify.get('/api/auth/github', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = getGithubConfig();
    if (!config) return failTo(reply, 'desligado');
    if (isGithubOAuthRateLimited(getClientIp(request)).limited) return failTo(reply, 'limite');

    const state = randomBytes(32).toString('base64url');
    reply.setCookie(stateCookieName(), state, stateCookieOptions(STATE_TTL_SECONDS));
    return reply.redirect(buildGithubAuthorizeUrl(config, state), 302);
  });

  fastify.get(GITHUB_CALLBACK_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    const config = getGithubConfig();
    if (!config) return failTo(reply, 'desligado');
    const ip = getClientIp(request);
    if (isGithubOAuthRateLimited(ip).limited) return failTo(reply, 'limite');

    // O state vale uma vez so: apaga o cookie em qualquer desfecho.
    const expected = request.cookies[stateCookieName()];
    reply.clearCookie(stateCookieName(), { path: '/' });

    const query = callbackQuerySchema.safeParse(request.query);
    if (!query.success) return failTo(reply, 'falhou');
    if (query.data.error) return failTo(reply, 'cancelado'); // ex.: access_denied
    const { code, state } = query.data;
    if (!code || !state || !expected || !safeEqual(state, expected)) {
      request.log.warn('github oauth: state ausente ou diferente');
      return failTo(reply, 'falhou');
    }

    try {
      const accessToken = await exchangeGithubCode(config, code);
      if (!accessToken) return failTo(reply, 'falhou');
      const identity = await fetchGithubIdentity(accessToken);

      // 1. Ja vinculado.
      const linked = await prisma.githubAccount.findUnique({
        where: { githubId: identity.githubId },
        select: { id: true, login: true, user: { select: { id: true, email: true, name: true } } },
      });
      if (linked) {
        if (linked.login !== identity.login) {
          await prisma.githubAccount.update({ where: { id: linked.id }, data: { login: identity.login } });
        }
        setSessionCookie(reply, linked.user);
        return reply.redirect('/', 302);
      }

      // 3. Conta nova (2. e-mail em uso cai fora antes).
      if (!identity.email) return failTo(reply, 'sem_email');
      const email = normalizeEmail(identity.email);
      if (await findUserByEmail(email)) return failTo(reply, 'email_em_uso');
      if (isRegisterRateLimited(ip).limited) return failTo(reply, 'limite');

      const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
      const name = (identity.name ?? identity.login).slice(0, 100);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          githubAccount: { create: { githubId: identity.githubId, login: identity.login } },
        },
        select: { id: true, email: true, name: true },
      });
      request.log.info({ userId: user.id }, 'github oauth: conta criada');
      setSessionCookie(reply, user);
      return reply.redirect('/', 302);
    } catch (err) {
      if (err instanceof GithubApiError) {
        request.log.warn({ reason: err.message }, 'github oauth: falha na API do GitHub');
      } else {
        request.log.error({ err }, 'github oauth: erro inesperado');
      }
      return failTo(reply, 'falhou');
    }
  });
}
