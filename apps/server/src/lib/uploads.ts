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

export async function saveFile(roomId: string, fileId: string, filename: string, buffer: Buffer): Promise<string> {
  const sanitized = sanitizeFilename(filename);
  const dir = path.resolve(UPLOADS_ROOT, roomId);
  // sandbox check
  const resolvedDir = path.resolve(dir);
  if (!resolvedDir.startsWith(UPLOADS_ROOT)) throw new Error('Invalid roomId');
  await fs.mkdir(resolvedDir, { recursive: true });
  const filePath = path.join(resolvedDir, `${fileId}-${sanitized}`);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedDir)) throw new Error('Path traversal blocked');
  await fs.writeFile(resolvedFile, buffer, { mode: 0o600 });
  return path.relative(process.cwd(), resolvedFile);
}

export async function getQuotaUsage(roomId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000);
  const agg = await prisma.chatFile.aggregate({
    where: {
      roomId,
      OR: [{ deletedAt: null }, { deletedAt: { gt: sevenDaysAgo } }]
    },
    _sum: { size: true }
  });
  return agg._sum.size ?? 0;
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