import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { getChatMetricsSnapshot, getChatMetricsText, getUptimeSeconds, getResourceMetrics, getResourceMetricsText } from '../lib/metrics.js';
import { isAdminUser } from '../lib/adminRole.js';
import { getRoomPeersSnapshot } from '../socket/handler.js';

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Acesso a /api/metrics: so usuario logado cujo email esta em
   * ADMIN_EMAILS (ou o legado METRICS_ADMIN_EMAILS) ou com AdminGrant. Usuario comum -> 403; sem credencial -> 401.
   */
  async function requireMetricsAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    if (!(await isAdminUser({ userId: request.userId, email: request.userEmail }))) {
      await reply.code(403).send({ error: 'Forbidden' });
    }
  }

  // GET /api/metrics — observabilidade. EXIGE admin (requireMetricsAdmin): o
  // app pode ser publicado na internet (tunel trycloudflare) e este payload
  // expoe recursos internos apenas para admin, sem versao ou caminhos do host.
  // JSON por padrao; Prometheus text quando Accept: text/plain ou ?format=prometheus.
  fastify.get<{ Querystring: { format?: string } }>(
    '/api/metrics',
    { preHandler: [requireMetricsAdmin] },
    async (request, reply) => {
      const [totalRooms, activeRooms] = await Promise.all([
        prisma.room.count(),
        // Ativa = status ACTIVE E dentro do prazo: temporaria vencida que
        // ainda nao passou pela varredura (lib/roomDeletion.ts) nao conta.
        prisma.room.count({
          where: {
            status: 'ACTIVE',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        }),
      ]);

      const resources = await getResourceMetrics();
      const storedFiles = await prisma.$queryRaw<Array<{ total: bigint | number | null }>>`SELECT SUM("size") AS total FROM "ChatFile"`;
      const storedFileBytes = Number(storedFiles[0]?.total ?? 0);
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
          getResourceMetricsText(resources),
          `scale_chat_files_stored_bytes ${storedFileBytes}`,
        ].join('\n');
        return reply
          .header('Content-Type', 'text/plain; version=0.0.4')
          .send(`${text}\n`);
      }

      return {
        uptimeSeconds: getUptimeSeconds(),
        resources,
        storedFileBytes: storedFileBytes,
        rooms: {
          total: totalRooms,
          active: activeRooms,
          withPeers,
        },
        peers: {
          total: peerTotal,
          perRoom,
        },
        chat: getChatMetricsSnapshot(),
      };
    },
  );
}