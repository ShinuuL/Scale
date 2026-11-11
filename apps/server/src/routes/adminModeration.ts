import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import {
  adminModerationTestSchema,
  adminModerationUpdateSchema,
  type AdminModerationState,
  type AdminModerationUpdate,
  type ModerationAuditEntry,
  type ModerationOverrides,
  type ModerationVerdict,
} from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { isSystemAdmin } from '../lib/env.js';
import { isAdminSettingsRateLimited } from '../lib/rateLimit.js';
import { encryptSecret } from '../lib/settingsCrypto.js';
import {
  getEffectiveModerationSettings,
  getModerationConfig,
  getResolvedModerationSettings,
  invalidateModerationSettings,
} from '../lib/moderation/settings.js';
import { getModerationProvider, NONE_VERDICT } from '../lib/moderation/index.js';

/**
 * Painel de administracao da moderacao (spec
 * docs/superpowers/specs/2026-11-11-admin-moderacao-design.md).
 *
 * So admin do sistema (ADMIN_EMAILS, mesmo criterio de /api/metrics). Tudo o
 * que e gravado aqui vira a configuracao EFETIVA lida por
 * `GET /api/moderation/config` (publico) — nao existe modo oculto.
 *
 * A chave de API entra pelo PUT, e gravada cifrada (lib/settingsCrypto.ts) e
 * NUNCA volta: DTO, auditoria, log e erro so dizem `set` / `cleared`.
 */

const OVERRIDE_FIELDS = [
  'provider',
  'model',
  'screenEnabled',
  'frameIntervalSec',
  'retentionDays',
  'minAge',
  'privacyContactEmail',
] as const satisfies ReadonlyArray<keyof ModerationOverrides>;

type Changes = Record<string, { from: unknown; to: unknown }>;

const auditQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) });

function ioOf(fastify: FastifyInstance): Server | undefined {
  return (fastify as unknown as { io?: Server }).io;
}

/** So nome/status do erro do provedor: nunca o corpo da requisicao nem a chave. */
export function providerErrorDetail(err: unknown): string {
  const e = err as { name?: string; status?: number } | null;
  const name = typeof e?.name === 'string' && e.name ? e.name : 'Error';
  return typeof e?.status === 'number' ? `${name} (${e.status})` : name;
}

function toAuditEntry(row: { id: string; adminId: string; adminName: string; changes: string; createdAt: Date }): ModerationAuditEntry {
  let changes: Changes = {};
  try {
    changes = JSON.parse(row.changes) as Changes;
  } catch {
    changes = {};
  }
  return { id: row.id, admin: { id: row.adminId, name: row.adminName }, changes, createdAt: row.createdAt.toISOString() };
}

