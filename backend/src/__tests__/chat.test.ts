import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';

describe('prisma chat models', () => {
  it('cria sala persistente com passwordHash e mensagem+arquivo', async () => {
    const room = await prisma.room.create({
      data: { name: 'Sala Chat', isPersistent: true, passwordHash: '$2a$10$fakehashfakehashfakehashfakeha', inviteToken: '11111111-1111-4111-8111-111111111111' }
    });
    const msg = await prisma.chatMessage.create({
      data: { roomId: room.id, content: 'ola', authorId: null, guestName: 'Alice' }
    });
    const file = await prisma.chatFile.create({
      data: { roomId: room.id, messageId: msg.id, filename: 'doc.pdf', mime: 'application/pdf', size: 100, path: `uploads/${room.id}/x-doc.pdf` }
    });
    expect(room.passwordHash).toBeDefined();
    expect(msg.id).toBeDefined();
    expect(file.id).toBeDefined();
  });

  it('apaga em cascata ChatMessage quando Room é deletada', async () => {
    const room = await prisma.room.create({ data: { name: 'Temp Cascade', isPersistent: false } });
    const msg = await prisma.chatMessage.create({ data: { roomId: room.id, content: 'hi' } });
    await prisma.room.delete({ where: { id: room.id } });
    const leftover = await prisma.chatMessage.findUnique({ where: { id: msg.id } });
    expect(leftover).toBeNull();
  });
});
