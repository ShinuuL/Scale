import { z } from 'zod';
import type { CommunityRole } from './communities.js';

/* ─── Fase 3: castigo, banimento, expulsao e auditoria ─────────────── */

/** Duracoes predefinidas do castigo (60 s a 7 dias). */
export const TIMEOUT_DURATIONS = {
  '60s': 60_000,
  '5m': 5 * 60_000,
  '10m': 10 * 60_000,
  '1h': 3_600_000,
  '1d': 86_400_000,
  '7d': 7 * 86_400_000,
} as const;
export type TimeoutDuration = keyof typeof TIMEOUT_DURATIONS;
export const TIMEOUT_DURATION_LABELS: Record<TimeoutDuration, string> = {
  '60s': '60 segundos', '5m': '5 minutos', '10m': '10 minutos', '1h': '1 hora', '1d': '1 dia', '7d': '7 dias',
};
export const timeoutDurationSchema = z.enum(['60s', '5m', '10m', '1h', '1d', '7d']);
export const MODERATION_REASON_MAX = 300;
/** Motivo opcional; vazio vira ausente. */
export const moderationReasonSchema = z
  .string().trim().max(MODERATION_REASON_MAX).optional()
  .transform((v) => (v ? v : undefined));
export const memberTimeoutSchema = z.object({ duration: timeoutDurationSchema, reason: moderationReasonSchema });
export const moderationReasonBodySchema = z.object({ reason: moderationReasonSchema }).default({});

export const COMMUNITY_AUDIT_ACTIONS = [
  'member.timeout', 'member.untimeout', 'member.ban', 'member.unban', 'member.kick',
  'member.role', 'member.custom_role', 'role.create', 'role.update', 'role.delete',
  'channel.create', 'channel.update', 'channel.delete',
  'category.create', 'category.update', 'category.delete', 'layout.update',
  'message.pin', 'message.unpin', 'event.create', 'event.update', 'event.cancel',
] as const;
export const communityAuditActionSchema = z.enum(COMMUNITY_AUDIT_ACTIONS);
export type CommunityAuditAction = z.infer<typeof communityAuditActionSchema>;
export const COMMUNITY_AUDIT_LABELS: Record<CommunityAuditAction, string> = {
  'member.timeout': 'Castigou', 'member.untimeout': 'Tirou o castigo de', 'member.ban': 'Baniu',
  'member.unban': 'Desbaniu', 'member.kick': 'Expulsou', 'member.role': 'Mudou o cargo de',
  'member.custom_role': 'Mudou o cargo personalizado de', 'role.create': 'Criou o cargo',
  'role.update': 'Editou o cargo', 'role.delete': 'Apagou o cargo', 'channel.create': 'Criou o canal',
  'channel.update': 'Editou o canal', 'channel.delete': 'Apagou o canal', 'category.create': 'Criou a categoria',
  'category.update': 'Renomeou a categoria', 'category.delete': 'Apagou a categoria',
  'layout.update': 'Reorganizou os canais', 'message.pin': 'Fixou mensagem em', 'message.unpin': 'Desafixou mensagem em',
  'event.create': 'Criou o evento', 'event.update': 'Editou o evento', 'event.cancel': 'Cancelou o evento',
};
export const communityAuditEntrySchema = z.object({
  id: z.string(),
  action: communityAuditActionSchema,
  actorId: z.string(),
  actorName: z.string(),
  targetId: z.string().nullable(),
  targetName: z.string().nullable(),
  reason: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
});
export type CommunityAuditEntry = z.infer<typeof communityAuditEntrySchema>;
export const communityAuditQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export const communityBanSchema = z.object({
  userId: z.string(), name: z.string(), reason: z.string().nullable(), bannedById: z.string(), createdAt: z.string(),
});
export type CommunityBan = z.infer<typeof communityBanSchema>;

/** `community:moderation` em `user:<alvo>`: aviso ao alvo da acao. */
export const communityModerationEventSchema = z.object({
  communityId: z.string().uuid(),
  communityName: z.string(),
  action: z.enum(['timeout', 'untimeout', 'ban', 'kick']),
  until: z.string().nullable(),
  reason: z.string().nullable(),
});
export type CommunityModerationEvent = z.infer<typeof communityModerationEventSchema>;

/** Texto do aviso mostrado ao alvo. */
export function moderationNotice(event: CommunityModerationEvent): string {
  const reason = event.reason ? ` Motivo: ${event.reason}` : '';
  switch (event.action) {
    case 'timeout': {
      const until = event.until ? new Date(event.until).toLocaleString('pt-BR') : '';
      return `Você está de castigo em ${event.communityName} até ${until}.${reason}`;
    }
    case 'untimeout': return `Seu castigo em ${event.communityName} terminou.`;
    case 'ban': return `Você foi banido de ${event.communityName}.${reason}`;
    case 'kick': return `Você foi expulso de ${event.communityName}.${reason}`;
  }
}

/**
 * Nivel na hierarquia de moderacao: OWNER 4 > ADMIN 3 > MEMBER com cargo
 * personalizado 2 > MEMBER 1. Quem age (com `kickMembers`) precisa de nivel
 * ESTRITAMENTE maior que o alvo; o dono nunca e alvo.
 */
export function moderationRank(member: { role: CommunityRole; customRoleId?: string | null }): number {
  if (member.role === 'OWNER') return 4;
  if (member.role === 'ADMIN') return 3;
  return member.customRoleId ? 2 : 1;
}
export function outranks(
  actor: { role: CommunityRole; customRoleId?: string | null },
  target: { role: CommunityRole; customRoleId?: string | null },
): boolean {
  return target.role !== 'OWNER' && moderationRank(actor) > moderationRank(target);
}
