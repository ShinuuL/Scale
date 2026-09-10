import type { FastifyInstance } from 'fastify';
import { getEnv } from '../lib/env.js';

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export async function turnRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/turn/credentials
  fastify.get('/api/turn/credentials', async (_request, reply) => {
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
    const turnUsername = process.env.TURN_USERNAME;
    const turnCredential = process.env.TURN_CREDENTIAL;

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
    });
  });
}
