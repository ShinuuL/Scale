import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from './lib/prisma.js';
import { getEnv } from './lib/env.js';
import { authPlugin } from './plugins/auth.js';
import { corsPlugin } from './plugins/cors.js';
import { helmetPlugin } from './plugins/helmet.js';
import { securityPlugin } from './plugins/security.js';
import { authRoutes } from './routes/auth.js';
import { roomRoutes } from './routes/rooms.js';
import { turnRoutes } from './routes/turn.js';
import { metricsRoutes } from './routes/metrics.js';
import { messagesRoutes } from './routes/messages.js';
import { filesRoutes } from './routes/files.js';
import { createSocketServer } from './socket/handler.js';
import { gcDeletedFiles } from './lib/uploads.js';
import { MAX_FILE_SIZE_BYTES, MAX_FILES_PER_MESSAGE } from '@scale/shared';
import { resolveTrustProxy } from './lib/clientIp.js';
import { buildLoggerOptions } from './lib/logger.js';
import multipart from '@fastify/multipart';

const env = getEnv();

const server = Fastify({
  // Serializer de `req` redige password/inviteToken/token da query string e
  // headers com credencial (lib/logger.ts).
  logger: buildLoggerOptions(env.NODE_ENV === 'test' ? 'silent' : 'info'),
  // TRUST_PROXY decide se o X-Forwarded-For e aceito. O default e `false`
  // (fail-closed, ver lib/env.ts): sem configuracao explicita nenhum header de
  // proxy entra na chave dos rate limits — o IP e o do socket. So habilite com o
  // CIDR do proxy/tunel (ex.: `loopback` ou `127.0.0.1/8` quando o tunel roda na
  // mesma maquina): ai o Fastify descarta os hops nao confiaveis e sobra o IP
  // real do cliente (lib/clientIp.ts). `true` confia em TODOS os hops e permete
  // que qualquer cliente forje X-Forwarded-For.
  trustProxy: resolveTrustProxy(env.TRUST_PROXY),
});

// Plugins
await server.register(cookie);
await server.register(corsPlugin);
await server.register(helmetPlugin);
// Error handler global (5xx sem detalhes) e Cache-Control: no-store.
await server.register(securityPlugin);
await server.register(authPlugin);
await server.register(multipart, {
  limits: { fileSize: MAX_FILE_SIZE_BYTES, files: MAX_FILES_PER_MESSAGE },
});

// Routes
await server.register(authRoutes);
await server.register(roomRoutes);
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
