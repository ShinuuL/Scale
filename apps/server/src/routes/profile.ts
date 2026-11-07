import type { FastifyInstance, FastifyReply } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { byteLimit, StreamLimitError, tryAvatarSlot, tryResourceLock } from '../lib/resourceLimits.js';
import { z } from 'zod';
import { AVATAR_MIMES, MAX_AVATAR_SIZE_BYTES, USER_NAME_MAX, USER_NAME_MIN } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { readFileHead, UPLOADS_ROOT } from '../lib/uploads.js';
import { isProfileUpdateRateLimited } from '../lib/rateLimit.js';

/** Fotos de perfil: uploads/avatars/<userId>.<ext>, fora das pastas de sala. */
export const AVATARS_ROOT = path.resolve(UPLOADS_ROOT, 'avatars');

const AVATAR_EXT: Record<(typeof AVATAR_MIMES)[number], string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

const updateProfileSchema = z.object({
  // trim ANTES dos limites (transform + pipe): "   " nao vira nome vazio.
  name: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(USER_NAME_MIN).max(USER_NAME_MAX)),
});

/**
 * Formato real da foto pelos magic bytes. So PNG, JPEG e WebP: GIF animado e
 * SVG (documento ativo) ficam fora. WebP e RIFF....WEBP — nao confundir com WAV.
 */
