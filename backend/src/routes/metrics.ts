import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import {
  getMemoryUsage,
  getUptimeSeconds,
  getVersion,
} from '../lib/metrics.js';
import { getRoomPeersSnapshot } from '../socket/handler.js';

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/metrics — observabilidade (público, sem auth)
  fastify.get('/api/metrics', async () => {
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
    };
  });
}