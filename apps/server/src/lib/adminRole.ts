import type { AdminSource } from '@scale/shared';
import { prisma } from './prisma.js';
import { getAdminEmails } from './env.js';

/**
 * Papel de admin (spec docs/superpowers/specs/2026-11-11-admin-usuarios-design.md).
 *
 * - Raiz (`env`): e-mail em ADMIN_EMAILS / METRICS_ADMIN_EMAILS. Nao removivel
 *   pela UI; garante que sempre ha como recuperar o acesso.
 * - Concedido (`db`): linha em AdminGrant. Consultado a CADA checagem (sem
 *   cache): remover o grant tira o acesso na proxima requisicao.
 *
 * Fonte unica para toda checagem de admin no backend.
 */

export function isRootAdminEmail(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return getAdminEmails().has(normalized);
}

/** Origem do papel quando ja se sabe se ha grant (sem consulta). Raiz vence. */
export function adminSourceOf(email: string | null | undefined, hasGrant: boolean): AdminSource | null {
  if (isRootAdminEmail(email)) return 'env';
  return hasGrant ? 'db' : null;
}

export interface AdminIdentity {
  userId: string | null | undefined;
  email: string | null | undefined;
}

/** Origem do papel do usuario: 'env', 'db' ou null (consulta AdminGrant se preciso). */
export async function getAdminSource({ userId, email }: AdminIdentity): Promise<AdminSource | null> {
  if (isRootAdminEmail(email)) return 'env';
  if (!userId) return null;
  const grant = await prisma.adminGrant.findUnique({ where: { userId }, select: { userId: true } });
  return grant ? 'db' : null;
}

/** true para admin raiz (e-mail) ou concedido (AdminGrant). Anonimo: false. */
export async function isAdminUser(identity: AdminIdentity): Promise<boolean> {
  if (!identity.userId) return false;
  return (await getAdminSource(identity)) !== null;
}

/**
 * E-mail mascarado para listagens: 2 primeiros caracteres do local + `***` +
 * `@dominio` (`ga***@gmail.com`). Local com 2 ou menos caracteres vira `*` +
 * `***` (`****@x.com`), para nao revelar o local inteiro. Sem `@`: so `***`.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const visible = local.length <= 2 ? '*' : local.slice(0, 2);
  return `${visible}***@${domain}`;
}
