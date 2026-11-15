import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  TIMEOUT_DURATIONS, TIMEOUT_DURATION_LABELS, communityAuditQuerySchema, memberTimeoutSchema, moderationReasonBodySchema,
  type CommunityAuditAction, type CommunityAuditEntry, type CommunityBan,
} from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { communityRoom, findMembership, permissionsOf, type Membership } from '../lib/communityAccess.js';
import { activeTimeout, audit, canModerateMember, notifyTarget } from '../lib/communityModeration.js';
import { isCommunityModerationRateLimited } from '../lib/rateLimit.js';
import { evictCommunityUser, evictCommunityVoice } from '../socket/handler.js';

/**
 * Fase 3 das comunidades: castigo, banimento, expulsao e auditoria.
 *
 *  - PUT    /api/communities/:id/members/:userId/timeout  { duration, reason? }
 *  - DELETE /api/communities/:id/members/:userId/timeout
 *  - POST   /api/communities/:id/members/:userId/kick     { reason? }
 *  - PUT    /api/communities/:id/bans/:userId             { reason? }
 *  - DELETE /api/communities/:id/bans/:userId
 *  - GET    /api/communities/:id/bans                     (kickMembers)
 *  - GET    /api/communities/:id/audit?cursor&limit       (quem gerencia)
 *
 * Acoes sobre membro exigem `kickMembers` e nivel maior que o alvo
 * (lib/communityModeration.ts). Nao membro recebe 404.
 */
const params = z.object({ id: z.string().uuid() });
const memberParams = params.extend({ userId: z.string().min(1).max(64) });
const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;
const missing = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'Not found' });
const invalid = (reply: FastifyReply): FastifyReply => reply.code(400).send({ error: 'Invalid input' });
const forbidden = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'Forbidden' });
const limited = (reply: FastifyReply, seconds: number): FastifyReply =>
  reply.code(429).header('Retry-After', String(seconds)).send({ error: 'Too many requests' });

interface TargetAccess {
  communityId: string; communityName: string; me: string; userId: string; target: Membership; targetName: string;
}

/** Valida params, permissao, hierarquia e rate limit; responde e devolve null quando recusa. */
async function targetAccess(request: FastifyRequest, reply: FastifyReply): Promise<TargetAccess | null> {
  const p = memberParams.safeParse(request.params);
  if (!p.success) { invalid(reply); return null; }
  const me = request.userId!;
  const actor = await findMembership(p.data.id, me);
  if (!actor) { missing(reply); return null; }
  const target = await findMembership(p.data.id, p.data.userId);
  if (!target) { missing(reply); return null; }
  if (p.data.userId === me || !canModerateMember(actor, target)) { forbidden(reply); return null; }
  const limit = isCommunityModerationRateLimited(me);
  if (limit.limited) { limited(reply, limit.retryAfterSeconds); return null; }
  const [community, user] = await Promise.all([
    prisma.community.findUnique({ where: { id: p.data.id }, select: { name: true } }),
    prisma.user.findUnique({ where: { id: p.data.userId }, select: { name: true } }),
  ]);
  return { communityId: p.data.id, communityName: community?.name ?? '', me, userId: p.data.userId, target, targetName: user?.name ?? '' };
}

