import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import {
  getChatMetricsSnapshot,
  getChatMetricsText,
  getMemoryUsage,
  getUptimeSeconds,
  getVersion,
} from '../lib/metrics.js';
import { getRoomPeersSnapshot } from '../socket/handler.js';

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/metrics — observabilidade. EXIGE autenticacao (JWT em cookie
  // `token` ou `Authorization: Bearer <jwt>`): o app pode ser publicado na
  // internet (tunel trycloudflare) e este payload expoe a contagem de peers
  // por sala. Sem credencial valida -> 401 (mesmo guard das rotas privadas).
  // JSON por padrao; Prometheus text quando Accept: text/plain ou ?format=prometheus.
  fastify.get<{ Querystring: { format?: string } }>(
    '/api/metrics',
    { preHandler: [fastify.authenticate as never] },
    async (request, reply) => {
      const [totalRooms, activeRooms] = await Promise.all([
        prisma.room.count(),
        prisma.room.count({ where: { status: 'ACTIVE' } }),
      ]);

      const byRoom = getRoomPeersSnapshot();
      let withPeers = 0;
      let peerTotal = 0;
      // Contagens de peers por sala SEM identificadores: o roomId e o uuid que
      // da acesso a sala. Num endpoint publico ele permitiria enumerar e entrar
      // em salas ativas, entao so os numeros saem daqui.
      const perRoom: number[] = [];

      for (const [, count] of byRoom) {
        if (count > 0) withPeers += 1;
        peerTotal += count;
        if (count > 0) perRoom.push(count);
      }
      perRoom.sort((a, b) => b - a);

      const wantsPrometheus =
        (request.headers.accept ?? '').includes('text/plain') ||
        request.query.format === 'prometheus';

      if (wantsPrometheus) {
        const text = [
          `scale_uptime_seconds ${getUptimeSeconds()}`,
          `scale_rooms_total ${totalRooms}`,
          `scale_rooms_active ${activeRooms}`,
          `scale_peers_total ${peerTotal}`,
          getChatMetricsText(),
        ].join('\n');
        return reply
          .header('Content-Type', 'text/plain; version=0.0.4')
          .send(`${text}\n`);
      }

      return {
        uptimeSeconds: getUptimeSeconds(),
        rooms: {
          total: totalRooms,
          active: activeRooms,
          withPeers,
        },
        peers: {
          total: peerTotal,
          perRoom,
        },
        memory: getMemoryUsage(),
        version: getVersion(),
        chat: getChatMetricsSnapshot(),
      };
    },
  );
}