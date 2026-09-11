import { describe, it, expect } from 'vitest';
import { sanitizeFilename, detectMagicBytes, getQuotaUsage } from '../lib/uploads.js';
import { prisma } from '../lib/prisma.js';

describe('uploads lib', () => {
  it('sanitize bloqueia path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('..');
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
  });

  it('detectMagicBytes identifica png/pdf/zip e rejeita mismatch', () => {
    expect(detectMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectMagicBytes(Buffer.from([0x25, 0x50, 0x44, 0x46]))).toBe('application/pdf');
    expect(detectMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('application/zip');
    // mismatch: PNG magic bytes must not be accepted as application/pdf
    expect(detectMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).not.toBe('application/pdf');
    // unknown magic → null
    expect(detectMagicBytes(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it('quota soma com grace 7d', async () => {
    const room = await prisma.room.create({
      data: { name: 'Quota Room', isPersistent: true },
    });
    const msg = await prisma.chatMessage.create({
      data: { roomId: room.id, content: 'files' },
    });
    try {
      // recentes (deletedAt null) contam para a quota
      await prisma.chatFile.create({
        data: { roomId: room.id, messageId: msg.id, filename: 'a.png', mime: 'image/png', size: 100, path: `uploads/${room.id}/a.png` },
      });
      await prisma.chatFile.create({
        data: { roomId: room.id, messageId: msg.id, filename: 'b.png', mime: 'image/png', size: 50, path: `uploads/${room.id}/b.png` },
      });
      // apagado há 8 dias (> 7d) NÃO conta
      await prisma.chatFile.create({
        data: {
          roomId: room.id,
          messageId: msg.id,
          filename: 'old.png',
          mime: 'image/png',
          size: 1000,
          path: `uploads/${room.id}/old.png`,
          deletedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        },
      });
      expect(await getQuotaUsage(room.id)).toBe(150);
    } finally {
      await prisma.room.delete({ where: { id: room.id } }).catch(() => {});
    }
  });
});