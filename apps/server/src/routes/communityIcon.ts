import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Server } from 'socket.io';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { MAX_COMMUNITY_ICON_BYTES } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { readFileHead, UPLOADS_ROOT } from '../lib/uploads.js';
import { byteLimit, StreamLimitError, tryAvatarSlot, tryResourceLock } from '../lib/resourceLimits.js';
import { isProfileUpdateRateLimited } from '../lib/rateLimit.js';
import { communityRoom, findMembership } from '../lib/communityAccess.js';
import { detectAvatarMime } from './profile.js';

/**
 * Icone da comunidade: uploads/community-icons/<uuid>.<ext>, fora das pastas de
 * sala. Mesmas regras da foto de perfil (PNG/JPEG/WebP por magic bytes, stream
 * direto ao disco). So o OWNER troca ou remove; so membro ve (fora = 404).
 */
export const COMMUNITY_ICONS_ROOT = path.resolve(UPLOADS_ROOT, 'community-icons');
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;
const params = z.object({ id: z.string().uuid() });
const missing = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: 'Not found' });
const tooMany = (reply: FastifyReply, seconds: number): FastifyReply =>
  reply.code(429).header('Retry-After', String(Math.max(1, seconds))).send({ error: 'Too many updates. Try again later.' });

function iconAbsPath(relPath: string): string | null {
  const abs = path.resolve(process.cwd(), relPath);
  return abs.startsWith(COMMUNITY_ICONS_ROOT + path.sep) ? abs : null;
}

export async function removeCommunityIcon(relPath: string | null): Promise<void> {
  const abs = relPath ? iconAbsPath(relPath) : null;
  if (abs) await fsp.unlink(abs).catch(() => {});
}

export async function communityIconRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };
  const changed = (id: string): void => {
    (app as unknown as { io?: Server }).io?.to(communityRoom(id)).emit('community:changed', { communityId: id });
  };

  app.put('/api/communities/:id/icon', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return reply.code(400).send({ error: 'Invalid input' });
    const me = request.userId!;
    const member = await findMembership(p.data.id, me); if (!member) return missing(reply);
    if (member.role !== 'OWNER') return reply.code(403).send({ error: 'Forbidden' });
    const limit = isProfileUpdateRateLimited(me); if (limit.limited) return tooMany(reply, limit.retryAfterSeconds);
    const release = tryResourceLock(`community-icon:${p.data.id}`); if (!release) return tooMany(reply, 1);
    const releaseSlot = tryAvatarSlot(); if (!releaseSlot) { release(); return tooMany(reply, 1); }
    let abs: string | undefined;
    let committed = false;
    try {
      const part = await request.file({ limits: { fileSize: MAX_COMMUNITY_ICON_BYTES, files: 1 } });
      if (!part) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });
      await fsp.mkdir(COMMUNITY_ICONS_ROOT, { recursive: true });
      abs = path.join(COMMUNITY_ICONS_ROOT, `${crypto.randomUUID()}.upload`);
      await pipeline(part.file, byteLimit(MAX_COMMUNITY_ICON_BYTES), fs.createWriteStream(abs, { mode: 0o600, flags: 'wx' }));
      if (part.file.truncated) return reply.code(413).send({ error: 'File too large' });
      const mime = detectAvatarMime(await readFileHead(abs));
      if (!mime) return reply.code(400).send({ error: 'Formato não permitido. Use PNG, JPEG ou WebP' });
      const finalAbs = `${abs}.${EXT[mime]}`;
      await fsp.rename(abs, finalAbs);
      abs = finalAbs;
      const current = await prisma.community.findUnique({ where: { id: p.data.id }, select: { iconPath: true } });
      if (!current) return missing(reply);
      const updated = await prisma.community.update({
        where: { id: p.data.id },
        data: { iconPath: path.relative(process.cwd(), abs), iconMime: mime, iconUpdatedAt: new Date() },
        select: { iconUpdatedAt: true },
      });
      committed = true;
      await removeCommunityIcon(current.iconPath);
      changed(p.data.id);
      return reply.send({ iconVersion: updated.iconUpdatedAt?.toISOString() ?? null });
    } catch (err) {
      if (err instanceof StreamLimitError || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: 'File too large' });
      throw err;
    } finally {
      if (abs && !committed) await fsp.unlink(abs).catch(() => {});
      releaseSlot();
      release();
    }
  });

  app.delete('/api/communities/:id/icon', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return reply.code(400).send({ error: 'Invalid input' });
    const member = await findMembership(p.data.id, request.userId!); if (!member) return missing(reply);
    if (member.role !== 'OWNER') return reply.code(403).send({ error: 'Forbidden' });
    const release = tryResourceLock(`community-icon:${p.data.id}`); if (!release) return tooMany(reply, 1);
    try {
      const current = await prisma.community.findUnique({ where: { id: p.data.id }, select: { iconPath: true } });
      if (!current) return missing(reply);
      await prisma.community.update({ where: { id: p.data.id }, data: { iconPath: null, iconMime: null, iconUpdatedAt: null } });
      await removeCommunityIcon(current.iconPath);
      changed(p.data.id);
      return reply.send({ ok: true });
    } finally { release(); }
  });

  app.get('/api/communities/:id/icon', auth, async (request, reply) => {
    const p = params.safeParse(request.params); if (!p.success) return reply.code(400).send({ error: 'Invalid input' });
    if (!await findMembership(p.data.id, request.userId!)) return missing(reply);
    const community = await prisma.community.findUnique({ where: { id: p.data.id }, select: { iconPath: true, iconMime: true } });
    const abs = community?.iconPath ? iconAbsPath(community.iconPath) : null;
    if (!abs || !community?.iconMime) return missing(reply);
    reply.header('Content-Type', community.iconMime);
    reply.header('X-Content-Type-Options', 'nosniff');
    // URL leva ?v=<iconVersion>: troca de icone muda a URL; privado (exige sessao).
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.send(fs.createReadStream(abs));
  });
}
