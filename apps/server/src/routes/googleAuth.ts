/**
 * Login/cadastro com Google.
 *
 *   GET /api/auth/google            -> 302 para o Google (com `state` anti-CSRF)
 *   GET /api/auth/google/callback   -> valida `state`, le a identidade e entra
 *
 * (O `GET /api/auth/providers` fica em githubAuth.ts e informa os dois.)
 *
 * Regras de conta (as mesmas do GitHub):
 *   1. googleId (`sub`) ja vinculado    -> entra nessa conta.
 *   2. e-mail ja cadastrado sem vinculo -> NAO vincula sozinho (o cadastro por
 *      senha nao verifica e-mail: quem pre-cadastrou o e-mail alheio, e sabe a
 *      senha, continuaria entrando na conta do dono real). Volta com aviso.
 *   3. senao                            -> cria a conta com o e-mail VERIFICADO
 *      pelo Google e uma senha aleatoria inutilizavel.
 *
 * Fim do fluxo: sempre 302 para `/` ou `/login?google=<codigo>`.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { hashPassword, signToken } from '../lib/auth.js';
import { getEnv } from '../lib/env.js';
import { getClientIp } from '../lib/clientIp.js';
import { findUserByEmail, normalizeEmail } from '../lib/userEmail.js';
import { isGoogleOAuthRateLimited, isRegisterRateLimited } from '../lib/rateLimit.js';
import {
  GOOGLE_CALLBACK_PATH,
  GoogleApiError,
  buildGoogleAuthorizeUrl,
  exchangeGoogleCode,
  fetchGoogleIdentity,
  getGoogleConfig,
} from '../lib/google.js';

const STATE_TTL_SECONDS = 10 * 60;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/** Codigos que o frontend (/login?google=<codigo>) traduz em mensagem. */
export type GoogleLoginError =
  | 'cancelado'
  | 'falhou'
  | 'email_em_uso'
  | 'sem_email'
  | 'limite'
  | 'desligado';

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(200).optional(),
  error: z.string().max(100).optional(),
});

function isProduction(): boolean {
  return getEnv().NODE_ENV === 'production';
}

/** `__Host-` em producao (site irmao nao planta state); ver githubAuth.ts. */
function stateCookieName(): string {
  return isProduction() ? '__Host-scale_google_state' : 'scale_google_state';
}

function stateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: isProduction(),
    // Lax: o callback chega por navegacao de topo vinda do accounts.google.com.
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

function failTo(reply: FastifyReply, code: GoogleLoginError): FastifyReply {
  return reply.redirect(`/login?google=${code}`, 302);
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

export async function googleAuthRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/auth/google', async (request: FastifyRequest, reply: FastifyReply) => {
    const config = getGoogleConfig();
    if (!config) return failTo(reply, 'desligado');
    if (isGoogleOAuthRateLimited(getClientIp(request)).limited) return failTo(reply, 'limite');

    const state = randomBytes(32).toString('base64url');
    reply.setCookie(stateCookieName(), state, stateCookieOptions(STATE_TTL_SECONDS));
    return reply.redirect(buildGoogleAuthorizeUrl(config, state), 302);
  });

  fastify.get(GOOGLE_CALLBACK_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    const config = getGoogleConfig();
    if (!config) return failTo(reply, 'desligado');
    const ip = getClientIp(request);
    if (isGoogleOAuthRateLimited(ip).limited) return failTo(reply, 'limite');

    // O state vale uma vez so: apaga o cookie em qualquer desfecho.
    const expected = request.cookies[stateCookieName()];
    reply.clearCookie(stateCookieName(), { path: '/' });

    const query = callbackQuerySchema.safeParse(request.query);
    if (!query.success) return failTo(reply, 'falhou');
    if (query.data.error) return failTo(reply, 'cancelado'); // ex.: access_denied
    const { code, state } = query.data;
    if (!code || !state || !expected || !safeEqual(state, expected)) {
      request.log.warn('google oauth: state ausente ou diferente');
      return failTo(reply, 'falhou');
    }

    try {
      const accessToken = await exchangeGoogleCode(config, code);
      if (!accessToken) return failTo(reply, 'falhou');
      const identity = await fetchGoogleIdentity(accessToken);

      // 1. Ja vinculado.
      const linked = await prisma.googleAccount.findUnique({
        where: { googleId: identity.googleId },
        select: { user: { select: { id: true, email: true, name: true } } },
      });
      if (linked) {
        setSessionCookie(reply, linked.user);
        return reply.redirect('/', 302);
      }

      // 3. Conta nova (2. e-mail em uso cai fora antes).
      if (!identity.email) return failTo(reply, 'sem_email');
      const email = normalizeEmail(identity.email);
      if (await findUserByEmail(email)) return failTo(reply, 'email_em_uso');
      if (isRegisterRateLimited(ip).limited) return failTo(reply, 'limite');

      const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
      const name = (identity.name ?? email.split('@')[0]).slice(0, 100);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          googleAccount: { create: { googleId: identity.googleId } },
        },
        select: { id: true, email: true, name: true },
      });
      request.log.info({ userId: user.id }, 'google oauth: conta criada');
      setSessionCookie(reply, user);
      return reply.redirect('/', 302);
    } catch (err) {
      if (err instanceof GoogleApiError) {
        request.log.warn({ reason: err.message }, 'google oauth: falha na API do Google');
      } else {
        request.log.error({ err }, 'google oauth: erro inesperado');
      }
      return failTo(reply, 'falhou');
    }
  });
}
