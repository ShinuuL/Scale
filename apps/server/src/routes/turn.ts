import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { roomParticipant } from '../lib/roomAccess.js';
import type { FastifyInstance } from 'fastify';
import { isTurnRateLimited } from '../lib/rateLimit.js';
import { getClientIp } from '../lib/clientIp.js';
import { buildIceServers, isTurnMisconfigured } from '../lib/turnCredentials.js';

export async function turnRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/turn/credentials[?roomId=<uuid>]
  //
  // O caminho PRINCIPAL das credenciais e o evento `room:ice-servers` do
  // join-room (socket/handler.ts), que cobre tambem o convidado. Este endpoint
  // serve para renovar a config: usuario logado sempre; sem sessao, so quem
  // participa de uma sala ativa (ticket/convidado validado por roomParticipant).
  // A credencial e temporaria (lib/turnCredentials.ts): vazar uma nao da acesso
  // permanente ao coturn.
  fastify.get<{ Querystring: { roomId?: string } }>(
    '/api/turn/credentials',
    async (request, reply) => {
      // Balde por IP antes de montar a resposta: sem ele, um cliente poderia
      // inundar o endpoint. O IP vem de lib/clientIp.ts (nao do header cru),
      // valido atras do proxy /api do Next e do tunel.
      const turnLimit = isTurnRateLimited(getClientIp(request));
      if (turnLimit.limited) {
        return reply
          .header('Retry-After', String(turnLimit.retryAfterSeconds))
          .code(429)
          .send({ error: 'Too many requests. Try again later.' });
      }

      let subject = request.userId ? `u${request.userId}` : '';
      if (request.userId && request.query.roomId) {
        const roomId = z.string().uuid().safeParse(request.query.roomId);
        const room = roomId.success ? await prisma.room.findUnique({ where: { id: roomId.data } }) : null;
        if (room?.communityId && !(await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId: room.communityId, userId: request.userId } } }))) {
          return reply.code(403).send({ error: 'Not a room member' });
        }
      }
      if (!request.userId) {
        const roomId = z.string().uuid().safeParse(request.query.roomId);
        const room = roomId.success ? await prisma.room.findUnique({ where: { id: roomId.data } }) : null;
        if (!room || !(await roomParticipant(request, room))) return reply.code(401).send({ error: 'Authentication required' });
        subject = `r${room.id}`;
      }

      if (isTurnMisconfigured()) {
        fastify.log.warn('ENABLE_TURN=true mas falta TURN_URL e TURN_SECRET (ou TURN_USERNAME/TURN_CREDENTIAL)');
      }

      reply.header('Cache-Control', 'no-store');
      return reply.send(buildIceServers(subject));
    },
  );
}
