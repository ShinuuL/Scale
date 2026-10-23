import type { FastifyError, FastifyInstance } from 'fastify';

/**
 * Rotas autenticadas/privadas cujas respostas nunca podem ficar em cache
 * (browser, proxy, CDN do tunel): sessao, historico de chat, arquivos,
 * metricas e credenciais TURN.
 */
const NO_STORE_RE = /^\/api\/(?:auth|files|metrics|turn)(?:\/|$)|^\/api\/rooms\/[^/]+\/messages(?:\/|$)/;

/** A URL (sem query) e de rota privada? */
export function isNoStorePath(url: string): boolean {
  const path = url.split('?', 1)[0];
  return NO_STORE_RE.test(path);
}

/**
 * Hardening global de respostas:
 *  - setErrorHandler: 5xx responde so `{ error: 'Internal Server Error' }`
 *    (stack/mensagem interna ficam no log do servidor); 4xx mantem a mensagem.
 *  - onSend: `Cache-Control: no-store` nas rotas privadas.
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

  fastify.addHook('onSend', async (request, reply, payload) => {
    if (isNoStorePath(request.url)) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });
}

// Aplica no escopo raiz (como fastify-plugin), senao o error handler e o hook
// valeriam so para rotas registradas DENTRO deste plugin.
(securityPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
