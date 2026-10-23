import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyToken } from '../lib/auth.js';

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    userId?: string;
    userEmail?: string;
    userName?: string;
  }
}

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Hook opcional: tenta preencher request.userId se houver cookie válido, sem falhar
  fastify.addHook('onRequest', async (request) => {
    const token = request.cookies?.token ?? (request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : undefined);
    if (!token) return;
    try {
      const payload = verifyToken(token);
      request.userId = payload.userId;
      request.userEmail = payload.email;
      request.userName = payload.name;
    } catch {
      // token inválido em rota pública => ignora
    }
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
