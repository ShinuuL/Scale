import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { roomParticipant } from '../lib/roomAccess.js';
import type { FastifyInstance } from 'fastify';
import { getEnv } from '../lib/env.js';
import { isTurnRateLimited } from '../lib/rateLimit.js';
import { getClientIp } from '../lib/clientIp.js';

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export async function turnRoutes(fastify: FastifyInstance): Promise<void> {
  // Sessao mantem compatibilidade; convidados precisam ticket de uma sala ativa.
  fastify.get<{ Querystring: { roomId?: string } }>(
    '/api/turn/credentials',
    async (request, reply) => {
      // Balde por IP antes de montar a resposta: sem ele, um cliente logado
      // poderia inundar o endpoint. O IP vem de lib/clientIp.ts (nao do header
      // cru), valido atras do proxy /api do Next e do tunel.
      const turnLimit = isTurnRateLimited(getClientIp(request));
      if (turnLimit.limited) {
        return reply
          .header('Retry-After', String(turnLimit.retryAfterSeconds))
          .code(429)
          .send({ error: 'Too many requests. Try again later.' });
      }

      if (!request.userId) {
        const roomId = z.string().uuid().safeParse(request.query.roomId);
        const room = roomId.success ? await prisma.room.findUnique({ where: { id: roomId.data } }) : null;
        if (!room || !roomParticipant(request, room)) return reply.code(401).send({ error: 'Authentication required' });
      }
      reply.header('Cache-Control', 'no-store');
      const env = getEnv();

      if (!env.ENABLE_TURN) {
        // TURN disabled — return STUN only
        return reply.send({
          iceServers: STUN_SERVERS,
          turnEnabled: false,
        });
      }

      // TURN enabled — return configured ICE servers
      // In production, generate temporary TURN credentials via a provider API
      // (e.g., Twilio, Metered, etc.) and return them here.
      const turnUrl = process.env.TURN_URL;
      // Coturn REST API (use-auth-secret): opcional, secreto fica so no servidor.
      // Provedores com credencial estatica continuam usando o contrato anterior.
      const sharedSecret = process.env.TURN_AUTH_SECRET;
      const turnUsername = sharedSecret
        ? `${Math.floor(Date.now() / 1000) + 3600}:${crypto.randomUUID()}`
        : process.env.TURN_USERNAME;
      const turnCredential = sharedSecret && turnUsername
        ? createHmac('sha1', sharedSecret).update(turnUsername).digest('base64')
        : process.env.TURN_CREDENTIAL;

      if (!turnUrl || !turnUsername || !turnCredential) {
        // Fallback to STUN only if TURN not configured
        fastify.log.warn('ENABLE_TURN=true but TURN_URL/TURN_USERNAME/TURN_CREDENTIAL not set');
        return reply.send({
          iceServers: STUN_SERVERS,
          turnEnabled: false,
          warning: 'TURN configured but credentials not provided',
        });
      }

      return reply.send({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          {
            urls: turnUrl,
            username: turnUsername,
            credential: turnCredential,
          },
        ],
        turnEnabled: true,
        ttlSeconds: sharedSecret ? 3600 : null,
        expiresAt: sharedSecret ? new Date(Number(turnUsername.split(':')[0]) * 1000).toISOString() : null,
      });
    },
  );
}
