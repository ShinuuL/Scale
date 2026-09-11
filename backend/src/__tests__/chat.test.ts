import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';

describe('chat validation', () => {
  // Lazy imports — will fail until schemas are exported
  async function getSchemas() {
    const mod = await import('../socket/validation.js');
    return {
      chatMessageSchema: mod.chatMessageSchema,
      chatEditSchema: mod.chatEditSchema,
      chatDeleteSchema: mod.chatDeleteSchema,
      fileMetaSchema: mod.fileMetaSchema,
    };
  }

  it('rejeita content vazio e >500', async () => {
    const { chatMessageSchema } = await getSchemas();
    expect(chatMessageSchema.safeParse({ roomId: '550e8400-e29b-41d4-a716-446655440000', content: '' }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ roomId: '550e8400-e29b-41d4-a716-446655440000', content: 'a'.repeat(501) }).success).toBe(false);
  });

  it('aceita mentions max 8 e rejeita 9', async () => {
    const { chatMessageSchema } = await getSchemas();
    const base = {
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      content: 'hi',
      mentions: Array.from({ length: 8 }, (_, i) => `User${i}`),
    };
    expect(chatMessageSchema.safeParse(base).success).toBe(true);
    expect(chatMessageSchema.safeParse({ ...base, mentions: [...base.mentions!, 'extra'] }).success).toBe(false);
  });

  it('fileMeta rejeita size >15MB', async () => {
    const { fileMetaSchema } = await getSchemas();
    expect(
      fileMetaSchema.safeParse({
        roomId: '550e8400-e29b-41d4-a716-446655440000',
        filename: 'a.zip',
        mime: 'application/zip',
        size: 15_000_001,
      }).success,
    ).toBe(false);
  });
});

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
