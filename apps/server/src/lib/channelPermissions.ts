import type { Server } from 'socket.io';
import { resolveChannelAccess, type ChannelAccess } from '@scale/shared';
import { prisma } from './prisma.js';
import { canModerate, communityRoom, findMembership, type Membership } from './communityAccess.js';

/**
 * Fase 3: permissoes por canal, canal de avisos e modo lento.
 *
 * "Gerencia" = dono, ADMIN ou cargo com manageChannels: sempre passa (ve,
 * envia em aviso e fica isento do modo lento). Canal invisivel responde 404
 * (igual a nao membro: nao revela). Eventos de canal com restricao de leitura
 * saem por `user:<id>` so para quem ve; sem restricao, pela sala da comunidade.
 */
export const isChannelManager = (member: Pick<Membership, 'role' | 'customRole'>): boolean =>
  canModerate(member.role) || Boolean(member.customRole?.manageChannels);

interface ChannelRow { id: string; announcement: boolean }
type OverrideRow = { roomId: string; target: string; viewChannel: boolean | null; sendMessages: boolean | null };

export async function channelAccessFor(member: Membership, room: ChannelRow): Promise<ChannelAccess> {
  if (isChannelManager(member)) return { view: true, send: true, manage: true };
  const overrides = await prisma.channelPermissionOverride.findMany({ where: { roomId: room.id } });
  return resolveChannelAccess({ manager: false, customRoleId: member.customRoleId, announcement: room.announcement }, overrides);
}

/** Membro + acesso ao canal de comunidade; null = nao membro ou nao ve (404). */
export async function viewableChannel(roomId: string, userId: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId } });
  if (!room?.communityId) return null;
  const member = await findMembership(room.communityId, userId);
  if (!member) return null;
  const access = await channelAccessFor(member, room);
  if (!access.view) return null;
  return { room: { ...room, communityId: room.communityId }, member, access };
}

/** Ids de canais que o usuario NAO ve, em uma ou todas as suas comunidades. */
export async function hiddenChannelIds(userId: string, communityId?: string): Promise<Set<string>> {
  const members = await prisma.communityMember.findMany({
    where: { userId, ...(communityId ? { communityId } : {}) },
    select: { communityId: true, role: true, customRoleId: true, customRole: { select: { manageChannels: true, manageInvites: true, manageMessages: true, kickMembers: true } } },
  });
  const restricted = members.filter((m) => !isChannelManager(m));
  if (!restricted.length) return new Set();
  const rows = await prisma.channelPermissionOverride.findMany({
    where: { viewChannel: { not: null }, room: { communityId: { in: restricted.map((m) => m.communityId) } } },
    select: { roomId: true, target: true, viewChannel: true, sendMessages: true, room: { select: { communityId: true } } },
  });
  const byRoom = new Map<string, { communityId: string; list: OverrideRow[] }>();
  for (const row of rows) {
    const entry = byRoom.get(row.roomId) ?? { communityId: row.room.communityId ?? '', list: [] };
    entry.list.push(row); byRoom.set(row.roomId, entry);
  }
  const hidden = new Set<string>();
  for (const [roomId, entry] of byRoom) {
    const member = restricted.find((m) => m.communityId === entry.communityId);
    if (member && !resolveChannelAccess({ manager: false, customRoleId: member.customRoleId, announcement: false }, entry.list).view) hidden.add(roomId);
  }
  return hidden;
}

/** Quem ve o canal: null = todos os membros (nenhuma restricao de leitura). */
export async function channelViewers(communityId: string, roomId: string): Promise<string[] | null> {
  const overrides = await prisma.channelPermissionOverride.findMany({ where: { roomId } });
  if (!overrides.some((o) => o.viewChannel === false)) return null;
  const members = await prisma.communityMember.findMany({
    where: { communityId },
    select: { userId: true, role: true, customRoleId: true, customRole: { select: { manageChannels: true, manageInvites: true, manageMessages: true, kickMembers: true } } },
  });
  return members
    .filter((m) => isChannelManager(m) || resolveChannelAccess({ manager: false, customRoleId: m.customRoleId, announcement: false }, overrides).view)
    .map((m) => m.userId);
}

/** Emite um evento de canal so para quem o ve. `exceptSocketId` exclui o remetente. */
export async function emitToChannel(io: Server | undefined, communityId: string, roomId: string, event: string, payload: unknown, exceptSocketId?: string): Promise<void> {
  if (!io) return;
  const viewers = await channelViewers(communityId, roomId);
  const target = viewers === null ? io.to(communityRoom(communityId)) : viewers.length ? io.to(viewers.map((id) => `user:${id}`)) : null;
  if (!target) return;
  (exceptSocketId ? target.except(exceptSocketId) : target).emit(event, payload);
}

/**
 * Modo lento: segundos que faltam para o usuario poder enviar de novo neste
 * canal (0 = liberado). Base: a ultima mensagem dele no canal (sobrevive a
 * reinicio do servidor).
 */
export async function slowModeRemaining(room: { id: string; slowModeSeconds: number }, userId: string, now = Date.now()): Promise<number> {
  if (room.slowModeSeconds <= 0) return 0;
  const last = await prisma.chatMessage.findFirst({ where: { roomId: room.id, authorId: userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  if (!last) return 0;
  const wait = last.createdAt.getTime() + room.slowModeSeconds * 1000 - now;
  return wait > 0 ? Math.ceil(wait / 1000) : 0;
}

export type PostCheck = { ok: true } | { ok: false; status: 403 | 429; body: { error: string; retryAfterSeconds?: number } };

/** Pode postar agora? Nega envio/aviso (403) e aplica o modo lento (429). */
export async function checkChannelPost(room: { id: string; slowModeSeconds: number }, access: ChannelAccess, userId: string): Promise<PostCheck> {
  if (!access.send) return { ok: false, status: 403, body: { error: 'Sem permissão para enviar neste canal' } };
  if (access.manage) return { ok: true };
  const remaining = await slowModeRemaining(room, userId);
  if (remaining > 0) return { ok: false, status: 429, body: { error: `Modo lento: aguarde ${remaining} s`, retryAfterSeconds: remaining } };
  return { ok: true };
}
