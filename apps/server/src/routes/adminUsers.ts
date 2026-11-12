import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  adminUsersQuerySchema,
  type AdminRoleAuditEntry,
  type AdminUserRow,
  type AdminUsersPage,
} from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { getAdminEmails } from '../lib/env.js';
import { adminSourceOf, isAdminUser, isRootAdminEmail, maskEmail } from '../lib/adminRole.js';
import { isAdminSettingsRateLimited } from '../lib/rateLimit.js';
import { userRoom } from '../socket/handler.js';

/**
 * Gestao de administradores (spec
 * docs/superpowers/specs/2026-11-11-admin-usuarios-design.md).
 *
 * So admin (raiz ou concedido); senao 403. Balde `adminSettings`.
 * Minimizacao (LGPD): o e-mail sai SEMPRE mascarado; nada de moderacao aqui.
 */

const userIdParamSchema = z.object({ userId: z.string().min(1).max(64) });
const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

const rowSelect = {
  id: true,
  name: true,
  email: true,
  createdAt: true,
  username: { select: { name: true } },
  adminGrant: { select: { grantedById: true, createdAt: true } },
} as const;

type RowData = Prisma.UserGetPayload<{ select: typeof rowSelect }>;

function ioOf(fastify: FastifyInstance): Server | undefined {
  return (fastify as unknown as { io?: Server }).io;
}

/** Cursor opaco: base64url de `<createdAt ms>_<id>` (ordem createdAt desc, id desc). */
function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.getTime()}_${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8');
  const m = /^(\d{1,15})_([A-Za-z0-9_-]{1,40})$/.exec(raw);
  if (!m) return null;
  return { createdAt: new Date(Number(m[1])), id: m[2] as string };
}

/**
 * Variantes de caixa do termo para o NOME. O `contains` do Prisma no SQLite e
 * `LIKE`, que ja ignora caixa para ASCII mas NAO para letras acentuadas
 * ("JOÃO" x "joão"); o SQLite tambem nao tem `mode: 'insensitive'`. Somar as
 * variantes original, minuscula, maiuscula e capitalizada cobre os casos reais
 * (termo digitado numa caixa so) sem SQL cru. Limite conhecido: acento em
 * caixa mista no meio da palavra ("jOÃo") so casa se igual ao gravado.
 * E-mail e @nome ja sao gravados em minusculas: basta o termo em minusculas.
 */
function caseVariants(q: string): string[] {
  const lower = q.toLocaleLowerCase('pt-BR');
  const upper = q.toLocaleUpperCase('pt-BR');
  const capital = lower.replace(/(^|\s)(\S)/gu, (_m, sp: string, ch: string) => sp + ch.toLocaleUpperCase('pt-BR'));
  return [...new Set([q, lower, upper, capital])];
}

