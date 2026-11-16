import { z } from 'zod';

/**
 * Gestao de administradores. Spec: docs/superpowers/specs/2026-11-11-admin-usuarios-design.md
 * Origem do admin: 'env' = ADMIN_EMAILS (raiz, nao removivel pela UI);
 * 'db' = concedido por outro admin (tabela AdminGrant); null = usuario comum.
 */
export const adminSourceSchema = z.enum(['env', 'db']);
export type AdminSource = z.infer<typeof adminSourceSchema>;

export const adminUserRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string().nullable(),
  /** Mascarado: `ga***@gmail.com`. O e-mail completo nunca sai nesta lista. */
  emailMasked: z.string(),
  createdAt: z.string(),
  admin: adminSourceSchema.nullable(),
  grantedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  grantedAt: z.string().nullable(),
  isSelf: z.boolean(),
});
export type AdminUserRow = z.infer<typeof adminUserRowSchema>;

/** `GET /api/admin/users?q=&filter=&cursor=&limit=` */
export const adminUsersQuerySchema = z.object({
  /** Busca por nome, @nome ou e-mail (contem, sem diferenciar caixa). */
  q: z.string().trim().max(120).optional(),
  filter: z.enum(['all', 'admins']).default('all'),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export const adminUsersPageSchema = z.object({
  users: z.array(adminUserRowSchema),
  nextCursor: z.string().nullable(),
});
export type AdminUsersPage = z.infer<typeof adminUsersPageSchema>;

export const adminRoleAuditEntrySchema = z.object({
  id: z.string(),
  actor: z.object({ id: z.string(), name: z.string() }),
  target: z.object({ id: z.string(), name: z.string() }),
  action: z.enum(['grant', 'revoke']),
  createdAt: z.string(),
});
export type AdminRoleAuditEntry = z.infer<typeof adminRoleAuditEntrySchema>;
