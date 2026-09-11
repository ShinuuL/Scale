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
      data: { name: 'Sala Chat', isPersistent: true, passwordHash: '$2a$10$fakehashfakehashfakehashfakeha' }
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

// ---------------------------------------------------------------------------
// socket chat:message — integration tests via real socket.io-client
// ---------------------------------------------------------------------------
import { describe as d2, it as it2, beforeAll as ba2, afterAll as aa2 } from 'vitest';
import { Server as HttpServer } from 'http';
import Fastify from 'fastify';
import { io as ioClient, Socket } from 'socket.io-client';
import { createSocketServer, chatBuffers } from '../socket/handler.js';
import { resetRateLimit, resetChatRateLimit } from '../lib/rateLimit.js';

d2('socket chat:message', () => {
  let app: Fastify.FastifyInstance;
  let httpServer: HttpServer;
  let port: number;
  let persistRoomId: string;
  let tempRoomId: string;

  ba2(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

    app = Fastify({ logger: false });
    app.get('/health', async () => ({ status: 'ok' }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    httpServer = app.server;
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
    createSocketServer(httpServer);

    // persistent room
    const persistRoom = await prisma.room.create({
      data: { name: 'Persist Chat', isPersistent: true },
    });
    persistRoomId = persistRoom.id;

    // temp room
    const tempRoom = await prisma.room.create({
      data: { name: 'Temp Chat', isPersistent: false },
    });
    tempRoomId = tempRoom.id;
  });

  aa2(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  function connectClient(guestName = 'TestUser'): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        auth: { guestName },
        transports: ['websocket'],
      });
      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
    });
  }

  function joinRoom(client: Socket, roomId: string): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      client.emit('join-room', { roomId }, (resp: Record<string, unknown>) => resolve(resp));
    });
  }

  function emitChat(
    client: Socket,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      client.emit('chat:message', payload, (resp: Record<string, unknown>) => resolve(resp));
    });
  }

  it2('persistent room creates in prisma and emits broadcast', async () => {
    const client1 = await connectClient('Alice');
    const client2 = await connectClient('Bob');
    await joinRoom(client1, persistRoomId);
    await joinRoom(client2, persistRoomId);

    const broadcastPromise = new Promise<Record<string, unknown>>((resolve) => {
      client2.on('chat:message', (data: Record<string, unknown>) => resolve(data));
    });

    const result = await emitChat(client1, {
      roomId: persistRoomId,
      content: 'hello from Alice',
    });
    expect(result.success).toBe(true);
    expect(result.messageId).toBeDefined();

    const broadcast = await broadcastPromise;
    expect(broadcast.content).toBe('hello from Alice');
    expect(broadcast.id).toBe(result.messageId);

    // verify prisma row
    const row = await prisma.chatMessage.findUnique({ where: { id: result.messageId as string } });
    expect(row).not.toBeNull();
    expect(row!.content).toBe('hello from Alice');

    client1.disconnect();
    client2.disconnect();
  });

  it2('temporary room uses buffer FIFO 100 and discards oldest', async () => {
    const client = await connectClient('BufferTester');
    await joinRoom(client, tempRoomId);

    // Clear any leftover buffer
    chatBuffers.delete(tempRoomId);

    // Send 101 messages — reset both rate windows between sends so the FIFO
    // buffer (not the 30/s or 5/5s rate limit) is what's being exercised.
    for (let i = 0; i < 101; i++) {
      resetRateLimit(`socket:${client.id}`);
      resetChatRateLimit(`chat:${client.id}`);
      const result = await emitChat(client, {
        roomId: tempRoomId,
        content: `msg-${i}`,
      });
      expect(result.success).toBe(true);
    }

    const buf = chatBuffers.get(tempRoomId);
    expect(buf).toBeDefined();
    expect(buf!.length).toBe(100);
    // First message (msg-0) should have been discarded; oldest is msg-1
    expect(buf![0].content).toBe('msg-1');
    // Most recent is msg-100
    expect(buf![99].content).toBe('msg-100');

    client.disconnect();
  });

  it2('rejects rate 5/5s on 6th message', async () => {
    const client = await connectClient('RateLimiter');
    await joinRoom(client, tempRoomId);
    chatBuffers.delete(tempRoomId);

    // First 5 should succeed
    for (let i = 0; i < 5; i++) {
      const result = await emitChat(client, {
        roomId: tempRoomId,
        content: `rate-${i}`,
      });
      expect(result.success).toBe(true);
    }

    // 6th should be rate limited
    const result = await emitChat(client, {
      roomId: tempRoomId,
      content: 'rate-5-exceeded',
    });
    expect(result.error).toMatch(/Rate limit/i);

    client.disconnect();
  });

  it2('mention intersect only notifies current peers', async () => {
    const alice = await connectClient('Alice');
    const bob = await connectClient('Bob');
    await joinRoom(alice, tempRoomId);
    await joinRoom(bob, tempRoomId);

    // Listen for chat:mention on Bob's client
    const mentionPromise = new Promise<Record<string, unknown> | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 2000);
      bob.on('chat:mention', (data: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    // Send message mentioning @Bob (in room) and @Carlos (not in room)
    await emitChat(alice, {
      roomId: tempRoomId,
      content: 'hi @Bob and @Carlos',
      mentions: ['Bob', 'Carlos'],
    });

    const mention = await mentionPromise;
    expect(mention).not.toBeNull();
    expect(mention!.roomId).toBe(tempRoomId);

    alice.disconnect();
    bob.disconnect();
  });
});
