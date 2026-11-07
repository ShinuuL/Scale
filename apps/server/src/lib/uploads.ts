import fs from 'node:fs/promises';
import path from 'node:path';
import { tryResourceLock } from './resourceLimits.js';
import { prisma } from './prisma.js';

// Allowlist de MIME: fonte unica em @scale/shared (ALLOWED_MIME_RE).
export const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

export function sanitizeFilename(name: string): string {
  let base = path.basename(name);
  base = base.replaceAll('\0', '');
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (base.length > 255) base = base.slice(0, 255);
  // previne nomes vazios ou só pontos
  if (!base || base === '.' || base === '..') base = 'file';
  // colapsa leading dots
  base = base.replace(/^\.+/, '_');
  return base;
}

export function detectMagicBytes(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const hex = buf.subarray(0, 8).toString('hex').toUpperCase();
  if (hex.startsWith('89504E47')) return 'image/png';
  if (hex.startsWith('FFD8FF')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('504B0304') || hex.startsWith('504B0506') || hex.startsWith('504B0708')) return 'application/zip';
  // audio: MP3 (ID3) 494433, WAV 52494646, OGG 4F676753
  if (hex.startsWith('494433')) return 'audio/mpeg';
  if (hex.startsWith('52494646')) return 'audio/wav';
  if (hex.startsWith('4F676753')) return 'audio/ogg';
  if (hex.startsWith('FFFB') || hex.startsWith('FFF3')) return 'audio/mpeg';
  // text/plain: sem magic — retorna null (allow via mime declarado)
  return null;
}

/**
 * Caminho de destino de um upload: `uploads/<roomId>/<fileId>-<nome>`, com
 * sandbox (a pasta da sala fica dentro de UPLOADS_ROOT e o arquivo dentro da
 * pasta) e a pasta ja criada. O upload grava por stream direto nele.
 */
export async function prepareFilePath(
  roomId: string,
  fileId: string,
  filename: string,
): Promise<{ abs: string; rel: string }> {
  const sanitized = sanitizeFilename(filename);
  const resolvedDir = path.resolve(UPLOADS_ROOT, roomId);
  if (!resolvedDir.startsWith(UPLOADS_ROOT + path.sep)) throw new Error('Invalid roomId');
  await fs.mkdir(resolvedDir, { recursive: true });
  const resolvedFile = path.resolve(resolvedDir, `${fileId}-${sanitized}`);
  if (!resolvedFile.startsWith(resolvedDir + path.sep)) throw new Error('Path traversal blocked');
  return { abs: resolvedFile, rel: path.relative(process.cwd(), resolvedFile) };
}

/** Primeiros bytes de um arquivo ja gravado (para conferir magic bytes). */
export async function readFileHead(abs: string, length = 16): Promise<Buffer> {
  const handle = await fs.open(abs, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Remove o diretorio `uploads/<roomId>` inteiro (exclusao definitiva da sala).
 * Sandbox: o caminho resolvido tem de ser um filho direto de UPLOADS_ROOT —
 * nunca a propria raiz nem algo fora dela. Diretorio ausente nao e erro.
 */
export async function removeRoomUploads(roomId: string): Promise<void> {
  const dir = path.resolve(UPLOADS_ROOT, roomId);
  if (!dir.startsWith(UPLOADS_ROOT + path.sep) || path.dirname(dir) !== UPLOADS_ROOT) {
    throw new Error('Invalid roomId');
  }
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Bytes ainda referenciados pela sala, inclusive apagados aguardando GC/unlink.
 * A quota so e liberada apos remocao fisica/ENOENT. SQL cru porque
 * `size` e Int de 32 bits no Prisma: com a cota de 2 GB a SOMA passa de 2^31 e
 * o `aggregate` estouraria. O SQLite soma em 64 bits e devolve BigInt.
 */
export async function getQuotaUsage(roomId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint | number | null }>>`
    SELECT SUM("size") AS total FROM "ChatFile"
    WHERE "roomId" = ${roomId}`;
  return Number(rows[0]?.total ?? 0);
}

/** Lotes pequenos, cursor estavel e yield por I/O: falha de unlink preserva a linha. */
export async function gcDeletedFiles(): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - 7*24*60*60*1000);
  let deletedCount = 0;
  let cursor: string | undefined;
  for (;;) {
    const expired = await prisma.chatFile.findMany({
      where: { deletedAt: { lt: cutoff }, ...(cursor ? { id: { gt: cursor } } : {}) },
      take: 100, orderBy: { id: 'asc' },
    });
    if (!expired.length) break;
    for (const f of expired) {
      cursor = f.id;
      const release = tryResourceLock(`room:${f.roomId}`);
      if (!release) continue;
      try {
        const abs = path.resolve(process.cwd(), f.path);
        const root = path.resolve(UPLOADS_ROOT, f.roomId);
        if (!root.startsWith(UPLOADS_ROOT + path.sep) || !abs.startsWith(root + path.sep)) continue;
        try { await fs.unlink(abs); } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') continue;
        }
        await prisma.chatFile.delete({ where: { id: f.id } });
        deletedCount++;
      } finally { release(); }
    }
  }
  return { deletedCount };
}

/** Upload interrompido/compensacao com unlink falho: remove orfaos apos 7 dias.
 * Iteradores de diretorio evitam materializar uma arvore inteira em memoria.
 */
export async function gcOrphanUploads(): Promise<void> {
  let root;
  try { root = await fs.opendir(UPLOADS_ROOT); } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  const cutoff = Date.now() - 7*24*60*60*1000;
  for await (const dir of root) {
    if (!dir.isDirectory() || !/^[a-zA-Z0-9-]+$/.test(dir.name)) continue;
    const release = tryResourceLock(dir.name === 'avatars' ? 'avatar:gc' : `room:${dir.name}`);
    if (!release) continue;
    try {
      for await (const entry of await fs.opendir(path.join(UPLOADS_ROOT, dir.name))) {
        if (!entry.isFile()) continue;
        const abs = path.join(UPLOADS_ROOT, dir.name, entry.name);
        let mtime;
        try { mtime = (await fs.stat(abs)).mtimeMs; } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw err;
        }
        if (mtime >= cutoff) continue;
        const rel = path.relative(process.cwd(), abs);
        const referenced = dir.name === 'avatars'
          ? await prisma.user.findFirst({ where: { avatarPath: rel }, select: { id: true } })
          : await prisma.chatFile.findFirst({ where: { path: rel }, select: { id: true } });
        if (!referenced) await fs.unlink(abs).catch(() => {});
      }
    } finally { release(); }
  }
}
