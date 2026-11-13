import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { MESSAGE_SEARCH_PAGE, matchesSearch, messageSearchQuerySchema, type MessageSearchHit } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { findMembership } from '../lib/communityAccess.js';
import { hiddenChannelIds } from '../lib/channelPermissions.js';
import { isMessageSearchRateLimited } from '../lib/rateLimit.js';

/**
 * Busca de mensagens de uma comunidade (todos os canais de texto).
 *
 * Por que nao LIKE/FTS5: o LIKE do SQLite so ignora caixa em ASCII e nao ignora
 * acento; FTS5 exige tabela virtual + gatilhos que o `prisma db push` nao cria.
 * Entao o banco filtra o que sabe (comunidade, canal, autor, datas, nao apagada)
 * e a comparacao do texto e feita em JS com `normalizeForSearch` (NFD sem marcas
 * + minusculas): "acao" acha "Ação". A varredura e limitada a SCAN_MAX linhas
 * por requisicao; o cursor e a ultima linha VARRIDA, entao uma pagina pode vir
 * com menos de 25 resultados e ainda ter `nextCursor`.
 */
const SCAN_BATCH = 250;
const SCAN_MAX = 2_000;
const params = z.object({ id: z.string().uuid() });

export async function communitySearchRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };
  app.get('/api/communities/:id/search', auth, async (request: FastifyRequest, reply) => {
    const p = params.safeParse(request.params); const query = messageSearchQuerySchema.safeParse(request.query);
    if (!p.success || !query.success) return reply.code(400).send({ error: 'Invalid input' });
    const me = request.userId!;
    if (!await findMembership(p.data.id, me)) return reply.code(404).send({ error: 'Not found' });
    const limit = isMessageSearchRateLimited(me);
    if (limit.limited) return reply.code(429).header('Retry-After', String(limit.retryAfterSeconds)).send({ error: 'Too many requests' });
    const { q, channelId, authorId, from, to, cursor } = query.data;

    const channels = await prisma.room.findMany({ where: { communityId: p.data.id, channelKind: 'TEXT' }, select: { id: true, name: true } });
    const hidden = await hiddenChannelIds(me, p.data.id);
    const names = new Map(channels.filter((c) => !hidden.has(c.id)).map((c) => [c.id, c.name]));
    if (channelId && !names.has(channelId)) return reply.code(404).send({ error: 'Not found' });

    const base: Prisma.ChatMessageWhereInput = {
      roomId: channelId ? channelId : { in: [...names.keys()] },
      deletedAt: null,
      ...(authorId ? { authorId } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } } : {}),
    };
    let after: { createdAt: Date; id: string } | null = null;
    if (cursor) {
      const row = await prisma.chatMessage.findUnique({ where: { id: cursor }, select: { createdAt: true, id: true, roomId: true } });
      if (!row || !names.has(row.roomId)) return reply.code(404).send({ error: 'Not found' });
      after = row;
    }

    const hits: Array<{ id: string; roomId: string; authorId: string | null; guestName: string | null; content: string; createdAt: Date }> = [];
    let scanned = 0;
    let lastScanned: string | null = null;
    let exhausted = false;
    while (hits.length < MESSAGE_SEARCH_PAGE && scanned < SCAN_MAX) {
      const pos: { createdAt: Date; id: string } | null = after;
      const rows = await prisma.chatMessage.findMany({
        where: pos ? { AND: [base, { OR: [{ createdAt: { lt: pos.createdAt } }, { createdAt: pos.createdAt, id: { lt: pos.id } }] }] } : base,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: SCAN_BATCH,
        select: { id: true, roomId: true, authorId: true, guestName: true, content: true, createdAt: true },
      });
      for (const row of rows) {
        scanned++; lastScanned = row.id; after = row;
        if (matchesSearch(row.content, q)) hits.push(row);
        if (hits.length >= MESSAGE_SEARCH_PAGE) break;
      }
      if (rows.length < SCAN_BATCH && (hits.length < MESSAGE_SEARCH_PAGE || lastScanned === rows[rows.length - 1]?.id)) { exhausted = true; break; }
    }

    const users = await prisma.user.findMany({ where: { id: { in: hits.flatMap((h) => h.authorId ? [h.authorId] : []) } }, include: { username: true } });
    const byId = new Map(users.map((u) => [u.id, u]));
    const results: MessageSearchHit[] = hits.map((h) => {
      const user = h.authorId ? byId.get(h.authorId) : undefined;
      return { id: h.id, channelId: h.roomId, channelName: names.get(h.roomId) ?? '', author: { id: h.authorId, name: user?.name ?? h.guestName ?? 'Usuário', username: user?.username?.name ?? null }, content: h.content, createdAt: h.createdAt.toISOString() };
    });
    return reply.send({ results, nextCursor: exhausted ? null : lastScanned });
  });
}
