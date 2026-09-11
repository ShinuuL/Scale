import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from './lib/prisma.js';
import { getEnv } from './lib/env.js';
import { authPlugin } from './plugins/auth.js';
import { corsPlugin } from './plugins/cors.js';
import { helmetPlugin } from './plugins/helmet.js';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { tailscaleRoutes } from './routes/tailscale.js';
import { turnRoutes } from './routes/turn.js';
import { metricsRoutes } from './routes/metrics.js';
import { messagesRoutes } from './routes/messages.js';
import { filesRoutes } from './routes/files.js';
import { createSocketServer } from './socket/handler.js';
import { checkTailscaleOrigin } from './plugins/checkTailscale.js';
import { gcDeletedFiles } from './lib/uploads.js';
import multipart from '@fastify/multipart';

const env = getEnv();

const server = Fastify({
  logger: {
    level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  },
  // Confia no X-Forwarded-For dos proxies (Caddy/Next.js): request.ip vira o IP
  // real do cliente na tailnet, usado pelo checkTailscaleOrigin.
  trustProxy: true,
});

// Hardening tailnet: rejeita 403 fora da rede privada (ver checkTailscale.ts).
server.addHook('onRequest', checkTailscaleOrigin);

// Plugins
await server.register(cookie);
await server.register(corsPlugin);
await server.register(helmetPlugin);
await server.register(authPlugin);
await server.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });

// Routes
await server.register(authRoutes);
await server.register(roomRoutes);
await server.register(tailscaleRoutes);
await server.register(turnRoutes);
await server.register(metricsRoutes);
await server.register(messagesRoutes);
await server.register(filesRoutes);

// Health check
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

server.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Attach Socket.io to the Fastify HTTP server and expose it so routes
// (files.ts) can broadcast chat:message
const httpServer = server.server;
const io = createSocketServer(httpServer);
(server as unknown as Record<string, unknown>).io = io;

// GC diário de arquivos deletados há >7d (libera quota; logs em uploads.ts)
const gcTimer = setInterval(() => {
  gcDeletedFiles().catch((err) => server.log.error(err));
}, 24 * 60 * 60 * 1000);
gcTimer.unref();

const start = async (): Promise<void> => {
  const port = env.PORT;

  try {
    // Connect Prisma
    await prisma.$connect();
    server.log.info('Database connected');

    // Start server
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info(`Server running on port ${port}`);
    server.log.info('Socket.io server attached');
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (): Promise<void> => {
  server.log.info('Shutting down...');
  await server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();

export { server };
