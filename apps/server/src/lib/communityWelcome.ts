import type { Server } from 'socket.io';
import { DEFAULT_WELCOME_MESSAGE, renderWelcomeMessage } from '@scale/shared';
import { prisma } from './prisma.js';
import { communityRoom, toChannelMessage } from './communityAccess.js';
import { emitCommunityActivity } from './unread.js';

/** Autor exibido nas mensagens de sistema (sem id: ninguem edita). */
export const SYSTEM_AUTHOR = { id: null, name: 'Sistema', username: null } as const;

/**
 * Canal de boas-vindas valido da comunidade: canal de TEXTO dela. Canal
 * apagado (ou de outra comunidade) conta como "sem boas-vindas".
 */
export async function welcomeChannelOf(communityId: string): Promise<{ channelId: string; message: string } | null> {
  const community = await prisma.community.findUnique({ where: { id: communityId }, select: { welcomeChannelId: true, welcomeMessage: true } });
  if (!community?.welcomeChannelId) return null;
  const room = await prisma.room.findUnique({ where: { id: community.welcomeChannelId }, select: { communityId: true, channelKind: true } });
  if (room?.communityId !== communityId || room.channelKind !== 'TEXT') return null;
  return { channelId: community.welcomeChannelId, message: community.welcomeMessage ?? DEFAULT_WELCOME_MESSAGE };
}

/**
 * Posta a mensagem de sistema de boas-vindas (entrada por convite). Devolve o
 * canal para o cliente abrir direto nele; null = comunidade sem boas-vindas.
 */
export async function postWelcomeMessage(io: Server | undefined, communityId: string, userId: string): Promise<string | null> {
  const welcome = await welcomeChannelOf(communityId);
  if (!welcome) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  if (!user) return null;
  const row = await prisma.chatMessage.create({
    data: { roomId: welcome.channelId, authorId: null, isSystem: true, content: renderWelcomeMessage(welcome.message, user.name) },
  });
  io?.to(communityRoom(communityId)).emit('channel:message', toChannelMessage(row, SYSTEM_AUTHOR));
  await emitCommunityActivity(io, communityId, welcome.channelId, null);
  return welcome.channelId;
}
