import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { communityNicknameSchema } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { communityRoom, findMembership } from '../lib/communityAccess.js';
import { audit, canModerateMember } from '../lib/communityModeration.js';
import { isCommunityNicknameRateLimited } from '../lib/rateLimit.js';

/**
 * Fase 4: apelido por comunidade.
 *
 *  - PUT /api/communities/:id/members/:userId/nickname { nickname: string | null }
 *    O proprio membro muda o seu; mudar o de outro exige `kickMembers` e nivel
 *    maior que o alvo (e entra na auditoria). `null`/vazio limpa. Balde
 *    `communityNickname` (10 / 10 min por usuario). Emite `community:changed`.
 * Nao membro (ou alvo fora da comunidade) = 404.
 */
const params = z.object({ id: z.string().uuid(), userId: z.string().min(1).max(64) });
const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;

export async function communityNicknameRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };
  app.put('/api/communities/:id/members/:userId/nickname', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = communityNicknameSchema.safeParse(request.body);
    if (!p.success || !body.success) return reply.code(400).send({ error: 'Invalid input' });
    const me = request.userId!;
    const actor = await findMembership(p.data.id, me);
    if (!actor) return reply.code(404).send({ error: 'Not found' });
    const self = p.data.userId === me;
    const target = self ? actor : await findMembership(p.data.id, p.data.userId);
    if (!target) return reply.code(404).send({ error: 'Not found' });
    if (!self && !canModerateMember(actor, target)) return reply.code(403).send({ error: 'Forbidden' });
    const limit = isCommunityNicknameRateLimited(me);
    if (limit.limited) {
      return reply.code(429).header('Retry-After', String(limit.retryAfterSeconds)).send({ error: 'Too many requests' });
    }
    const { nickname } = body.data;
    await prisma.communityMember.update({ where: { id: target.id }, data: { nickname } });
    if (!self) {
      const user = await prisma.user.findUnique({ where: { id: p.data.userId }, select: { name: true } });
      await audit(p.data.id, {
        action: 'member.nickname', actorId: me, targetId: p.data.userId, targetName: user?.name ?? null,
        detail: nickname ?? 'removido',
      });
    }
    ioOf(app)?.to(communityRoom(p.data.id)).emit('community:changed', { communityId: p.data.id });
    return reply.send({ nickname });
  });
}
