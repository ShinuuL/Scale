import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import {
  AVATAR_MIMES, MAX_AVATAR_SIZE_BYTES, MAX_CHANNEL_CATEGORIES,
  categoryInputSchema, communityImageKindSchema, communityLayoutSchema, type CommunityImageKind,
} from '@scale/shared';
import { audit } from '../lib/communityModeration.js';
import { prisma } from '../lib/prisma.js';
import { readFileHead, UPLOADS_ROOT } from '../lib/uploads.js';
import { byteLimit, StreamLimitError, tryAvatarSlot, tryResourceLock } from '../lib/resourceLimits.js';
import { isProfileUpdateRateLimited } from '../lib/rateLimit.js';
import { canModerate, communityRoom, findMembership, permissionsOf } from '../lib/communityAccess.js';
import { detectAvatarMime } from './profile.js';

/**
 * Fase 1 das comunidades: icone/banner (mesmo desenho do avatar de usuario) e
 * categorias + ordem dos canais. Rotas separadas de communities.ts para manter
 * aquele arquivo enxuto.
 *
 * Imagens: OWNER/ADMIN enviam e removem (aparencia e "gerenciar a comunidade";
 * nao ha permissao de cargo personalizado para isso). Qualquer membro le;
 * nao membro = 404 (nao revela a comunidade).
 */
export const COMMUNITY_MEDIA_ROOT = path.resolve(UPLOADS_ROOT, 'community-media');
const LEGACY_ICONS_ROOT = path.resolve(UPLOADS_ROOT, 'community-icons');

const EXT: Record<(typeof AVATAR_MIMES)[number], string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
/** Colunas da imagem `kind` com os valores dados (null = remover). */
function imageData(kind: CommunityImageKind, relPath: string | null, mime: string | null, updatedAt: Date | null) {
  return kind === 'icon'
    ? { iconPath: relPath, iconMime: mime, iconUpdatedAt: updatedAt }
    : { bannerPath: relPath, bannerMime: mime, bannerUpdatedAt: updatedAt };
}

const idSchema = z.string().uuid();
const params = z.object({ id: idSchema });
const imageParams = params.extend({ kind: communityImageKindSchema });

const ioOf = (app: FastifyInstance): Server | undefined => (app as unknown as { io?: Server }).io;
const changed = (app: FastifyInstance, id: string): void => { ioOf(app)?.to(communityRoom(id)).emit('community:changed', { communityId: id }); };
const missing = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'Not found' });
const invalid = (reply: FastifyReply): FastifyReply => reply.code(400).send({ error: 'Invalid input' });
const forbidden = (reply: FastifyReply): FastifyReply => reply.code(403).send({ error: 'Forbidden' });
const tooMany = (reply: FastifyReply, seconds: number): FastifyReply =>
  reply.code(429).header('Retry-After', String(Math.max(1, seconds))).send({ error: 'Too many updates. Try again later.' });
const meOf = (request: FastifyRequest): string => request.userId!;

/** Caminho absoluto da imagem, sempre dentro de COMMUNITY_MEDIA_ROOT (sandbox). */
function mediaAbsPath(relPath: string): string | null {
  const abs = path.resolve(process.cwd(), relPath);
  // Icones enviados pela rota antiga (uploads/community-icons) continuam validos.
  return abs.startsWith(COMMUNITY_MEDIA_ROOT + path.sep) || abs.startsWith(LEGACY_ICONS_ROOT + path.sep) ? abs : null;
}

async function removeMediaFile(relPath: string | null): Promise<void> {
  if (!relPath) return;
  const abs = mediaAbsPath(relPath);
  if (abs) await fsp.unlink(abs).catch(() => {});
}

type MediaRow = { iconPath: string | null; iconMime: string | null; bannerPath: string | null; bannerMime: string | null };
const mediaSelect = { iconPath: true, iconMime: true, bannerPath: true, bannerMime: true } as const;
const pathOf = (row: MediaRow, kind: CommunityImageKind): string | null => (kind === 'icon' ? row.iconPath : row.bannerPath);
const mimeOf = (row: MediaRow, kind: CommunityImageKind): string | null => (kind === 'icon' ? row.iconMime : row.bannerMime);

/** Apaga do disco as imagens de uma comunidade (chamar antes de apagar a linha). */
export async function removeCommunityMedia(communityId: string): Promise<void> {
  const row = await prisma.community.findUnique({ where: { id: communityId }, select: mediaSelect });
  if (!row) return;
  await removeMediaFile(row.iconPath);
  await removeMediaFile(row.bannerPath);
}