export async function communityModerationRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };
  const changed = (id: string): void => { ioOf(app)?.to(communityRoom(id)).emit('community:changed', { communityId: id }); };

  app.put('/api/communities/:id/members/:userId/timeout', auth, async (request, reply) => {
    const body = memberTimeoutSchema.safeParse(request.body);
    if (!body.success) return invalid(reply);
    const a = await targetAccess(request, reply);
    if (!a) return reply;
    const until = new Date(Date.now() + TIMEOUT_DURATIONS[body.data.duration]);
    const reason = body.data.reason ?? null;
    await prisma.communityMember.update({ where: { id: a.target.id }, data: { timeoutUntil: until, timeoutReason: reason } });
    await audit(a.communityId, { action: 'member.timeout', actorId: a.me, targetId: a.userId, targetName: a.targetName, reason, detail: TIMEOUT_DURATION_LABELS[body.data.duration] });
    notifyTarget(ioOf(app), a.userId, { communityId: a.communityId, communityName: a.communityName, action: 'timeout', until: until.toISOString(), reason });
    await evictCommunityVoice(ioOf(app), a.communityId, a.userId);
    changed(a.communityId);
    return reply.send({ timeoutUntil: until.toISOString() });
  });

  app.delete('/api/communities/:id/members/:userId/timeout', auth, async (request, reply) => {
    const a = await targetAccess(request, reply);
    if (!a) return reply;
    if (!activeTimeout(a.target)) return reply.send({ ok: true });
    await prisma.communityMember.update({ where: { id: a.target.id }, data: { timeoutUntil: null, timeoutReason: null } });
    await audit(a.communityId, { action: 'member.untimeout', actorId: a.me, targetId: a.userId, targetName: a.targetName });
    notifyTarget(ioOf(app), a.userId, { communityId: a.communityId, communityName: a.communityName, action: 'untimeout', until: null, reason: null });
    changed(a.communityId);
    return reply.send({ ok: true });
  });

  /** Expulsao ou banimento: remove o membro, avisa e tira da voz e da comunidade. */
  const remove = async (request: FastifyRequest, reply: FastifyReply, ban: boolean): Promise<FastifyReply> => {
    const body = moderationReasonBodySchema.safeParse(request.body ?? {});
    if (!body.success) return invalid(reply);
    const a = await targetAccess(request, reply);
    if (!a) return reply;
    const reason = body.data.reason ?? null;
    await prisma.$transaction(async (tx) => {
      if (ban) {
        await tx.communityBan.upsert({
          where: { communityId_userId: { communityId: a.communityId, userId: a.userId } },
          create: { communityId: a.communityId, userId: a.userId, userName: a.targetName, bannedById: a.me, reason },
          update: { userName: a.targetName, bannedById: a.me, reason },
        });
      }
      await tx.communityMember.deleteMany({ where: { id: a.target.id } });
    });
    const action: CommunityAuditAction = ban ? 'member.ban' : 'member.kick';
    await audit(a.communityId, { action, actorId: a.me, targetId: a.userId, targetName: a.targetName, reason });
    notifyTarget(ioOf(app), a.userId, { communityId: a.communityId, communityName: a.communityName, action: ban ? 'ban' : 'kick', until: null, reason });
    await evictCommunityUser(ioOf(app), a.communityId, a.userId);
    changed(a.communityId);
    return reply.send({ ok: true });
  };
  app.post('/api/communities/:id/members/:userId/kick', auth, (request, reply) => remove(request, reply, false));
  app.put('/api/communities/:id/bans/:userId', auth, (request, reply) => remove(request, reply, true));

  app.delete('/api/communities/:id/bans/:userId', auth, async (request, reply) => {
    const p = memberParams.safeParse(request.params);
    if (!p.success) return invalid(reply);
    const me = request.userId!;
    const actor = await findMembership(p.data.id, me);
    if (!actor) return missing(reply);
    if (!permissionsOf(actor).kickMembers) return forbidden(reply);
    const limit = isCommunityModerationRateLimited(me);
    if (limit.limited) return limited(reply, limit.retryAfterSeconds);
    try {
      const ban = await prisma.communityBan.delete({ where: { communityId_userId: { communityId: p.data.id, userId: p.data.userId } } });
      await audit(p.data.id, { action: 'member.unban', actorId: me, targetId: ban.userId, targetName: ban.userName });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') return missing(reply);
      throw err;
    }
    return reply.send({ ok: true });
  });

  app.get('/api/communities/:id/bans', auth, async (request, reply) => {
    const p = params.safeParse(request.params);
    if (!p.success) return invalid(reply);
    const actor = await findMembership(p.data.id, request.userId!);
    if (!actor) return missing(reply);
    if (!permissionsOf(actor).kickMembers) return forbidden(reply);
    const rows = await prisma.communityBan.findMany({ where: { communityId: p.data.id }, orderBy: { createdAt: 'desc' }, take: 500 });
    const bans: CommunityBan[] = rows.map((r) => ({
      userId: r.userId, name: r.userName, reason: r.reason, bannedById: r.bannedById, createdAt: r.createdAt.toISOString(),
    }));
    return reply.send({ bans });
  });

  app.get('/api/communities/:id/audit', auth, async (request, reply) => {
    const p = params.safeParse(request.params);
    const q = communityAuditQuerySchema.safeParse(request.query);
    if (!p.success || !q.success) return invalid(reply);
    const actor = await findMembership(p.data.id, request.userId!);
    if (!actor) return missing(reply);
    if (!Object.values(permissionsOf(actor)).some(Boolean)) return forbidden(reply);
    const cursorId = q.data.cursor;
    let cursorDate: Date | undefined;
    if (cursorId) {
      const cursor = await prisma.communityAuditLog.findUnique({ where: { id: cursorId } });
      if (!cursor || cursor.communityId !== p.data.id) return missing(reply);
      cursorDate = cursor.createdAt;
    }
    const rows = await prisma.communityAuditLog.findMany({
      where: {
        communityId: p.data.id,
        ...(cursorDate && cursorId ? { OR: [{ createdAt: { lt: cursorDate } }, { createdAt: cursorDate, id: { lt: cursorId } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.data.limit,
    });
    const entries: CommunityAuditEntry[] = rows.map((r) => ({
      id: r.id, action: r.action as CommunityAuditAction, actorId: r.actorId, actorName: r.actorName, targetId: r.targetId,
      targetName: r.targetName, reason: r.reason, detail: r.detail, createdAt: r.createdAt.toISOString(),
    }));
    return reply.send({ entries, nextCursor: rows.length === q.data.limit ? rows[rows.length - 1]?.id ?? null : null });
  });
}
