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
  // GET /api/metrics — observabilidade (público, sem auth).
  // JSON por padrão; Prometheus text quando Accept: text/plain ou ?format=prometheus.
  fastify.get<{ Querystring: { format?: string } }>(
    '/api/metrics',
    async (request, reply) => {
      const [totalRooms, activeRooms] = await Promise.all([
        prisma.room.count(),
        prisma.room.count({ where: { status: 'ACTIVE' } }),
      ]);

      const byRoom = getRoomPeersSnapshot();
      let withPeers = 0;
      let peerTotal = 0;
      const byRoomJson: Record<string, number> = {};

      for (const [roomId, count] of byRoom) {
        if (count > 0) withPeers += 1;
        peerTotal += count;
        byRoomJson[roomId] = count;
      }

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
          byRoom: byRoomJson,
        },
        memory: getMemoryUsage(),
        version: getVersion(),
        chat: getChatMetricsSnapshot(),
      };
    },
  );
}