export async function communityExtrasRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };

  // PUT /api/communities/:id/{icon|banner} — multipart com um arquivo (ate 32 MB).
  app.put('/api/communities/:id/:kind', auth, async (request, reply) => {
    const p = imageParams.safeParse(request.params); if (!p.success) return invalid(reply);
    const { id, kind } = p.data; const me = meOf(request);
    const member = await findMembership(id, me); if (!member) return missing(reply); if (!canModerate(member.role)) return forbidden(reply);
    // Balde ANTES de ler o multipart (mesmo balde do perfil, chave propria).
    const limit = isProfileUpdateRateLimited(`community-media:${me}`);
    if (limit.limited) return tooMany(reply, limit.retryAfterSeconds);
    const releaseLock = tryResourceLock(`community-media:${id}`);
    if (!releaseLock) return tooMany(reply, 1);
    const releaseSlot = tryAvatarSlot();
    if (!releaseSlot) { releaseLock(); return tooMany(reply, 1); }
    let abs: string | undefined;
    let committed = false;
    try {
      const part = await request.file({ limits: { fileSize: MAX_AVATAR_SIZE_BYTES, files: 1 } });
      if (!part) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });
      await fsp.mkdir(COMMUNITY_MEDIA_ROOT, { recursive: true });
      abs = path.join(COMMUNITY_MEDIA_ROOT, `${crypto.randomUUID()}.upload`);
      await pipeline(part.file, byteLimit(MAX_AVATAR_SIZE_BYTES), fs.createWriteStream(abs, { mode: 0o600, flags: 'wx' }));
      if (part.file.truncated) return reply.code(413).send({ error: 'File too large. Max 32MB' });
      const mime = detectAvatarMime(await readFileHead(abs));
      if (!mime) return reply.code(400).send({ error: 'Formato não permitido. Use PNG, JPEG ou WebP' });
      const finalAbs = `${abs}.${EXT[mime]}`;
      await fsp.rename(abs, finalAbs);
      abs = finalAbs;
      const current = await prisma.community.findUnique({ where: { id }, select: mediaSelect });
      if (!current) return missing(reply);
      const updatedAt = new Date();
      await prisma.community.update({ where: { id }, data: imageData(kind, path.relative(process.cwd(), abs), mime, updatedAt) });
      committed = true;
      await removeMediaFile(pathOf(current, kind));
      changed(app, id);
      return reply.send({ [`${kind}UpdatedAt`]: updatedAt.toISOString() });
    } catch (err) {
      if (err instanceof StreamLimitError || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        return reply.code(413).send({ error: 'File too large. Max 32MB' });
      }
      throw err;
    } finally {
      if (abs && !committed) await fsp.unlink(abs).catch(() => {});
      releaseSlot();
      releaseLock();
    }
  });

  // DELETE /api/communities/:id/{icon|banner} — remove (idempotente).
  app.delete('/api/communities/:id/:kind', auth, async (request, reply) => {
    const p = imageParams.safeParse(request.params); if (!p.success) return invalid(reply);
    const { id, kind } = p.data;
    const member = await findMembership(id, meOf(request)); if (!member) return missing(reply); if (!canModerate(member.role)) return forbidden(reply);
    const release = tryResourceLock(`community-media:${id}`);
    if (!release) return tooMany(reply, 1);
    try {
      const current = await prisma.community.findUnique({ where: { id }, select: mediaSelect });
      if (!current) return missing(reply);
      await prisma.community.update({ where: { id }, data: imageData(kind, null, null, null) });
      await removeMediaFile(pathOf(current, kind));
      changed(app, id);
      return reply.send({ ok: true });
    } finally { release(); }
  });

  // GET /api/communities/:id/{icon|banner} — so membros. Cache pela versao (?v=<updatedAt>).
  app.get('/api/communities/:id/:kind', auth, async (request, reply) => {
    const p = imageParams.safeParse(request.params); if (!p.success) return invalid(reply);
    const { id, kind } = p.data;
    if (!await findMembership(id, meOf(request))) return missing(reply);
    const row = await prisma.community.findUnique({ where: { id }, select: mediaSelect });
    const rel = row ? pathOf(row, kind) : null;
    const mime = row ? mimeOf(row, kind) : null;
    const abs = rel ? mediaAbsPath(rel) : null;
    if (!abs || !mime) return reply.code(404).send({ error: 'No image' });
    reply.header('Content-Type', mime);
    reply.header('X-Content-Type-Options', 'nosniff');
    // Privado (exige sessao); a URL muda a cada troca, entao pode ficar em cache.
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(fs.createReadStream(abs));
  });

  // Categorias: quem tem manageChannels cria, renomeia e apaga.
  app.post('/api/communities/:id/categories', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = categoryInputSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const member = await findMembership(p.data.id, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageChannels) return forbidden(reply);
    const category = await prisma.$transaction(async (tx) => {
      const count = await tx.communityCategory.count({ where: { communityId: p.data.id } });
      if (count >= MAX_CHANNEL_CATEGORIES) return null;
      return tx.communityCategory.create({ data: { communityId: p.data.id, name: body.data.name, position: count } });
    });
    if (!category) return reply.code(409).send({ error: 'Category limit reached' });
    await audit(p.data.id, { action: 'category.create', actorId: meOf(request), targetId: category.id, targetName: category.name });
    changed(app, p.data.id);
    return reply.code(201).send({ category: { id: category.id, name: category.name, position: category.position } });
  });

  app.patch('/api/community-categories/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = categoryInputSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const category = await prisma.communityCategory.findUnique({ where: { id: p.data.id } }); if (!category) return missing(reply);
    const member = await findMembership(category.communityId, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageChannels) return forbidden(reply);
    await prisma.communityCategory.update({ where: { id: category.id }, data: { name: body.data.name } });
    await audit(category.communityId, { action: 'category.update', actorId: meOf(request), targetId: category.id, targetName: body.data.name, detail: category.name });
    changed(app, category.communityId);
    return reply.send({ ok: true });
  });

  // Apagar categoria NAO apaga canais: eles voltam para "sem categoria" (SetNull).
  app.delete('/api/community-categories/:id', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return invalid(reply);
    const category = await prisma.communityCategory.findUnique({ where: { id: p.data.id } }); if (!category) return missing(reply);
    const member = await findMembership(category.communityId, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageChannels) return forbidden(reply);
    await prisma.$transaction([
      prisma.room.updateMany({ where: { categoryId: category.id }, data: { categoryId: null } }),
      prisma.communityCategory.delete({ where: { id: category.id } }),
    ]);
    await audit(category.communityId, { action: 'category.delete', actorId: meOf(request), targetId: category.id, targetName: category.name });
    changed(app, category.communityId);
    return reply.send({ ok: true });
  });

  // PUT /api/communities/:id/layout — ordem completa (categorias + canais com categoria).
  app.put('/api/communities/:id/layout', auth, async (request, reply) => {
    const p = params.safeParse(request.params); const body = communityLayoutSchema.safeParse(request.body); if (!p.success || !body.success) return invalid(reply);
    const communityId = p.data.id;
    const member = await findMembership(communityId, meOf(request)); if (!member) return missing(reply); if (!permissionsOf(member).manageChannels) return forbidden(reply);
    const { categories, channels } = body.data;
    const ok = await prisma.$transaction(async (tx) => {
      const [currentCategories, currentChannels] = await Promise.all([
        tx.communityCategory.findMany({ where: { communityId }, select: { id: true } }),
        tx.room.findMany({ where: { communityId }, select: { id: true } }),
      ]);
      if (!sameSet(categories, currentCategories.map((c) => c.id))) return false;
      if (!sameSet(channels.map((c) => c.id), currentChannels.map((c) => c.id))) return false;
      const known = new Set(categories);
      if (channels.some((c) => c.categoryId !== null && !known.has(c.categoryId))) return false;
      for (const [position, id] of categories.entries()) await tx.communityCategory.update({ where: { id }, data: { position } });
      for (const [position, channel] of channels.entries()) await tx.room.update({ where: { id: channel.id }, data: { position, categoryId: channel.categoryId } });
      return true;
    });
    // Lista desatualizada (canal criado/apagado no meio) ou id alheio: o cliente recarrega.
    if (!ok) return reply.code(409).send({ error: 'Layout out of date' });
    await audit(communityId, { action: 'layout.update', actorId: meOf(request) });
    changed(app, communityId);
    return reply.send({ ok: true });
  });
}

/** Mesmos ids, sem repeticao. */
export function sameSet(list: string[], current: string[]): boolean {
  const set = new Set(list);
  if (set.size !== list.length || set.size !== current.length) return false;
  return current.every((id) => set.has(id));
}
