import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { getChatMetricsSnapshot, getChatMetricsText, getUptimeSeconds } from '../lib/metrics.js';
import { getMetricsAuthConfig } from '../lib/env.js';
import { getRoomPeersSnapshot } from '../socket/handler.js';

/** Compara em tempo constante (hash SHA-256 iguala os tamanhos). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** `Authorization: Bearer <METRICS_SERVICE_TOKEN>` valido? */
export function hasMetricsServiceToken(request: FastifyRequest): boolean {
  const { serviceToken } = getMetricsAuthConfig();
  if (!serviceToken) return false;
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7).trim(), serviceToken);
}

export async function metricsRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Acesso a /api/metrics: token de servico (MCP) OU usuario logado cujo email
   * esta em METRICS_ADMIN_EMAILS. Usuario comum -> 403; sem credencial -> 401.
   */
  async function requireMetricsAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (hasMetricsServiceToken(request)) return;
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    const email = request.userEmail?.trim().toLowerCase();
    if (!email || !getMetricsAuthConfig().adminEmails.has(email)) {
      await reply.code(403).send({ error: 'Forbidden' });
    }
  }

  // GET /api/metrics — observabilidade. EXIGE admin (requireMetricsAdmin): o
  // app pode ser publicado na internet (tunel trycloudflare) e este payload
  // expoe a contagem de peers por sala. memory/version nao saem (fingerprint).
  // JSON por padrao; Prometheus text quando Accept: text/plain ou ?format=prometheus.
  fastify.get<{ Querystring: { format?: string } }>(
    '/api/metrics',
    { preHandler: [requireMetricsAdmin] },
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
        chat: getChatMetricsSnapshot(),
      };
    },
  );
}