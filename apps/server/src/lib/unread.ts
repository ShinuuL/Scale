import { Prisma } from '@prisma/client';
import { UNREAD_COUNT_CAP } from '@scale/shared';
import type { Server } from 'socket.io';
import { prisma } from './prisma.js';
import { userRoom } from '../socket/handler.js';
import { channelViewers } from './channelPermissions.js';

export interface ChannelUnread { communityId: string; channelId: string; unread: number }

/**
 * Nao lidas por canal de texto, de uma comunidade ou de todas as do usuario.
 * Base: ultima leitura (ChannelReadState) ou, sem leitura, a entrada na
 * comunidade. Nao contam mensagens do proprio usuario nem apagadas. Cada canal
 * para em UNREAD_COUNT_CAP (subconsulta com LIMIT sobre o indice
 * ChatMessage(roomId, createdAt)): o custo nao cresce com o historico.
 */
export async function channelUnreads(userId: string, communityId?: string): Promise<ChannelUnread[]> {
  const scope = communityId ? Prisma.sql`AND r."communityId" = ${communityId}` : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ communityId: string; channelId: string; unread: bigint | number }>>`
    SELECT r."communityId" AS "communityId", r."id" AS "channelId",
      (SELECT COUNT(*) FROM (
        SELECT 1 FROM "ChatMessage" m
        WHERE m."roomId" = r."id"
          AND m."createdAt" > COALESCE(s."lastReadAt", cm."joinedAt")
          AND m."deletedAt" IS NULL
          AND (m."authorId" IS NULL OR m."authorId" <> ${userId})
        LIMIT ${UNREAD_COUNT_CAP}
      )) AS "unread"
    FROM "Room" r
    JOIN "CommunityMember" cm ON cm."communityId" = r."communityId" AND cm."userId" = ${userId}
    LEFT JOIN "ChannelReadState" s ON s."channelId" = r."id" AND s."userId" = ${userId}
    WHERE r."channelKind" = 'TEXT' ${scope}`;
  return rows.map(row => ({ communityId: row.communityId, channelId: row.channelId, unread: Number(row.unread) }));
}

/** Soma por comunidade (cada canal ja limitado ao teto). */
export function totalsByCommunity(rows: ChannelUnread[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.communityId, (totals.get(row.communityId) ?? 0) + row.unread);
  return totals;
}

/** Marca canais como lidos agora (upsert por usuario+canal). */
export async function markChannelsRead(userId: string, channelIds: string[]): Promise<Date> {
  const now = new Date();
  await prisma.$transaction(channelIds.map(channelId => prisma.channelReadState.upsert({
    where: { userId_channelId: { userId, channelId } },
    create: { userId, channelId, lastReadAt: now },
    update: { lastReadAt: now },
  })));
  return now;
}

/**
 * Aviso leve de mensagem nova para a sala pessoal (`user:<id>`) de cada membro:
 * o cliente so acompanha os eventos `channel:*` da comunidade aberta, entao a
 * bolinha das outras comunidades no rail depende deste evento. Sem conteudo.
 */
export async function emitCommunityActivity(io: Server | undefined, communityId: string, channelId: string, authorId: string | null): Promise<void> {
  if (!io) return;
  // Fase 3: so quem ve o canal recebe o aviso.
  const viewers = await channelViewers(communityId, channelId)
    ?? (await prisma.communityMember.findMany({ where: { communityId }, select: { userId: true } })).map(m => m.userId);
  if (viewers.length) io.to(viewers.map(userRoom)).emit('community:activity', { communityId, channelId, authorId });
}
