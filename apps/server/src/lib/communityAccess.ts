import type { ChannelReactionSummary, ChannelReply, ChannelThreadSummary, CommunityPermissions, CommunityRole } from '@scale/shared';
import { prisma } from './prisma.js';
import { toPublicFile } from './publicDto.js';

interface ChannelMessageRow {
  id: string; roomId: string; content: string; createdAt: Date; editedAt: Date | null; deletedAt: Date | null;
  pinnedAt?: Date | null; pinnedById?: string | null; isSystem?: boolean; threadId?: string | null;
  files?: Array<{ id: string; filename: string; mime: string; size: number; deletedAt: Date | null }>;
}

/** DTO unico de mensagem de canal (rota de texto, upload e socket). Apagada = sem arquivos. */
export function toChannelMessage(
  row: ChannelMessageRow,
  author: { id: string | null; name: string; username: string | null },
  extras: { replyTo?: ChannelReply | null; reactions?: ChannelReactionSummary[]; thread?: ChannelThreadSummary | null } = {},
) {
  return {
    id: row.id, channelId: row.roomId, author, content: row.content,
    createdAt: row.createdAt.toISOString(), editedAt: row.editedAt?.toISOString() ?? null, deletedAt: row.deletedAt?.toISOString() ?? null,
    files: row.deletedAt ? [] : (row.files ?? []).filter((f) => f.deletedAt == null).map(toPublicFile),
    replyTo: extras.replyTo ?? null,
    reactions: row.deletedAt ? [] : extras.reactions ?? [],
    pinnedAt: row.pinnedAt?.toISOString() ?? null,
    pinnedById: row.pinnedById ?? null,
    /** Mensagem de sistema (boas-vindas): sem autor editavel. */
    system: row.isSystem ?? false,
    /** Fase 4: mensagem dentro de um topico (null = canal principal). */
    threadId: row.threadId ?? null,
    /** Fase 4: topico aberto a partir desta mensagem. */
    thread: extras.thread ?? null,
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

export interface Membership { id: string; role: CommunityRole; customRoleId: string | null; customRole: CommunityPermissions | null; timeoutUntil?: Date | null }

/**
 * Permissoes efetivas: OWNER/ADMIN tem todas; o cargo personalizado so SOMA.
 * Expulsar ADMIN continua exclusivo do OWNER (regra na rota).
 */
export function permissionsOf(member: Pick<Membership, 'role' | 'customRole'>): CommunityPermissions {
  const all = canModerate(member.role);
  const custom = member.customRole;
  return {
    manageChannels: all || Boolean(custom?.manageChannels),
    manageInvites: all || Boolean(custom?.manageInvites),
    manageMessages: all || Boolean(custom?.manageMessages),
    kickMembers: all || Boolean(custom?.kickMembers),
  };
}

/** Membro com cargo, ou null quando nao e membro. */
export async function findMembership(communityId: string, userId: string): Promise<Membership | null> {
  return prisma.communityMember.findUnique({
    where: { communityId_userId: { communityId, userId } },
    select: { id: true, role: true, customRoleId: true, timeoutUntil: true, customRole: { select: { manageChannels: true, manageInvites: true, manageMessages: true, kickMembers: true } } },
  });
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
