import { describe, it, expect } from 'vitest';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';

describe('chat validation', () => {
  // Lazy imports — will fail until schemas are exported
  async function getSchemas() {
    const mod = await import('@scale/shared');
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

  it('fileMeta rejeita size >250MB', async () => {
    const { fileMetaSchema } = await getSchemas();
    expect(
      fileMetaSchema.safeParse({
        roomId: '550e8400-e29b-41d4-a716-446655440000',
        filename: 'a.zip',
        mime: 'application/zip',
        size: 250_000_001,
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
import { guestCookie } from './helpers/participation.js';

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

  function connectClient(guestName = 'TestUser', guestId?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        auth: { guestName },
        transports: ['websocket'],
        // Cookie assinado do guestId (o browser manda sozinho no handshake).
        extraHeaders: guestId ? { cookie: guestCookie(guestId) } : undefined,
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

  function connectClient(guestName = 'TestUser', guestId?: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        auth: { guestName },
        transports: ['websocket'],
        // Cookie assinado do guestId (o browser manda sozinho no handshake).
        extraHeaders: guestId ? { cookie: guestCookie(guestId) } : undefined,
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
    const aliceGuestId = crypto.randomUUID();
    const alice = await connectClient('Alice', aliceGuestId);
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
        guestId: aliceGuestId,
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
// Etapa 1: barreira "Tailnet only" removida (plugins/checkTailscale.ts + io.use)
// Estes testes substituem o suite antigo que validava a barreira: agora
// garantem o comportamento oposto — acesso público alcança as rotas/handshake.
// ---------------------------------------------------------------------------
import { describe as d4, it as it4, beforeAll as ba4, afterAll as aa4 } from 'vitest';
import { resetEnv } from '../lib/env.js';
import cookie from '@fastify/cookie';
import { authPlugin } from '../plugins/auth.js';
import { roomRoutes } from '../routes/rooms.js';

d4('acesso sem barreira de rede (túnel HTTPS)', () => {
  let app: Fastify.FastifyInstance;
  let httpServer: HttpServer;
  let port: number;

  ba4(async () => {
    // Producao exige JWT_SECRET >= 32 caracteres — lib/env.ts.
    process.env.JWT_SECRET = 'segredo-de-teste-do-jwt-em-producao-0123456789';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.NODE_ENV = 'production'; // vitest seta 'test'; aqui queremos sem bypass
    // Producao exige GUEST_COOKIE_SECRET (>= 32 caracteres) — lib/guestId.ts.
    process.env.GUEST_COOKIE_SECRET = 'segredo-de-teste-do-cookie-de-convidado-0123456789';
    // getEnv() cacheia em nível de módulo — resetEnv força releitura limpa.
    resetEnv();

    app = Fastify({ logger: false, trustProxy: true });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(roomRoutes);
    app.get('/api/health', async () => ({ status: 'ok' }));
    await app.listen({ port: 0, host: '127.0.0.1' });
    httpServer = app.server;
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
    // Socket.io sem o middleware io.use "Tailnet only" (removido na Etapa 1).
    createSocketServer(httpServer);
  });

  aa4(async () => {
    await app.close();
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    delete process.env.GUEST_COOKIE_SECRET;
    resetEnv();
  });

  it4('REST não responde mais 403 "Tailnet only" para IP público', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { 'x-forwarded-for': '8.8.8.8' },
      remoteAddress: '8.8.8.8',
      payload: { name: 'Via tunel', isPersistent: false },
    });
    // Antes: 403 Tailnet only (hook checkTailscaleOrigin). Agora a barreira de IP
    // sumiu: o request chega ao handler, que exige login → 401 (não 403).
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload).error).toMatch(/Authentication required/i);
  });

  it4('Socket.io aceita handshake de IP público (antes: connect_error "Tailnet only")', async () => {
    const client = await new Promise<Socket>((resolve, reject) => {
      const c = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        extraHeaders: { 'x-forwarded-for': '8.8.8.8' },
      });
      c.on('connect', () => resolve(c));
      c.on('connect_error', (err) => reject(err));
    });
    expect(client.id).toBeDefined();
    client.disconnect();
  });
});