export async function adminModerationRoutes(fastify: FastifyInstance): Promise<void> {
  /** Logado + admin do sistema (e-mail da sessao) + balde `adminSettings`. */
  async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await fastify.authenticate(request, reply);
    if (reply.sent) return;
    if (!isSystemAdmin(request.userEmail)) {
      await reply.code(403).send({ error: 'Forbidden' });
      return;
    }
    const limit = isAdminSettingsRateLimited(request.userId as string);
    if (limit.limited) {
      await reply.code(429).header('Retry-After', String(limit.retryAfterSeconds)).send({ error: 'Too many requests. Try again later.' });
    }
  }
  const admin = { preHandler: [requireAdmin] };

  /** Invalida cache + provedor, avisa todo mundo (socket) e devolve o estado novo. */
  async function applyAndBroadcast(): Promise<AdminModerationState> {
    invalidateModerationSettings();
    const state = await getEffectiveModerationSettings(fastify.log);
    ioOf(fastify)?.emit('moderation:config', await getModerationConfig(fastify.log));
    return state;
  }

  async function writeAudit(request: FastifyRequest, changes: Changes): Promise<void> {
    if (Object.keys(changes).length === 0) return;
    const adminId = request.userId as string;
    const row = await prisma.user.findUnique({ where: { id: adminId }, select: { name: true } });
    await prisma.moderationAuditLog.create({
      data: { adminId, adminName: row?.name ?? request.userName ?? 'admin', changes: JSON.stringify(changes) },
    });
  }

  // GET /api/admin/moderation — estado completo (efetivo, overrides, .env), sem chave.
  fastify.get('/api/admin/moderation', admin, async (_request, reply) => {
    return reply.send(await getEffectiveModerationSettings(fastify.log));
  });

  // PUT /api/admin/moderation — parcial; campo ausente = nao mexe; null = volta ao .env.
  fastify.put('/api/admin/moderation', admin, async (request, reply) => {
    const parsed = adminModerationUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return reply.code(400).send({ error: issue?.message ?? 'Validation failed', field: String(issue?.path[0] ?? '') });
    }
    const body: AdminModerationUpdate = parsed.data;
    const current = await getResolvedModerationSettings(fastify.log);

    // Candidato: o que ficaria efetivo depois desta gravacao.
    const next = { ...current.overrides };
    for (const field of OVERRIDE_FIELDS) {
      if (body[field] !== undefined) (next as Record<string, unknown>)[field] = body[field];
    }
    const effProvider = next.provider ?? current.envDefaults.provider ?? 'heuristic';
    const effScreen = next.screenEnabled ?? current.envDefaults.screenEnabled ?? false;
    const willHaveKey = body.apiKey !== undefined || current.effective.hasApiKey;

    if (effScreen && effProvider !== 'claude') {
      return reply.code(400).send({
        error: 'A analise de tela exige o provedor claude',
        field: body.provider !== undefined && body.screenEnabled === undefined ? 'provider' : 'screenEnabled',
      });
    }
    if (effProvider === 'claude' && !willHaveKey) {
      return reply.code(400).send({
        error: 'O provedor claude exige uma chave de API (banco ou .env)',
        field: body.provider !== undefined ? 'provider' : 'apiKey',
      });
    }

    const changes: Changes = {};
    for (const field of OVERRIDE_FIELDS) {
      if (body[field] === undefined) continue;
      if (current.overrides[field] !== next[field]) changes[field] = { from: current.overrides[field], to: next[field] };
    }
    const data: Record<string, unknown> = {};
    for (const field of OVERRIDE_FIELDS) if (body[field] !== undefined) data[field] = body[field];
    if (body.apiKey !== undefined) {
      data.apiKeyCiphertext = encryptSecret(body.apiKey);
      changes.apiKey = { from: current.effective.apiKeySource === 'db' ? 'set' : null, to: 'set' };
    }
    if (Object.keys(data).length === 0) return reply.send(await getEffectiveModerationSettings(fastify.log));
    data.updatedById = request.userId;

    await prisma.moderationSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
    await writeAudit(request, changes);
    fastify.log.info({ adminId: request.userId, fields: Object.keys(changes) }, 'moderation settings updated');
    return reply.send(await applyAndBroadcast());
  });

  // DELETE /api/admin/moderation/api-key — remove a chave do banco (volta a do .env, se houver).
  fastify.delete('/api/admin/moderation/api-key', admin, async (request, reply) => {
    const current = await getResolvedModerationSettings(fastify.log);
    if (current.effective.provider === 'claude' && !current.envDefaults.hasApiKey) {
      return reply.code(400).send({ error: 'O provedor claude exige uma chave de API: troque o provedor antes de remover a chave', field: 'apiKey' });
    }
    const row = await prisma.moderationSettings.findUnique({ where: { id: 'default' }, select: { apiKeyCiphertext: true } });
    if (!row?.apiKeyCiphertext) return reply.send(await getEffectiveModerationSettings(fastify.log));

    await prisma.moderationSettings.update({ where: { id: 'default' }, data: { apiKeyCiphertext: null, updatedById: request.userId } });
    await writeAudit(request, { apiKey: { from: 'set', to: 'cleared' } });
    fastify.log.info({ adminId: request.userId }, 'moderation api key cleared');
    return reply.send(await applyAndBroadcast());
  });

  // POST /api/admin/moderation/test — veredito do provedor efetivo, sem gravar ModerationEvent.
  fastify.post('/api/admin/moderation/test', admin, async (request, reply) => {
    const parsed = adminModerationTestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Texto invalido', field: 'text' });
    const provider = await getModerationProvider(fastify.log);
    if (provider.name === 'off') {
      const verdict: ModerationVerdict = NONE_VERDICT;
      return reply.send(verdict);
    }
    try {
      const verdict = await provider.classifyText(parsed.data.text, { lang: 'pt' });
      return reply.send(verdict);
    } catch (err) {
      const detail = providerErrorDetail(err);
      fastify.log.warn({ provider: provider.name, detail }, 'moderation test: provider failed');
      return reply.code(502).send({ error: 'provider_error', detail });
    }
  });

  // GET /api/admin/moderation/audit?limit=50
  fastify.get<{ Querystring: { limit?: string } }>('/api/admin/moderation/audit', admin, async (request, reply) => {
    const query = auditQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'limit invalido', field: 'limit' });
    const rows = await prisma.moderationAuditLog.findMany({ orderBy: { createdAt: 'desc' }, take: query.data.limit });
    return reply.send({ entries: rows.map(toAuditEntry) });
  });
}
