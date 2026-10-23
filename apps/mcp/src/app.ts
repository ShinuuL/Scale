import Fastify, { type FastifyInstance } from 'fastify';
import { isAuthorized, roomIdParamsSchema, kickBodySchema, fingerprint } from './security.js';

export interface McpConfig {
  mcpToken: string;
  backendUrl: string;
  metricsServiceToken: string;
  logger?: boolean;
}

/** Resposta não-2xx do backend, carregando o status para o chamador tratar. */
class BackendHttpError extends Error {
  constructor(readonly status: number) {
    super(`Backend returned ${status}`);
    this.name = 'BackendHttpError';
  }
}

/**
 * Servidor MCP. Sem CORS: e consumido por ferramentas no host (curl/agentes),
 * nunca por browser — sem cabecalhos CORS o browser bloqueia leitura
 * cross-origin. Publicado so em 127.0.0.1 (docker-compose.yml).
 */
export function buildApp(config: McpConfig): FastifyInstance {
  const server = Fastify({ logger: config.logger ?? true });

  // ─── Token auth hook (comparacao em tempo constante) ─────────
  server.addHook('onRequest', async (request, reply) => {
    // Health check is public
    if (request.url === '/health') return;
    if (!isAuthorized(request.headers.authorization, config.mcpToken)) {
      return reply.code(401).send({ error: 'Unauthorized — provide Bearer MCP_TOKEN' });
    }
  });

  server.get('/health', async () => {
    return { status: 'ok', service: 'mcp-server', timestamp: new Date().toISOString() };
  });

  /** `auth: true` anexa o token de servico (METRICS_SERVICE_TOKEN). Só `/api/metrics` pede. */
  async function backendFetch<T>(path: string, opts: { auth?: boolean } = {}): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.auth && config.metricsServiceToken) {
      headers.Authorization = `Bearer ${config.metricsServiceToken}`;
    }
    const res = await fetch(`${config.backendUrl}${path}`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      throw new BackendHttpError(res.status);
    }
    return (await res.json()) as T;
  }

  // ─── GET /mcp/rooms ───────────────────────────────────────────
  server.get('/mcp/rooms', async (_request, reply) => {
    try {
      const data = await backendFetch<{ rooms: Array<Record<string, unknown>> }>('/api/rooms');
      return reply.send({ rooms: data.rooms });
    } catch (err) {
      server.log.error(err, 'Failed to fetch rooms from backend');
      return reply.code(502).send({ error: 'Backend unavailable' });
    }
  });

  // ─── GET /mcp/metrics ─────────────────────────────────────────
  server.get('/mcp/metrics', async (_request, reply) => {
    if (!config.metricsServiceToken) {
      return reply.code(503).send({
        error:
          'METRICS_SERVICE_TOKEN não configurado — /api/metrics exige token de serviço. ' +
          'Defina o mesmo METRICS_SERVICE_TOKEN (>= 32 caracteres) no backend e no MCP.',
      });
    }
    try {
      const data = await backendFetch<Record<string, unknown>>('/api/metrics', { auth: true });
      return reply.send(data);
    } catch (err) {
      server.log.error(err, 'Failed to fetch metrics from backend');
      if (err instanceof BackendHttpError && (err.status === 401 || err.status === 403)) {
        return reply.code(503).send({
          error:
            `METRICS_SERVICE_TOKEN rejeitado pelo backend (${err.status}). ` +
            'Confira se o valor é o mesmo no backend e no MCP (>= 32 caracteres).',
        });
      }
      return reply.code(502).send({ error: 'Backend unavailable' });
    }
  });

  // ─── GET /mcp/rooms/:id ───────────────────────────────────────
  server.get('/mcp/rooms/:id', async (request, reply) => {
    const params = roomIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid room id' });
    try {
      const data = await backendFetch<{ room: Record<string, unknown> }>(
        `/api/rooms/${encodeURIComponent(params.data.id)}`,
      );
      return reply.send({ room: data.room });
    } catch (err) {
      server.log.error(err, 'Failed to fetch room from backend');
      return reply.code(502).send({ error: 'Backend unavailable or room not found' });
    }
  });

  // ─── POST /mcp/rooms/:id/kick ─────────────────────────────────
  server.post('/mcp/rooms/:id/kick', async (request, reply) => {
    const params = roomIdParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid room id' });
    const body = kickBodySchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'socketId is required in body' });
    }

    // Kick is done via Socket.io — for now return acknowledgement.
    // O socketId nunca vai cru para o log nem para a resposta: so um fingerprint.
    server.log.info({ roomId: params.data.id, socket: fingerprint(body.data.socketId) }, 'Kick requested');
    return reply.send({ success: true, message: 'Kick request recorded' });
  });

  return server;
}
