import Fastify from 'fastify';
import cors from '@fastify/cors';

const PORT = Number(process.env.PORT) || 4001;
const MCP_TOKEN = process.env.MCP_TOKEN || '';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';

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
async function backendFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Backend returned ${res.status}`);
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
// Requer Bearer MCP_TOKEN (verificada no onRequest hook).
server.get('/mcp/metrics', async (_request, reply) => {
  try {
    const data = await backendFetch<Record<string, unknown>>('/api/metrics');
    return reply.send(data);
  } catch (err) {
    server.log.error(err, 'Failed to fetch metrics from backend');
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
