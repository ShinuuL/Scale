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
import { createSocketServer } from './socket/handler.js';

const env = getEnv();

const server = Fastify({
  logger: {
    level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  },
});

// Plugins
await server.register(cookie);
await server.register(corsPlugin);
await server.register(helmetPlugin);
await server.register(authPlugin);

// Routes
await server.register(authRoutes);
await server.register(roomRoutes);
await server.register(tailscaleRoutes);
await server.register(turnRoutes);
await server.register(metricsRoutes);

// Health check
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

server.get('/api/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

const start = async (): Promise<void> => {
  const port = env.PORT;

  try {
    // Connect Prisma
    await prisma.$connect();
    server.log.info('Database connected');

    // Start server
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info(`Server running on port ${port}`);

    // Attach Socket.io to the Fastify HTTP server
    const httpServer = server.server;
    createSocketServer(httpServer);
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
