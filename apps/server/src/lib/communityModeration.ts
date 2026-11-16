import type { Server } from 'socket.io';
import { moderationRank, outranks, type CommunityAuditAction, type CommunityModerationEvent } from '@scale/shared';
import { prisma } from './prisma.js';
import { permissionsOf, type Membership } from './communityAccess.js';

/**
 * Moderacao de comunidade (Fase 3): hierarquia, castigo e auditoria.
 *
 * Hierarquia efetiva: OWNER 4 > ADMIN 3 > MEMBER com cargo personalizado 2 >
 * MEMBER 1. Quem age precisa de `kickMembers` e de nivel ESTRITAMENTE maior que
 * o alvo: ninguem age sobre o dono nem sobre papel igual ou superior.
 */
export const memberRank = (member: Pick<Membership, 'role' | 'customRoleId'>): number => moderationRank(member);

export function canModerateMember(
  actor: Pick<Membership, 'role' | 'customRoleId' | 'customRole'>,
  target: Pick<Membership, 'role' | 'customRoleId'>,
): boolean {
  return permissionsOf(actor).kickMembers && outranks(actor, target);
}

/** Castigo vigente (data de fim) ou null. */
export function activeTimeout(member: Pick<Membership, 'timeoutUntil'> | null | undefined, now = Date.now()): Date | null {
  const until = member?.timeoutUntil ?? null;
  return until && until.getTime() > now ? until : null;
}

/** Castigo vigente direto do banco (caminhos sem membership em maos: socket, upload). */
export async function timeoutOf(communityId: string, userId: string): Promise<Date | null> {
  const row = await prisma.communityMember.findUnique({ where: { communityId_userId: { communityId, userId } }, select: { timeoutUntil: true } });
  return activeTimeout(row);
}

/** Corpo padrao da recusa por castigo (403). */
export const timedOutBody = (until: Date) => ({ error: 'Timed out', until: until.toISOString() });

export interface AuditInput {
  action: CommunityAuditAction;
  actorId: string;
  targetId?: string | null;
  targetName?: string | null;
  reason?: string | null;
  detail?: string | null;
}

/** Grava uma linha de auditoria. Falha de log nunca derruba a acao. */
export async function audit(communityId: string, input: AuditInput): Promise<void> {
  try {
    const actor = await prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true } });
    await prisma.communityAuditLog.create({
      data: {
        communityId, actorId: input.actorId, actorName: actor?.name ?? 'Desconhecido', action: input.action,
        targetId: input.targetId ?? null, targetName: input.targetName?.slice(0, 100) ?? null,
        reason: input.reason ?? null, detail: input.detail?.slice(0, 200) ?? null,
      },
    });
  } catch {
    /* auditoria e best effort */
  }
}

/** Aviso em tempo real ao alvo (`community:moderation` em `user:<id>`). */
export function notifyTarget(io: Server | undefined, userId: string, event: CommunityModerationEvent): void {
  io?.to(`user:${userId}`).emit('community:moderation', event);
}
