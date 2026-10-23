import Fastify from 'fastify';
import cors from '@fastify/cors';

const PORT = Number(process.env.PORT) || 4001;
const MCP_TOKEN = process.env.MCP_TOKEN || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';
// Token de servico (>= 32 chars) que o backend aceita em /api/metrics
// (mesmo valor de METRICS_SERVICE_TOKEN no backend). Sem ele /mcp/metrics
// devolve 503 com a instrucao.
const METRICS_SERVICE_TOKEN = process.env.METRICS_SERVICE_TOKEN || '';

const server = Fastify({ logger: true });

// ─── CORS ─────────────────────────────────────────────────────
await server.register(cors, { origin: true });

// ─── Token auth hook ──────────────────────────────────────────
server.addHook('onRequest', async (request, reply) => {
  // Health check is public
  if (request.url === '/health') return;

  const auth = request.headers.authorization;
  if (!auth || auth !== `Bearer ${MCP_TOKEN}`) {
    return reply.code(401).send({ error: 'Unauthorized — provide Bearer MCP_TOKEN' });
  }
});

// ─── Health ───────────────────────────────────────────────────
server.get('/health', async () => {
  return { status: 'ok', service: 'mcp-server', timestamp: new Date().toISOString() };
});

// ─── Helpers ──────────────────────────────────────────────────
/** Resposta não-2xx do backend, carregando o status para o chamador tratar. */
class BackendHttpError extends Error {
  constructor(readonly status: number) {
    super(`Backend returned ${status}`);
    this.name = 'BackendHttpError';
  }
}

/**
 * `auth: true` anexa o token de servico (METRICS_SERVICE_TOKEN). Só `/api/metrics` pede — anexar o
 * JWT a todas as rotas mudaria a resposta das demais (ex.: GET /api/rooms/:id
 * devolve `inviteToken` para o dono autenticado, dado que o MCP não precisa).
 */
async function backendFetch<T>(path: string, opts: { auth?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth && METRICS_SERVICE_TOKEN) headers.Authorization = `Bearer ${METRICS_SERVICE_TOKEN}`;

  const res = await fetch(`${BACKEND_URL}${path}`, {
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
// Requer Bearer MCP_TOKEN (verificada no onRequest hook) e, do lado do
// backend, o token de servico (METRICS_SERVICE_TOKEN). Falta de token ou token errado
// vira 503 com a instrucao — o backend está no ar, então 502 "unavailable"
// mentiria sobre a causa.
server.get('/mcp/metrics', async (_request, reply) => {
  if (!METRICS_SERVICE_TOKEN) {
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
    if (err instanceof BackendHttpError && err.status === 401) {
      return reply.code(503).send({
        error:
          'METRICS_SERVICE_TOKEN rejeitado pelo backend (401). ' +
          'Confira se o valor é o mesmo no backend e no MCP (>= 32 caracteres).',
      });
    }
    return reply.code(502).send({ error: 'Backend unavailable' });
  }
});

// ─── GET /mcp/rooms/:id ───────────────────────────────────────
server.get<{ Params: { id: string } }>('/mcp/rooms/:id', async (request, reply) => {
  try {
    const data = await backendFetch<{ room: Record<string, unknown> }>(
      `/api/rooms/${request.params.id}`,
    );
    return reply.send({ room: data.room });
  } catch (err) {
    server.log.error(err, 'Failed to fetch room from backend');
    return reply.code(502).send({ error: 'Backend unavailable or room not found' });
  }
});

// ─── POST /mcp/rooms/:id/kick ─────────────────────────────────
server.post<{ Params: { id: string }; Body: { socketId: string } }>(
  '/mcp/rooms/:id/kick',
  async (request, reply) => {
    const { socketId } = request.body ?? {};
    if (!socketId) {
      return reply.code(400).send({ error: 'socketId is required in body' });
    }

    // Kick is done via Socket.io — for now return acknowledgement
    // In production this would emit a kick event via a Socket.io admin client
    server.log.info(`Kick requested: room=${request.params.id} socket=${socketId}`);
    return reply.send({
      success: true,
      message: `Kick request recorded for socket ${socketId} in room ${request.params.id}`,
    });
  },
);

// ─── Start ────────────────────────────────────────────────────
const start = async (): Promise<void> => {
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    server.log.info(`MCP Server running on port ${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
