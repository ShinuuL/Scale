import type { FastifyInstance } from 'fastify';
import { getEnv } from '../lib/env.js';
import { isTurnRateLimited } from '../lib/rateLimit.js';
import { getClientIp } from '../lib/clientIp.js';

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

export async function turnRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/turn/credentials
  //
  // Exige login: o endpoint entrega credenciais de relay (TURN) do coturn, que
  // sao um recurso pago/limitado da instancia. Anonimo atras do tunel nao pode
  // drenar esse recurso. Hoje ENABLE_TURN=false por padrao, entao na pratica o
  // convidado sem sessao passa a usar APENAS STUN (nao ha regressao funcional:
  // sem TURN ligado, o endpoint ja devolvia so STUN). Quando o TURN for ligado,
  // a sessao passa a ser o gate para receber a credencial.
  fastify.get(
    '/api/turn/credentials',
    { preHandler: [fastify.authenticate as never] },
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
    },
  );
}
