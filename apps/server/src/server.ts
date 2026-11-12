import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from './lib/prisma.js';
import { getEnv } from './lib/env.js';
import { isScreenModerationEnabled } from './lib/moderation/settings.js';
import { getGuestCookieSecret } from './lib/guestId.js';
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
import { profileRoutes } from './routes/profile.js';
import { socialRoutes } from './routes/social.js';
import { communityRoutes } from './routes/communities.js';
import { callRoutes } from './routes/calls.js';
import { githubAuthRoutes, googleAuthRoutes } from './routes/oauthAuth.js';
import { moderationRoutes } from './routes/moderation.js';
import { adminModerationRoutes } from './routes/adminModeration.js';
import { adminUsersRoutes } from './routes/adminUsers.js';
import { createSocketServer } from './socket/handler.js';
import { gcDeletedFiles, gcOrphanUploads } from './lib/uploads.js';
import { sweepExpiredRooms, retryPendingRoomDeletions, ROOM_SWEEP_INTERVAL_MS } from './lib/roomDeletion.js';
import { MAX_FILE_SIZE_BYTES, MAX_FILES_PER_MESSAGE } from '@scale/shared';
import { resolveTrustProxy } from './lib/clientIp.js';
import { buildLoggerOptions } from './lib/logger.js';
import multipart from '@fastify/multipart';

const env = getEnv();
// Fail-fast: em producao GUEST_COOKIE_SECRET (>= 32 caracteres) e obrigatorio
// para assinar o cookie do guestId (lib/guestId.ts). Sem ele o processo nao sobe.
getGuestCookieSecret();

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
await server.register(profileRoutes);
await server.register(socialRoutes);
await server.register(communityRoutes);
await server.register(callRoutes);
await server.register(githubAuthRoutes);
await server.register(googleAuthRoutes);
await server.register(moderationRoutes);
await server.register(adminModerationRoutes);
await server.register(adminUsersRoutes);

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
// Avisa uma vez se a analise de tela esta ligada sem provedor claude (fica
// desligada). Le a config efetiva (banco ?? .env); falha de banco so loga.
isScreenModerationEnabled(server.log).catch((err) => server.log.error(err));

// GC diário de arquivos deletados há >7d (libera quota; logs em uploads.ts)
let gcRunning = false;
const runGc = async (): Promise<void> => {
  if (gcRunning) return;
  gcRunning = true;
  try {
    await retryPendingRoomDeletions(io, server.log);
    await gcDeletedFiles();
    await gcOrphanUploads();
  } catch (err) { server.log.error(err); } finally { gcRunning = false; }
};
const gcTimer = setInterval(() => { void runGc(); }, 24 * 60 * 60 * 1000);
gcTimer.unref();

// Varredura de salas temporarias vencidas (lib/roomDeletion.ts): roda no
// start (limpa o que venceu com o backend fora do ar) e a cada 5 min.
const runRoomSweep = (): void => {
  sweepExpiredRooms({ io, log: server.log }).catch((err) => server.log.error(err));
};
const roomSweepTimer = setInterval(runRoomSweep, ROOM_SWEEP_INTERVAL_MS);
roomSweepTimer.unref();

const start = async (): Promise<void> => {
  const port = env.PORT;

  try {
    // Connect Prisma
    await prisma.$connect();
    server.log.info('Database connected');

    // Start server
    await server.listen({ port, host: '0.0.0.0' });
    server.log.info(`Server running on port ${port}`);
    runRoomSweep();
    void runGc();
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
