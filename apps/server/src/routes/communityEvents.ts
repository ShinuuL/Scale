import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import {
  MAX_UPCOMING_COMMUNITY_EVENTS, communityEventInputSchema, communityEventInterestSchema,
  type CommunityEvent,
} from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/communityModeration.js';
import { communityRoom, findMembership, permissionsOf, type Membership } from '../lib/communityAccess.js';
import { channelAccessFor, hiddenChannelIds } from '../lib/channelPermissions.js';
import { isCommunityEventRateLimited } from '../lib/rateLimit.js';

/**
 * Fase 4: eventos agendados da comunidade.
 *
 *  - GET    /api/communities/:id/events          proximos (nao terminados), membro
 *  - POST   /api/communities/:id/events          cria (dono/ADMIN/manageChannels)
 *  - PATCH  /api/community-events/:id            edita (idem)
 *  - DELETE /api/community-events/:id            cancela (idem; apaga a linha)
 *  - PUT    /api/community-events/:id/interest   { interested } (qualquer membro)
 *
 * Canal de voz opcional: so um canal VOICE da comunidade que o autor ve.
 * Na listagem, canal que o leitor nao ve (ou apagado) sai como "sem canal".
 * Toda escrita emite `community:changed`; criar/editar/cancelar vao para a auditoria.
 * Nao membro = 404 (nao revela a comunidade).
 */
const idParams = z.object({ id: z.string().uuid() });
const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;
const missing = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'Not found' });
const invalid = (reply: FastifyReply, error = 'Invalid input'): FastifyReply => reply.code(400).send({ error });
const forbidden = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'Forbidden' });
const meOf = (request: FastifyRequest): string => request.userId!;

/** Ainda nao terminou (fim, ou inicio se nao ha fim, no futuro). */
const upcomingWhere = (now: Date) => ({ OR: [{ endsAt: { gt: now } }, { endsAt: null, startsAt: { gt: now } }] });

/** Canal de voz valido para o autor, ou mensagem de erro. */
async function checkChannel(communityId: string, member: Membership, channelId: string | null): Promise<string | null> {
  if (!channelId) return null;
  const room = await prisma.room.findUnique({ where: { id: channelId } });
  if (!room || room.communityId !== communityId || room.channelKind !== 'VOICE') return 'Canal de voz inválido';
  return (await channelAccessFor(member, room)).view ? null : 'Canal de voz inválido';
}

