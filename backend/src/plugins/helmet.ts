import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';

export async function helmetPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:', 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
}

// `skip-override` reproduz o `fastify-plugin` (mesmo padrão de plugins/auth.ts)
// sem adicionar dependência. Sem ele, este plugin roda num contexto filho e o
// hook do @fastify/helmet fica encapsulado: as rotas vivem nos contextos irmãos
// e nunca recebiam CSP nem X-Frame-Options — medido: GET /api/health respondia
// sem esses headers. Mantenha este marcador.
(helmetPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
