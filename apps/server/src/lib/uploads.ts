import fs from 'node:fs/promises';
import path from 'node:path';
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
 * Bytes usados pela sala (vivos + apagados ha menos de 7 dias). SQL cru porque
 * `size` e Int de 32 bits no Prisma: com a cota de 2 GB a SOMA passa de 2^31 e
 * o `aggregate` estouraria. O SQLite soma em 64 bits e devolve BigInt.
 */
export async function getQuotaUsage(roomId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000);
  const rows = await prisma.$queryRaw<Array<{ total: bigint | number | null }>>`
    SELECT SUM("size") AS total FROM "ChatFile"
    WHERE "roomId" = ${roomId} AND ("deletedAt" IS NULL OR "deletedAt" > ${sevenDaysAgo})`;
  return Number(rows[0]?.total ?? 0);
}

export async function gcDeletedFiles(): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - 7*24*60*60*1000);
  const expired = await prisma.chatFile.findMany({ where: { deletedAt: { lt: cutoff } } });
  let deletedCount = 0;
  for (const f of expired) {
    try {
      const abs = path.resolve(process.cwd(), f.path);
      if (abs.startsWith(UPLOADS_ROOT)) await fs.unlink(abs).catch(() => {});
    } catch {
      // best-effort: arquivo pode já não existir no disco
    }
    await prisma.chatFile.delete({ where: { id: f.id } }).catch(()=>{});
    deletedCount++;
  }
  if (deletedCount) console.log(`[gc] removed ${deletedCount} expired chat files`);
  return { deletedCount };
}