export function detectAvatarMime(buf: Buffer): (typeof AVATAR_MIMES)[number] | null {
  if (buf.length < 12) return null;
  const hex = buf.subarray(0, 4).toString('hex').toUpperCase();
  if (hex === '89504E47') return 'image/png';
  if (hex.startsWith('FFD8FF')) return 'image/jpeg';
  if (hex === '52494646' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Caminho absoluto da foto, sempre dentro de AVATARS_ROOT (sandbox). */
function avatarAbsPath(relPath: string): string | null {
  const abs = path.resolve(process.cwd(), relPath);
  return abs.startsWith(AVATARS_ROOT + path.sep) ? abs : null;
}

async function removeAvatarFile(relPath: string | null): Promise<void> {
  if (!relPath) return;
  const abs = avatarAbsPath(relPath);
  if (abs) await fsp.unlink(abs).catch(() => {});
}

function tooMany(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header('Retry-After', String(Math.max(1, retryAfterSeconds)))
    .send({ error: 'Too many profile updates. Try again later.' });
}

/** Campos do proprio usuario devolvidos por /api/auth/me e pelas rotas de perfil. */
export const meSelect = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  avatarUpdatedAt: true,
  username: { select: { name: true } },
} as const;

type MeRow = {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  avatarUpdatedAt: Date | null;
  username: { name: string } | null;
};

/** Achata o @nome (tabela Username) para `username: string | null`. */
export function toMe(u: MeRow) {
  return { ...u, username: u.username?.name ?? null };
}

export async function profileRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = { preHandler: [fastify.authenticate as never] };

  // PATCH /api/me — altera o nome de exibicao e reemite o JWT (o nome vai nele).
  fastify.patch('/api/me', auth, async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ error: 'Not authenticated' });

    const limit = isProfileUpdateRateLimited(userId);
    if (limit.limited) return tooMany(reply, limit.retryAfterSeconds);

    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const user = await prisma.user
      .update({ where: { id: userId }, data: { name: parsed.data.name }, select: meSelect })
      .then(toMe)
      .catch(() => null);
    if (!user) return reply.code(404).send({ error: 'User not found' });

    reply.setCookie('token', signToken({ userId: user.id, email: user.email, name: user.name }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
    return reply.send({ user });
  });

  // PUT /api/me/avatar — multipart com um arquivo `avatar` (ate 32 MB).
  fastify.put('/api/me/avatar', auth, async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ error: 'Not authenticated' });

    // Balde ANTES de ler o multipart: cada chamada grava ate 32 MB no disco.
    const limit = isProfileUpdateRateLimited(userId);
    if (limit.limited) return tooMany(reply, limit.retryAfterSeconds);

    const releaseUser = tryResourceLock(`avatar:${userId}`);
    if (!releaseUser) return tooMany(reply, 1);
    const releaseSlot = tryAvatarSlot();
    if (!releaseSlot) { releaseUser(); return tooMany(reply, 1); }
    let abs: string | undefined;
    let committed = false;
    try {
      const part = await request.file({ limits: { fileSize: MAX_AVATAR_SIZE_BYTES, files: 1 } });
      if (!part) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });
      const current = await prisma.user.findUnique({ where: { id: userId }, select: { avatarPath: true } });
      if (!current) { part.file.resume(); return reply.code(404).send({ error: 'User not found' }); }
      await fsp.mkdir(AVATARS_ROOT, { recursive: true });
      // UUID evita colisao entre duas atualizacoes no mesmo milissegundo.
      abs = path.join(AVATARS_ROOT, `${crypto.randomUUID()}.upload`);
      await pipeline(part.file, byteLimit(MAX_AVATAR_SIZE_BYTES), fs.createWriteStream(abs, { mode: 0o600, flags: 'wx' }));
      if (part.file.truncated) {
        await fsp.unlink(abs).catch(() => {}); abs = undefined;
        return reply.code(413).send({ error: 'File too large. Max 32MB' });
      }
      const mime = detectAvatarMime(await readFileHead(abs));
      if (!mime) {
        await fsp.unlink(abs).catch(() => {}); abs = undefined;
        return reply.code(400).send({ error: 'Formato não permitido. Use PNG, JPEG ou WebP' });
      }
      const finalAbs = `${abs}.${AVATAR_EXT[mime]}`;
      await fsp.rename(abs, finalAbs);
      abs = finalAbs;
      const user = await prisma.user.update({
        where: { id: userId },
        data: { avatarPath: path.relative(process.cwd(), abs), avatarMime: mime, avatarUpdatedAt: new Date() },
        select: meSelect,
      }).then(toMe);
      committed = true;
      await removeAvatarFile(current.avatarPath);
      return reply.send({ user });
    } catch (err) {
      if (err instanceof StreamLimitError || (err as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
        if (abs) { await fsp.unlink(abs).catch(() => {}); abs = undefined; }
        return reply.code(413).send({ error: 'File too large. Max 32MB' });
      }
      throw err;
    } finally {
      if (abs && !committed) await fsp.unlink(abs).catch(() => {});
      releaseSlot();
      releaseUser();
    }
  });

  // DELETE /api/me/avatar — remove a foto (idempotente).
  fastify.delete('/api/me/avatar', auth, async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ error: 'Not authenticated' });

    const release = tryResourceLock(`avatar:${userId}`);
    if (!release) return tooMany(reply, 1);
    try {
      const current = await prisma.user.findUnique({ where: { id: userId }, select: { avatarPath: true } });
      if (!current) return reply.code(404).send({ error: 'User not found' });

      const user = await prisma.user.update({
        where: { id: userId },
        data: { avatarPath: null, avatarMime: null, avatarUpdatedAt: null },
        select: meSelect,
      }).then(toMe);
      await removeAvatarFile(current.avatarPath);
      return reply.send({ user });
    } finally { release(); }
  });

  // GET /api/me/avatar — a propria foto (so o dono da sessao, por enquanto).
  fastify.get('/api/me/avatar', auth, async (request, reply) => {
    const userId = request.userId;
    if (!userId) return reply.code(401).send({ error: 'Not authenticated' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarPath: true, avatarMime: true },
    });
    const abs = user?.avatarPath ? avatarAbsPath(user.avatarPath) : null;
    if (!abs || !user?.avatarMime) return reply.code(404).send({ error: 'No avatar' });

    reply.header('Content-Type', user.avatarMime);
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.send(fs.createReadStream(abs));
  });
}
