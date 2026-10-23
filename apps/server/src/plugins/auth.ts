import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../lib/auth.js';
import { getEnv } from '../lib/env.js';
import {
  GUEST_COOKIE_NAME,
  GUEST_COOKIE_MAX_AGE_SECONDS,
  newGuestId,
  signGuestId,
  verifyGuestCookie,
} from '../lib/guestId.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
    userName?: string;
    /** guestId do convidado (cookie assinado verificado ou recem-emitido). */
    guestId?: string;
  }
}

/**
 * guestId do convidado (lib/guestId.ts). Cookie com assinatura valida vira
 * `request.guestId`; adulterado/ausente e ignorado. Quem NAO esta logado e chama
 * /api recebe um guestId novo (Set-Cookie) — a primeira chamada da pagina (ex.:
 * GET /api/rooms/:id) ja deixa o cookie pronto. O handshake do Socket.io faz o
 * mesmo por conta propria (socket/handler.ts).
 */
function resolveGuestId(request: FastifyRequest, reply: FastifyReply): void {
  const existing = verifyGuestCookie(request.cookies?.[GUEST_COOKIE_NAME]);
  if (existing) {
    request.guestId = existing;
    return;
  }
  if (request.userId || !request.url.startsWith('/api/')) return;
  if (typeof reply.setCookie !== 'function') return;
  const guestId = newGuestId();
  request.guestId = guestId;
  reply.setCookie(GUEST_COOKIE_NAME, signGuestId(guestId), {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: getEnv().NODE_ENV === 'production',
    maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
  });
}

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Hook opcional: tenta preencher request.userId se houver cookie válido, sem falhar
  fastify.addHook('onRequest', async (request, reply) => {
    const token = request.cookies?.token ?? (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined);
    if (token) {
      try {
        const payload = verifyToken(token);
        request.userId = payload.userId;
        request.userEmail = payload.email;
        request.userName = payload.name;
      } catch {
        // token inválido em rota pública => ignora
      }
    }
    resolveGuestId(request, reply);
  });

  fastify.decorate(
    'authenticate',
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (request.userId) return;
      const token = request.cookies?.token;

      if (!token) {
        return reply
          .code(401)
          .send({ error: 'Authentication required' });
      }

      try {
        const payload = verifyToken(token);
        request.userId = payload.userId;
        request.userEmail = payload.email;
        request.userName = payload.name;
      } catch {
        return reply
          .code(401)
          .send({ error: 'Invalid or expired token' });
      }
    },
  );
}

// Decorate the root/parent instance instead of an encapsulated child,
// otherwise sibling route plugins cannot see `fastify.authenticate`.
// This reproduces what the canonical `fastify-plugin` package does,
// without adding a new dependency.
(authPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
