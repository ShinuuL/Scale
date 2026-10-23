import type { FastifyError, FastifyInstance } from 'fastify';

/**
 * Hardening global de respostas:
 *  - setErrorHandler: 5xx responde so `{ error: 'Internal Server Error' }`
 *    (stack/mensagem interna ficam no log do servidor); 4xx mantem a mensagem.
 */
export async function securityPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled error');
      return reply.code(status).send({ error: 'Internal Server Error' });
    }
    return reply.code(status).send({ error: error.message });
  });
}

// Aplica no escopo raiz (como fastify-plugin), senao o error handler
// valeria so para rotas registradas DENTRO deste plugin.
(securityPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
