import { CHANNEL_REACTIONS, REPLY_EXCERPT_MAX, channelReactionSchema, type ChannelReactionSummary, type ChannelReply } from '@scale/shared';
import { prisma } from './prisma.js';
import { toChannelMessage } from './communityAccess.js';

/**
 * Metadados da Fase 2 das mensagens de canal: citacao da resposta e reacoes.
 * Carregados em lote (uma consulta por tipo) para a pagina de historico.
 */

/** Trecho curto: uma linha, ate REPLY_EXCERPT_MAX caracteres. */
export function excerptOf(content: string): string {
  const line = content.replace(/\s+/g, ' ').trim();
  return line.length > REPLY_EXCERPT_MAX ? `${line.slice(0, REPLY_EXCERPT_MAX - 1)}…` : line;
}

/** Citacoes por id da mensagem citada. Citada sumida (ou de outro canal) = "apagada". */
export async function loadReplies(roomId: string, replyIds: string[]): Promise<Map<string, ChannelReply>> {
  const ids = [...new Set(replyIds)];
  const result = new Map<string, ChannelReply>();
  if (ids.length === 0) return result;
  const rows = await prisma.chatMessage.findMany({ where: { id: { in: ids }, roomId }, select: { id: true, authorId: true, guestName: true, content: true, deletedAt: true } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.flatMap(r => (r.authorId ? [r.authorId] : [])) } }, select: { id: true, name: true } });
  const names = new Map(users.map(u => [u.id, u.name]));
  for (const row of rows) {
    const deleted = row.deletedAt != null;
    result.set(row.id, { id: row.id, authorName: (row.authorId ? names.get(row.authorId) : undefined) ?? row.guestName ?? 'Usuário', excerpt: deleted ? '' : excerptOf(row.content), deleted });
  }
  for (const id of ids) if (!result.has(id)) result.set(id, { id, authorName: '', excerpt: '', deleted: true });
  return result;
}

/** Agrupa linhas de reacao na ordem fixa do conjunto. */
export function summarizeReactions(rows: Array<{ reaction: string; userId: string }>): ChannelReactionSummary[] {
  return CHANNEL_REACTIONS.flatMap(reaction => {
    const userIds = rows.filter(r => r.reaction === reaction).map(r => r.userId);
    return userIds.length ? [{ reaction, userIds }] : [];
  });
}

/** Reacoes por mensagem (reacoes fora do conjunto atual sao ignoradas). */
export async function loadReactions(messageIds: string[]): Promise<Map<string, ChannelReactionSummary[]>> {
  const result = new Map<string, ChannelReactionSummary[]>();
  if (messageIds.length === 0) return result;
  const rows = await prisma.chatMessageReaction.findMany({ where: { messageId: { in: messageIds } }, orderBy: { createdAt: 'asc' }, select: { messageId: true, userId: true, reaction: true } });
  const byMessage = new Map<string, Array<{ reaction: string; userId: string }>>();
  for (const row of rows) {
    if (!channelReactionSchema.safeParse(row.reaction).success) continue;
    const list = byMessage.get(row.messageId) ?? [];
    list.push(row);
    byMessage.set(row.messageId, list);
  }
  for (const [id, list] of byMessage) result.set(id, summarizeReactions(list));
  return result;
}

type MessageRow = Parameters<typeof toChannelMessage>[0] & { authorId: string | null; guestName: string | null; replyToId: string | null };

/** DTOs completos (autor, citacao, reacoes) de uma lista de mensagens do mesmo canal. */
export async function buildChannelMessages(roomId: string, rows: MessageRow[]): Promise<Array<ReturnType<typeof toChannelMessage>>> {
  const [authors, replies, reactions] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: rows.flatMap(row => (row.authorId ? [row.authorId] : [])) } }, include: { username: true } }),
    loadReplies(roomId, rows.flatMap(row => (row.replyToId ? [row.replyToId] : []))),
    loadReactions(rows.map(row => row.id)),
  ]);
  const users = new Map(authors.map(user => [user.id, user]));
  return rows.map(row => {
    const user = row.authorId ? users.get(row.authorId) : undefined;
    return toChannelMessage(row, { id: row.authorId, name: user?.name ?? row.guestName ?? 'Usuário', username: user?.username?.name ?? null }, {
      replyTo: row.replyToId ? replies.get(row.replyToId) ?? null : null,
      reactions: reactions.get(row.id) ?? [],
    });
  });
}
