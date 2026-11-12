import type { CommunityRole } from '@scale/shared';
import { prisma } from './prisma.js';
import { toPublicFile } from './publicDto.js';

interface ChannelMessageRow {
  id: string; roomId: string; content: string; createdAt: Date; editedAt: Date | null; deletedAt: Date | null;
  files?: Array<{ id: string; filename: string; mime: string; size: number; deletedAt: Date | null }>;
}

/** DTO unico de mensagem de canal (rota de texto, upload e socket). Apagada = sem arquivos. */
export function toChannelMessage(row: ChannelMessageRow, author: { id: string | null; name: string; username: string | null }) {
  return {
    id: row.id, channelId: row.roomId, author, content: row.content,
    createdAt: row.createdAt.toISOString(), editedAt: row.editedAt?.toISOString() ?? null, deletedAt: row.deletedAt?.toISOString() ?? null,
    files: row.deletedAt ? [] : (row.files ?? []).filter((f) => f.deletedAt == null).map(toPublicFile),
  };
}

/**
 * Acesso a comunidades: membership e cargos. Quem nao e membro NAO descobre
 * que a comunidade existe — as rotas respondem 404 (o plano manda nao revelar).
 *
 * Hierarquia de cargos (tabela do plano):
 *  - OWNER: tudo, inclusive expulsar ADMIN, mudar cargo, renomear e apagar;
 *  - ADMIN: convites, canais, expulsar MEMBER; NAO expulsa ADMIN nem toca na comunidade;
 *  - MEMBER: ver, falar, entrar na voz e criar convite.
 *  - OWNER nao pode sair: so apaga a comunidade (ou transfere — Fase 2).
 */

/** Ordem dos cargos para comparacao: OWNER > ADMIN > MEMBER. */
const ROLE_RANK: Record<CommunityRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

export function roleAtLeast(role: CommunityRole, minimum: CommunityRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

/** Pode gerir canais/convites/expulsar MEMBER. */
export function canModerate(role: CommunityRole): boolean {
  return roleAtLeast(role, 'ADMIN');
}

/** Membro com cargo, ou null quando nao e membro. */
export async function findMembership(
  communityId: string,
  userId: string,
): Promise<{ id: string; role: CommunityRole } | null> {
  const member = await prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { id: true, role: true },
  });
  return member;
}

/** Membro com role >= minimum, ou null. */
export async function requireRole(
  communityId: string,
  userId: string,
  minimum: CommunityRole,
): Promise<{ id: string; role: CommunityRole } | null> {
  const member = await findMembership(communityId, userId);
  if (!member || !roleAtLeast(member.role, minimum)) return null;
  return member;
}

/** Sala do socket onde os membros inscritos recebem os eventos da comunidade. */
export const communityRoom = (communityId: string): string => `community:${communityId}`;
