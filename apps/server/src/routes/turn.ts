import type { FastifyInstance } from 'fastify';
import { isTurnRateLimited } from '../lib/rateLimit.js';
import { getClientIp } from '../lib/clientIp.js';
import { buildIceServers, isTurnMisconfigured } from '../lib/turnCredentials.js';

export async function turnRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/turn/credentials
  //
  // Exige login. O caminho PRINCIPAL das credenciais e o evento
  // `room:ice-servers` do join-room (socket/handler.ts), que cobre tambem o
  // convidado — so quem entrou numa sala (senha/convite validados) recebe relay.
  // Este endpoint fica para o usuario logado pegar a config antes do join.
  // A credencial e temporaria (lib/turnCredentials.ts): vazar uma nao da acesso
  // permanente ao coturn.
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

      if (isTurnMisconfigured()) {
        fastify.log.warn('ENABLE_TURN=true mas falta TURN_URL e TURN_SECRET (ou TURN_USERNAME/TURN_CREDENTIAL)');
      }

      return reply.send(buildIceServers(`u${request.userId ?? ''}`));
    },
  );
}
