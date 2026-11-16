import { z } from 'zod';

/* ─── Fase 4: apelido por comunidade ─────────────────────────────── */

export const COMMUNITY_NICKNAME_MAX = 32;

/**
 * Corpo de `PUT /api/communities/:id/members/:userId/nickname`.
 * Texto com trim (1..32); `null` ou vazio limpa o apelido.
 */
export const communityNicknameSchema = z.object({
  nickname: z
    .string().trim().max(COMMUNITY_NICKNAME_MAX).nullable()
    .transform((v) => (v ? v : null)),
});
export type CommunityNicknameInput = z.infer<typeof communityNicknameSchema>;

/** Nome exibido na comunidade: apelido quando houver, senao o nome real. */
export function displayNameOf(member: { name: string; nickname?: string | null }): string {
  return member.nickname || member.name;
}