export async function communityEventRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };
  const changed = (communityId: string): void => {
    ioOf(app)?.to(communityRoom(communityId)).emit('community:changed', { communityId });
  };
  /** Balde por usuario: true = ja respondeu 429. */
  const limited = (request: FastifyRequest, reply: FastifyReply): boolean => {
    const result = isCommunityEventRateLimited(meOf(request));
    if (!result.limited) return false;
    void reply.code(429).header('Retry-After', String(Math.max(1, result.retryAfterSeconds))).send({ error: 'Too many requests. Try again later.' });
    return true;
  };
  /** Evento + membership de quem gere eventos; responde o erro e devolve null. */
  async function managedEvent(request: FastifyRequest, reply: FastifyReply) {
    const p = idParams.safeParse(request.params);
    if (!p.success) { invalid(reply); return null; }
    const event = await prisma.communityEvent.findUnique({ where: { id: p.data.id } });
    if (!event) { missing(reply); return null; }
    const member = await findMembership(event.communityId, meOf(request));
    if (!member) { missing(reply); return null; }
    if (!permissionsOf(member).manageChannels) { forbidden(reply); return null; }
    return { event, member };
  }

  app.get('/api/communities/:id/events', auth, async (request, reply) => {
    const p = idParams.safeParse(request.params); if (!p.success) return invalid(reply);
    const me = meOf(request);
    if (!(await findMembership(p.data.id, me))) return missing(reply);
    const rows = await prisma.communityEvent.findMany({
      where: { communityId: p.data.id, ...upcomingWhere(new Date()) },
      orderBy: { startsAt: 'asc' },
      take: MAX_UPCOMING_COMMUNITY_EVENTS,
      include: { _count: { select: { interests: true } }, interests: { where: { userId: me }, select: { userId: true } } },
    });
    const channelIds = [...new Set(rows.map((r) => r.channelId).filter((id): id is string => Boolean(id)))];
    const [rooms, hidden] = await Promise.all([
      channelIds.length ? prisma.room.findMany({ where: { id: { in: channelIds }, communityId: p.data.id }, select: { id: true, name: true } }) : Promise.resolve([]),
      hiddenChannelIds(me, p.data.id),
    ]);
    const names = new Map(rooms.filter((r) => !hidden.has(r.id)).map((r) => [r.id, r.name]));
    const events: CommunityEvent[] = rows.map((r) => {
      const channelName = r.channelId ? names.get(r.channelId) ?? null : null;
      return {
        id: r.id, communityId: r.communityId, title: r.title, description: r.description,
        startsAt: r.startsAt.toISOString(), endsAt: r.endsAt?.toISOString() ?? null,
        channelId: channelName === null ? null : r.channelId, channelName,
        creatorName: r.creatorName, interestedCount: r._count.interests, interested: r.interests.length > 0,
      };
    });
    return reply.send({ events });
  });

  app.post('/api/communities/:id/events', auth, async (request, reply) => {
    const p = idParams.safeParse(request.params); const body = communityEventInputSchema.safeParse(request.body);
    if (!p.success || !body.success) return invalid(reply);
    const communityId = p.data.id; const me = meOf(request);
    const member = await findMembership(communityId, me); if (!member) return missing(reply);
    if (!permissionsOf(member).manageChannels) return forbidden(reply);
    if (limited(request, reply)) return reply;
    const data = body.data; const now = new Date();
    if (Date.parse(data.endsAt ?? data.startsAt) <= now.getTime()) return invalid(reply, 'O evento precisa terminar no futuro');
    const channelError = await checkChannel(communityId, member, data.channelId);
    if (channelError) return invalid(reply, channelError);
    const upcoming = await prisma.communityEvent.count({ where: { communityId, ...upcomingWhere(now) } });
    if (upcoming >= MAX_UPCOMING_COMMUNITY_EVENTS) return invalid(reply, 'Limite de eventos agendados atingido');
    const creator = await prisma.user.findUnique({ where: { id: me }, select: { name: true } });
    const event = await prisma.communityEvent.create({
      data: {
        communityId, creatorId: me, creatorName: creator?.name ?? 'Desconhecido', title: data.title, description: data.description,
        startsAt: new Date(data.startsAt), endsAt: data.endsAt ? new Date(data.endsAt) : null, channelId: data.channelId,
      },
    });
    await audit(communityId, { action: 'event.create', actorId: me, targetId: event.id, targetName: event.title });
    changed(communityId);
    return reply.code(201).send({ id: event.id });
  });

  app.patch('/api/community-events/:id', auth, async (request, reply) => {
    const body = communityEventInputSchema.safeParse(request.body);
    const found = await managedEvent(request, reply); if (!found) return reply;
    if (!body.success) return invalid(reply);
    if (limited(request, reply)) return reply;
    const { event, member } = found; const data = body.data;
    if (Date.parse(data.endsAt ?? data.startsAt) <= Date.now()) return invalid(reply, 'O evento precisa terminar no futuro');
    if (data.channelId !== event.channelId) {
      const channelError = await checkChannel(event.communityId, member, data.channelId);
      if (channelError) return invalid(reply, channelError);
    }
    await prisma.communityEvent.update({
      where: { id: event.id },
      data: {
        title: data.title, description: data.description, startsAt: new Date(data.startsAt),
        endsAt: data.endsAt ? new Date(data.endsAt) : null, channelId: data.channelId,
      },
    });
    await audit(event.communityId, { action: 'event.update', actorId: meOf(request), targetId: event.id, targetName: data.title, detail: event.title !== data.title ? event.title : null });
    changed(event.communityId);
    return reply.send({ ok: true });
  });

  app.delete('/api/community-events/:id', auth, async (request, reply) => {
    const found = await managedEvent(request, reply); if (!found) return reply;
    if (limited(request, reply)) return reply;
    const { event } = found;
    await prisma.communityEvent.delete({ where: { id: event.id } });
    await audit(event.communityId, { action: 'event.cancel', actorId: meOf(request), targetId: event.id, targetName: event.title });
    changed(event.communityId);
    return reply.send({ ok: true });
  });

  app.put('/api/community-events/:id/interest', auth, async (request, reply) => {
    const p = idParams.safeParse(request.params); const body = communityEventInterestSchema.safeParse(request.body);
    if (!p.success || !body.success) return invalid(reply);
    const me = meOf(request);
    const event = await prisma.communityEvent.findUnique({ where: { id: p.data.id } }); if (!event) return missing(reply);
    if (!(await findMembership(event.communityId, me))) return missing(reply);
    if (limited(request, reply)) return reply;
    const key = { eventId_userId: { eventId: event.id, userId: me } };
    if (body.data.interested) await prisma.communityEventInterest.upsert({ where: key, create: { eventId: event.id, userId: me }, update: {} });
    else await prisma.communityEventInterest.deleteMany({ where: { eventId: event.id, userId: me } });
    const interestedCount = await prisma.communityEventInterest.count({ where: { eventId: event.id } });
    changed(event.communityId);
    return reply.send({ interested: body.data.interested, interestedCount });
  });
}