export async function adminUsersRoutes(fastify: FastifyInstance): Promise<void> {
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    if (!(await isAdminUser({ userId: request.userId, email: request.userEmail }))) {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }
    const limit = isAdminSettingsRateLimited(request.userId as string);
    if (limit.limited) {
      await reply.code(429).header('Retry-After', String(limit.retryAfterSeconds)).send({ error: 'Too many requests. Try again later.' });
    }
  }
  const admin = { preHandler: [requireAdmin] };

  async function toRows(users: RowData[], selfId: string): Promise<AdminUserRow[]> {
    const granterIds = [...new Set(users.flatMap((u) => (u.adminGrant ? [u.adminGrant.grantedById] : [])))];
    const granters = granterIds.length
      ? await prisma.user.findMany({ where: { id: { in: granterIds } }, select: { id: true, name: true } })
      : [];
    const granterName = new Map(granters.map((g) => [g.id, g.name]));
    return users.map((u) => {
      const source = adminSourceOf(u.email, u.adminGrant !== null);
      // Raiz com grant antigo: a origem e o .env; "concedido por" nao se aplica.
      const grant = source === 'db' ? u.adminGrant : null;
      return {
        id: u.id,
        name: u.name,
        username: u.username?.name ?? null,
        emailMasked: maskEmail(u.email),
        createdAt: u.createdAt.toISOString(),
        admin: source,
        // Conta que concedeu foi apagada: nome vazio (a auditoria guarda o historico).
        grantedBy: grant ? { id: grant.grantedById, name: granterName.get(grant.grantedById) ?? '' } : null,
        grantedAt: grant ? grant.createdAt.toISOString() : null,
        isSelf: u.id === selfId,
      };
    });
  }

  async function loadRow(userId: string, selfId: string): Promise<AdminUserRow | null> {
    const u = await prisma.user.findUnique({ where: { id: userId }, select: rowSelect });
    if (!u) return null;
    const [row] = await toRows([u], selfId);
    return row ?? null;
  }

  /** Abas do alvo atualizam o menu sem recarregar. `isSelf` nao vai no evento. */
  function notifyTarget(row: AdminUserRow): void {
    ioOf(fastify)?.to(userRoom(row.id)).emit('me:admin', { isAdmin: row.admin !== null, adminSource: row.admin });
  }

  async function actorName(actorId: string): Promise<string> {
    const a = await prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    return a?.name ?? '';
  }

  // GET /api/admin/users?q=&filter=all|admins&cursor=&limit=
  fastify.get('/api/admin/users', admin, async (request, reply) => {
    const parsed = adminUsersQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid query' });
    const { q, filter, cursor, limit } = parsed.data;

    const and: Prisma.UserWhereInput[] = [];
    if (q) {
      const lower = q.toLocaleLowerCase('pt-BR');
      // "@nome" tambem busca o @nome sem a arroba.
      const handle = lower.startsWith('@') ? lower.slice(1) : lower;
      and.push({
        OR: [
          ...caseVariants(q).map((v) => ({ name: { contains: v } })),
          ...(handle ? [{ username: { name: { contains: handle } } }] : []),
          { email: { contains: lower } },
        ],
      });
    }
    if (filter === 'admins') {
      and.push({ OR: [{ email: { in: [...getAdminEmails()] } }, { adminGrant: { isNot: null } }] });
    }
    if (cursor) {
      const c = decodeCursor(cursor);
      if (!c) return reply.code(400).send({ error: 'Invalid cursor' });
      and.push({ OR: [{ createdAt: { lt: c.createdAt } }, { createdAt: c.createdAt, id: { lt: c.id } }] });
    }

    const users = await prisma.user.findMany({
      where: and.length ? { AND: and } : {},
      select: rowSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = users.length > limit;
    const pageRows = hasMore ? users.slice(0, limit) : users;
    const last = pageRows[pageRows.length - 1];
    const page: AdminUsersPage = {
      users: await toRows(pageRows, request.userId as string),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
    return page;
  });

  // GET /api/admin/users/audit?limit=50
  fastify.get('/api/admin/users/audit', admin, async (request, reply) => {
    const parsed = auditQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid query' });
    const rows = await prisma.adminRoleAudit.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: parsed.data.limit,
    });
    const entries: AdminRoleAuditEntry[] = rows.map((r) => ({
      id: r.id,
      actor: { id: r.actorId, name: r.actorName },
      target: { id: r.targetId, name: r.targetName },
      action: r.action === 'revoke' ? 'revoke' : 'grant',
      createdAt: r.createdAt.toISOString(),
    }));
    return { entries };
  });

  // PUT /api/admin/users/:userId/admin — concede (idempotente).
  fastify.put('/api/admin/users/:userId/admin', admin, async (request, reply) => {
    const params = userIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'User not found' });
    const actorId = request.userId as string;
    const target = await prisma.user.findUnique({ where: { id: params.data.userId }, select: rowSelect });
    if (!target) return reply.code(404).send({ error: 'User not found' });

    // Ja admin (raiz ou concedido): 200 sem nova auditoria.
    if (!isRootAdminEmail(target.email) && !target.adminGrant) {
      try {
        await prisma.adminGrant.create({ data: { userId: target.id, grantedById: actorId } });
        await prisma.adminRoleAudit.create({
          data: { actorId, actorName: await actorName(actorId), targetId: target.id, targetName: target.name, action: 'grant' },
        });
        request.log.info({ actorId, targetId: target.id }, 'admin role granted');
      } catch (err) {
        // Concessao simultanea: a outra criou o grant (PK userId) e auditou.
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    const row = await loadRow(target.id, actorId);
    if (!row) return reply.code(404).send({ error: 'User not found' });
    notifyTarget(row);
    return row;
  });

  // DELETE /api/admin/users/:userId/admin — remove o papel concedido.
  fastify.delete('/api/admin/users/:userId/admin', admin, async (request, reply) => {
    const params = userIdParamSchema.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'User not found' });
    const actorId = request.userId as string;
    const target = await prisma.user.findUnique({ where: { id: params.data.userId }, select: rowSelect });
    if (!target) return reply.code(404).send({ error: 'User not found' });
    if (isRootAdminEmail(target.email)) return reply.code(409).send({ error: 'env_admin' });
    if (target.id === actorId) return reply.code(400).send({ error: 'cannot_revoke_self' });

    // deleteMany primeiro: so quem de fato apagou grava a auditoria (sem
    // duplicata em remocoes simultaneas). Sem grant: 200 idempotente.
    const deleted = await prisma.adminGrant.deleteMany({ where: { userId: target.id } });
    if (deleted.count > 0) {
      await prisma.adminRoleAudit.create({
        data: { actorId, actorName: await actorName(actorId), targetId: target.id, targetName: target.name, action: 'revoke' },
      });
      request.log.info({ actorId, targetId: target.id }, 'admin role revoked');
    }
    const row = await loadRow(target.id, actorId);
    if (!row) return reply.code(404).send({ error: 'User not found' });
    notifyTarget(row);
    return row;
  });
}
