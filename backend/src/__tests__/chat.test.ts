import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
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

// ---------------------------------------------------------------------------
// Task 5: chat:edit / chat:delete / join-room history — integration tests
// ---------------------------------------------------------------------------
import { describe as d3, it as it3, beforeAll as ba3, afterAll as aa3 } from 'vitest';

d3('chat:edit/delete', () => {
  let app: Fastify.FastifyInstance;
  let httpServer: HttpServer;
  let port: number;
  let persistRoomId: string;
  let tempRoomId: string;

  ba3(async () => {
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
      data: { name: 'Edit Persist', isPersistent: true },
    });
    persistRoomId = persistRoom.id;

    // temp room
    const tempRoom = await prisma.room.create({
      data: { name: 'Edit Temp', isPersistent: false },
    });
    tempRoomId = tempRoom.id;
  });

  aa3(async () => {
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

  function emitChat(client: Socket, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      client.emit('chat:message', payload, (resp: Record<string, unknown>) => resolve(resp));
    });
  }

  function emitEdit(client: Socket, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      client.emit('chat:edit', payload, (resp: Record<string, unknown>) => resolve(resp));
    });
  }

  function emitDelete(client: Socket, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      client.emit('chat:delete', payload, (resp: Record<string, unknown>) => resolve(resp));
    });
  }

  it3('edit only author within 15min — prevContent + editedAt', async () => {
    const alice = await connectClient('Alice');
    const bob = await connectClient('Bob');
    await joinRoom(alice, persistRoomId);
    await joinRoom(bob, persistRoomId);

    // Alice sends a message
    resetRateLimit(`socket:${alice.id}`);
    resetChatRateLimit(`chat:${alice.id}`);
    const sendResult = await emitChat(alice, { roomId: persistRoomId, content: 'old text' });
    expect(sendResult.success).toBe(true);
    const msgId = sendResult.messageId as string;

    // Alice edits her own message
    resetRateLimit(`socket:${alice.id}`);
    resetChatRateLimit(`chat:${alice.id}`);
    const editResult = await emitEdit(alice, { roomId: persistRoomId, messageId: msgId, content: 'new text' });
    expect(editResult.success).toBe(true);

    // Verify in DB
    const row = await prisma.chatMessage.findUnique({ where: { id: msgId } });
    expect(row).not.toBeNull();
    expect(row!.content).toBe('new text');
    expect(row!.prevContent).toBe('old text');
    expect(row!.editedAt).not.toBeNull();

    // Bob tries to edit Alice's message → rejected
    resetRateLimit(`socket:${bob.id}`);
    resetChatRateLimit(`chat:${bob.id}`);
    const bobEdit = await emitEdit(bob, { roomId: persistRoomId, messageId: msgId, content: 'hacked' });
    expect(bobEdit.error).toMatch(/Not message author/i);

    // Edit expired (create a message with createdAt 16min ago)
    const oldMsg = await prisma.chatMessage.create({
      data: {
        roomId: persistRoomId,
        content: 'expired msg',
        authorId: null,
        guestName: 'Alice',
        createdAt: new Date(Date.now() - 16 * 60 * 1000),
      },
    });
    resetRateLimit(`socket:${alice.id}`);
    resetChatRateLimit(`chat:${alice.id}`);
    const expiredEdit = await emitEdit(alice, { roomId: persistRoomId, messageId: oldMsg.id, content: 'nope' });
    expect(expiredEdit.error).toMatch(/Edit window expired/i);

    alice.disconnect();
    bob.disconnect();
  });

  it3('delete soft — author or owner with ChatFile cascade', async () => {
    const alice = await connectClient('Alice');
    await joinRoom(alice, persistRoomId);

    // Create a message via chat
    resetRateLimit(`socket:${alice.id}`);
    resetChatRateLimit(`chat:${alice.id}`);
    const sendResult = await emitChat(alice, { roomId: persistRoomId, content: 'to delete' });
    const msgId = sendResult.messageId as string;

    // Attach a file
    const file = await prisma.chatFile.create({
      data: { roomId: persistRoomId, messageId: msgId, filename: 'a.txt', mime: 'text/plain', size: 10, path: `uploads/${persistRoomId}/a.txt` },
    });

    // Alice deletes
    resetRateLimit(`socket:${alice.id}`);
    resetChatRateLimit(`chat:${alice.id}`);
    const delResult = await emitDelete(alice, { roomId: persistRoomId, messageId: msgId });
    expect(delResult.success).toBe(true);

    // Verify
    const row = await prisma.chatMessage.findUnique({ where: { id: msgId } });
    expect(row!.content).toBe('[mensagem apagada]');
    expect(row!.deletedAt).not.toBeNull();

    const fileRow = await prisma.chatFile.findUnique({ where: { id: file.id } });
    expect(fileRow!.deletedAt).not.toBeNull();

    // Idempotent — delete again returns success
    resetRateLimit(`socket:${alice.id}`);
    resetChatRateLimit(`chat:${alice.id}`);
    const idempotent = await emitDelete(alice, { roomId: persistRoomId, messageId: msgId });
    expect(idempotent.success).toBe(true);

    alice.disconnect();
  });

  it3('delete rejected for non-author non-owner', async () => {
    const alice = await connectClient('Alice');
    const bob = await connectClient('Bob');
    await joinRoom(alice, persistRoomId);
    await joinRoom(bob, persistRoomId);

    // Alice sends
    resetRateLimit(`socket:${alice.id}`);
    resetChatRateLimit(`chat:${alice.id}`);
    const sendResult = await emitChat(alice, { roomId: persistRoomId, content: 'alice msg' });
    const msgId = sendResult.messageId as string;

    // Bob tries to delete — not author, not owner
    resetRateLimit(`socket:${bob.id}`);
    resetChatRateLimit(`chat:${bob.id}`);
    const bobDel = await emitDelete(bob, { roomId: persistRoomId, messageId: msgId });
    expect(bobDel.error).toMatch(/Not authorized to delete/i);

    alice.disconnect();
    bob.disconnect();
  });

  it3('join-room returns history 200 for persistent and buffer for temp', async () => {
    // --- Persistent: create 250 msgs, join, expect 200 ---
    const roomPersist = await prisma.room.create({
      data: { name: 'Hist Persist', isPersistent: true },
    });
    const userIds = ['user-a', 'user-b'];
    for (let i = 0; i < 250; i++) {
      await prisma.chatMessage.create({
        data: {
          roomId: roomPersist.id,
          content: `msg-${i}`,
          authorId: userIds[i % 2],
          guestName: i % 2 === 0 ? 'A' : 'B',
        },
      });
    }

    const histClient = await connectClient('HistUser');
    const joinResult = await joinRoom(histClient, roomPersist.id);
    expect(joinResult.success).toBe(true);
    const history = joinResult.history as Array<{ content: string; id: string }>;
    expect(history.length).toBe(200);
    // ASC: first is oldest among the 200, last is most recent (msg-249)
    expect(history[0].content).toBe('msg-50');
    expect(history[199].content).toBe('msg-249');

    histClient.disconnect();

    // --- Temp: create buffer entries, join, expect buffer slice ---
    const roomTemp = await prisma.room.create({
      data: { name: 'Hist Temp', isPersistent: false },
    });
    // Seed the in-memory buffer
    chatBuffers.delete(roomTemp.id);
    const buf = chatBuffers.get(roomTemp.id) ?? [];
    for (let i = 0; i < 5; i++) {
      buf.push({
        id: crypto.randomUUID(),
        roomId: roomTemp.id,
        content: `temp-${i}`,
        authorId: null,
        guestName: 'TempUser',
        createdAt: new Date(),
      });
    }
    chatBuffers.set(roomTemp.id, buf);

    const tempClient = await connectClient('TempHistUser');
    const tempJoin = await joinRoom(tempClient, roomTemp.id);
    expect(tempJoin.success).toBe(true);
    const tempHistory = tempJoin.history as Array<{ content: string }>;
    expect(tempHistory.length).toBe(5);
    expect(tempHistory[0].content).toBe('temp-0');

    tempClient.disconnect();
  });

  it3('join-room emits chat:system join and leave emits system leave', async () => {
    const alice = await connectClient('AliceSys');
    const bob = await connectClient('BobSys');
    await joinRoom(alice, tempRoomId);

    // Listen for system join on Alice
    const systemPromise = new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => resolve({}), 3000);
      alice.on('chat:system', (data: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    await joinRoom(bob, tempRoomId);
    const system = await systemPromise;
    expect(system.text).toMatch(/BobSys.*entrou/i);
    expect(system.kind).toBe('join');

    // Leave — listen for system leave on Alice
    const leavePromise = new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => resolve({}), 3000);
      alice.on('chat:system', (data: Record<string, unknown>) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

    bob.disconnect();
    const leaveSystem = await leavePromise;
    expect(leaveSystem.text).toMatch(/BobSys.*saiu/i);
    expect(leaveSystem.kind).toBe('leave');

    alice.disconnect();
  });

  it3('join-room com senha: sem creds → erro; com password ou inviteToken → success', async () => {
    const passRoom = await prisma.room.create({
      data: {
        name: 'Join Pass',
        isPersistent: true,
        passwordHash: bcrypt.hashSync('segredo123', 10),
      },
    });

    function joinWithCreds(
      client: Socket,
      roomId: string,
      creds: Record<string, unknown> = {},
    ): Promise<Record<string, unknown>> {
      return new Promise((resolve) => {
        client.emit('join-room', { roomId, ...creds }, (resp: Record<string, unknown>) => resolve(resp));
      });
    }

    // sem credencial → rejeitado
    const noCredsClient = await connectClient('NoCreds');
    const noCreds = await joinWithCreds(noCredsClient, passRoom.id);
    expect(noCreds.error).toMatch(/Invalid invite token or password/i);

    // com password correto → success
    const passClient = await connectClient('PassUser');
    const withPass = await joinWithCreds(passClient, passRoom.id, { password: 'segredo123' });
    expect(withPass.success).toBe(true);

    // com senha errada → rejeitado
    const wrongClient = await connectClient('WrongPass');
    const wrong = await joinWithCreds(wrongClient, passRoom.id, { password: 'errada123' });
    expect(wrong.error).toMatch(/Invalid invite token or password/i);
    wrongClient.disconnect();

    // com inviteToken → success
    const tokenClient = await connectClient('TokenUser');
    const withToken = await joinWithCreds(tokenClient, passRoom.id, { inviteToken: passRoom.inviteToken });
    expect(withToken.success).toBe(true);

    noCredsClient.disconnect();
    passClient.disconnect();
    tokenClient.disconnect();
    await prisma.room.delete({ where: { id: passRoom.id } }).catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// Task 14: hardening tailnet — checkTailscaleOrigin middleware
// ---------------------------------------------------------------------------
import { describe as d4, it as it4, beforeAll as ba4, afterAll as aa4 } from 'vitest';
import { checkTailscaleOrigin, isInSubnet } from '../plugins/checkTailscale.js';
import { resetEnv } from '../lib/env.js';

d4('tailnet hardening', () => {
  let app: Fastify.FastifyInstance;

  ba4(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.TAILSCALE_HOST = 'host-dev.tail-abc123.ts.net';
    process.env.NODE_ENV = 'production'; // vitest seta 'test'; aqui queremos sem bypass
    // getEnv() cacheia em nível de módulo — a suíte d2/d3 (socket) já chamou
    // createSocketServer e populou o cache SEM TAILSCALE_HOST. resetEnv garante
    // que checkTailscaleOrigin re-leia o process.env atualizado nesse suite.
    resetEnv();
    app = Fastify({ logger: false, trustProxy: true });
    app.addHook('onRequest', checkTailscaleOrigin);
    app.get('/api/health', async () => ({ status: 'ok' }));
    await app.ready();
  });

  aa4(async () => {
    await app.close();
    process.env.NODE_ENV = 'test';
    resetEnv();
  });

  it4('isInSubnet cobre a CGNAT 100.64.0.0/10', () => {
    expect(isInSubnet('100.64.0.1', '100.64.0.0/10')).toBe(true);
    expect(isInSubnet('100.127.255.255', '100.64.0.0/10')).toBe(true);
    expect(isInSubnet('100.128.0.1', '100.64.0.0/10')).toBe(false);
    expect(isInSubnet('8.8.8.8', '100.64.0.0/10')).toBe(false);
    expect(isInSubnet('::1', '100.64.0.0/10')).toBe(false);
  });

  it4('rejeita IP público fora tailnet com 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/rooms/xxx/messages',
      headers: { 'x-forwarded-for': '8.8.8.8' },
      remoteAddress: '8.8.8.8',
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toMatch(/Tailnet only/i);
  });

  it4('permite IP da CGNAT tailnet (100.64.0.0/10)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { 'x-forwarded-for': '100.64.0.10' },
      remoteAddress: '8.8.8.8', // com trustProxy o XFF tem precedência
    });
    expect(res.statusCode).toBe(200);
  });

  it4('permite Host contendo TAILSCALE_HOST (MagicDNS)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '8.8.8.8',
      headers: { host: 'host-dev.tail-abc123.ts.net:3443' },
    });
    expect(res.statusCode).toBe(200);
  });

  it4('permite Origin na allowlist ALLOWED_ORIGINS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '8.8.8.8',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(res.statusCode).toBe(200);
  });

  it4('permite localhost (healthcheck docker / dev)', async () => {
    // remoteAddress default do inject é 127.0.0.1
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it4('permite Docker bridge 172.18.x + host interno backend:4000 (rewrite Next.js)', async () => {
    // frontend container → backend:4000: IP da bridge do Docker + Host interno,
    // sem Origin (fetch server-to-server). Antes: 403 Tailnet only.
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      remoteAddress: '172.18.0.5',
      headers: { 'x-forwarded-for': '172.18.0.5', host: 'backend:4000' },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Socket.io tailnet barrier — middleware io.use equivalente ao checkTailscaleOrigin
// ---------------------------------------------------------------------------
import { describe as d5, it as it5, beforeAll as ba5, afterAll as aa5 } from 'vitest';

d5('socket tailnet hardening', () => {
  let app5: Fastify.FastifyInstance;
  let httpServer5: HttpServer;
  let port5: number;

  ba5(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.NODE_ENV = 'production'; // sem bypass (vitest default é 'test')
    resetEnv();

    app5 = Fastify({ logger: false });
    await app5.listen({ port: 0, host: '127.0.0.1' });
    httpServer5 = app5.server;
    const addr5 = httpServer5.address();
    if (addr5 && typeof addr5 === 'object') port5 = addr5.port;
    createSocketServer(httpServer5);
  });

  aa5(async () => {
    await app5?.close();
    process.env.NODE_ENV = 'test';
    resetEnv();
  });

  function connect5(extraHeaders: Record<string, string> = {}): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port5}`, {
        transports: ['websocket'],
        extraHeaders,
      });
      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
    });
  }

  it5('rejeita handshake com XFF público (8.8.8.8) → Tailnet only', async () => {
    await expect(connect5({ 'x-forwarded-for': '8.8.8.8' })).rejects.toThrow(
      /Tailnet only/i,
    );
  });

  it5('permite handshake com XFF na CGNAT tailnet (100.64.0.10)', async () => {
    const client = await connect5({ 'x-forwarded-for': '100.64.0.10' });
    expect(client.id).toBeDefined();
    client.disconnect();
  });

  it5('permite localhost (remoteAddress 127.0.0.1) mesmo em production', async () => {
    const client = await connect5();
    expect(client.id).toBeDefined();
    client.disconnect();
  });

  it5('permite handshake com XFF Docker bridge (172.18.0.5)', async () => {
    const client = await connect5({ 'x-forwarded-for': '172.18.0.5' });
    expect(client.id).toBeDefined();
    client.disconnect();
  });
});
