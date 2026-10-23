/**
 * Regressoes da auditoria de seguranca (branch feat/arquitetura-desktop).
 * Cada `describe` cobre um item da auditoria; o numero do item esta no titulo.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server as HttpServer } from 'http';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { messagesRoutes } from '../routes/messages.js';
import { filesRoutes } from '../routes/files.js';
import { createSocketServer } from '../socket/handler.js';
import { resetRateLimit, resetChatRateLimit, resetRoomAuthFailures } from '../lib/rateLimit.js';
import bcrypt from 'bcryptjs';
import { redactUrl } from '../lib/logger.js';

type Ack = Record<string, unknown>;

interface Harness {
  app: FastifyInstance;
  port: number;
}

async function buildHarness(): Promise<Harness> {
  process.env.JWT_SECRET = 'test-secret-for-unit-tests';
  process.env.NODE_ENV = 'test';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
  await app.register(messagesRoutes);
  await app.register(filesRoutes);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const httpServer: HttpServer = app.server;
  const io = createSocketServer(httpServer);
  (app as unknown as { io: unknown }).io = io;
  const addr = httpServer.address();
  const port = addr && typeof addr === 'object' ? addr.port : 0;
  return { app, port };
}

function connect(port: number, auth: Record<string, unknown> = { guestName: 'Alice' }): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const client = ioClient(`http://127.0.0.1:${port}`, { auth, transports: ['websocket'] });
    client.on('connect', () => resolve(client));
    client.on('connect_error', (err) => reject(err));
  });
}

function emitAck(client: Socket, event: string, payload: unknown): Promise<Ack> {
  resetRateLimit(`socket:${client.id}`);
  resetChatRateLimit(`chat:${client.id}`);
  return new Promise((resolve) => {
    client.emit(event, payload, (resp: Ack) => resolve(resp));
  });
}

function nextEvent<T>(client: Socket, event: string): Promise<T> {
  return new Promise((resolve) => client.once(event, (data: T) => resolve(data)));
}

describe('item 1 — chat:delete limpa prevContent e leituras nao vazam conteudo apagado', () => {
  let h: Harness;
  let roomId: string;

  beforeAll(async () => {
    h = await buildHarness();
    const room = await prisma.room.create({ data: { name: 'Audit Item1', isPersistent: true } });
    roomId = room.id;
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { name: 'Audit Item1' } }).catch(() => {});
    await h.app.close();
  });

  it('edit nao transmite prevContent; delete zera prevContent; historico e REST ocultam apagada', async () => {
    const alice = await connect(h.port, { guestName: 'Alice' });
    const bob = await connect(h.port, { guestName: 'Bob' });
    try {
      expect((await emitAck(alice, 'join-room', { roomId })).success).toBe(true);
      expect((await emitAck(bob, 'join-room', { roomId })).success).toBe(true);

      const sent = await emitAck(alice, 'chat:message', { roomId, content: 'segredo original' });
      const messageId = sent.messageId as string;

      const editEvt = nextEvent<Ack>(bob, 'chat:edit');
      expect((await emitAck(alice, 'chat:edit', { roomId, messageId, content: 'versao nova' })).success).toBe(true);
      const edit = await editEvt;
      expect(edit).not.toHaveProperty('prevContent');
      expect(edit.edited).toBe(true);

      await prisma.chatFile.create({
        data: { roomId, messageId, filename: 'x.txt', mime: 'text/plain', size: 3, path: `uploads/${roomId}/x.txt` },
      });

      expect((await emitAck(alice, 'chat:delete', { roomId, messageId })).success).toBe(true);
      const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      expect(row?.prevContent).toBeNull();

      const carol = await connect(h.port, { guestName: 'Carol' });
      try {
        const join = await emitAck(carol, 'join-room', { roomId });
        const history = join.history as Array<Record<string, unknown>>;
        const deleted = history.find((m) => m.id === messageId);
        expect(deleted).toBeDefined();
        expect(deleted).not.toHaveProperty('prevContent');
        expect(deleted?.content).toBe('[mensagem apagada]');
        expect(deleted?.files).toEqual([]);
        expect(JSON.stringify(history)).not.toContain('segredo original');
        expect(JSON.stringify(history)).not.toContain('versao nova');
      } finally {
        carol.disconnect();
      }

      const rest = await h.app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages` });
      expect(rest.statusCode).toBe(200);
      const msg = (JSON.parse(rest.payload).messages as Array<Record<string, unknown>>).find(
        (m) => m.id === messageId,
      );
      expect(msg).not.toHaveProperty('prevContent');
      expect(msg?.content).toBe('[mensagem apagada]');
      expect(msg?.files).toEqual([]);
    } finally {
      alice.disconnect();
      bob.disconnect();
    }
  });

  it('mensagem editada (nao apagada) nao expoe prevContent na leitura REST', async () => {
    const msg = await prisma.chatMessage.create({
      data: { roomId, content: 'atual', prevContent: 'anterior', editedAt: new Date(), guestName: 'Alice' },
    });
    const rest = await h.app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages` });
    const found = (JSON.parse(rest.payload).messages as Array<Record<string, unknown>>).find((m) => m.id === msg.id);
    expect(found).not.toHaveProperty('prevContent');
    expect(found?.edited).toBe(true);
    expect(rest.payload).not.toContain('anterior');
  });
});

describe('item 2 — GET /api/files/:id de arquivo apagado responde 410 imediato', () => {
  let h: Harness;
  let roomId: string;

  beforeAll(async () => {
    h = await buildHarness();
    const room = await prisma.room.create({ data: { name: 'Audit Item2', isPersistent: true } });
    roomId = room.id;
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { name: 'Audit Item2' } }).catch(() => {});
    await h.app.close();
  });

  it('deletedAt de 1 minuto atras ja e 410', async () => {
    const msg = await prisma.chatMessage.create({ data: { roomId, content: 'f' } });
    const file = await prisma.chatFile.create({
      data: {
        roomId,
        messageId: msg.id,
        filename: 'a.txt',
        mime: 'text/plain',
        size: 3,
        path: `uploads/${roomId}/a.txt`,
        deletedAt: new Date(Date.now() - 60_000),
      },
    });
    const res = await h.app.inject({ method: 'GET', url: `/api/files/${file.id}` });
    expect(res.statusCode).toBe(410);
  });
});

describe('item 3 — balde de falhas de credencial de sala + credencial por header', () => {
  let h: Harness;
  let roomId: string;
  let fileId: string;
  const IP = '198.51.100.77';

  beforeAll(async () => {
    h = await buildHarness();
    const room = await prisma.room.create({
      data: { name: 'Audit Item3', isPersistent: true, passwordHash: bcrypt.hashSync('segredo123', 4) },
    });
    roomId = room.id;
    const msg = await prisma.chatMessage.create({ data: { roomId, content: 'oi' } });
    const file = await prisma.chatFile.create({
      data: { roomId, messageId: msg.id, filename: 'a.txt', mime: 'text/plain', size: 3, path: `uploads/${roomId}/a.txt` },
    });
    fileId = file.id;
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { name: 'Audit Item3' } }).catch(() => {});
    await h.app.close();
  });

  it('GET /messages: 10 senhas erradas → 403; 11ª → 429 com Retry-After (mesmo com senha certa)', async () => {
    resetRoomAuthFailures(IP, roomId);
    for (let i = 0; i < 10; i += 1) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/messages`,
        remoteAddress: IP,
        headers: { 'x-room-password': `errada-${i}xx` },
      });
      expect(res.statusCode).toBe(403);
    }
    const locked = await h.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages`,
      remoteAddress: IP,
      headers: { 'x-room-password': 'segredo123' },
    });
    expect(locked.statusCode).toBe(429);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    // GET /files/:id compartilha o balde da sala
    const fileLocked = await h.app.inject({ method: 'GET', url: `/api/files/${fileId}`, remoteAddress: IP });
    expect(fileLocked.statusCode).toBe(429);

    // outro IP nao e afetado
    const other = await h.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages`,
      remoteAddress: '198.51.100.78',
      headers: { 'x-room-password': 'segredo123' },
    });
    expect(other.statusCode).toBe(200);
    resetRoomAuthFailures(IP, roomId);
  });

  it('senha na query string NAO e mais aceita; header (percent-encoded) e', async () => {
    const viaQuery = await h.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages?password=segredo123`,
      remoteAddress: '198.51.100.79',
    });
    expect(viaQuery.statusCode).toBe(403);
    const viaHeader = await h.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages`,
      remoteAddress: '198.51.100.79',
      headers: { 'x-room-password': encodeURIComponent('segredo123') },
    });
    expect(viaHeader.statusCode).toBe(200);
    resetRoomAuthFailures('198.51.100.79', roomId);
  });

  it('join-room: 10 falhas → 11ª bloqueada mesmo com senha certa', async () => {
    resetRoomAuthFailures('127.0.0.1', roomId);
    const client = await connect(h.port, { guestName: 'Brute' });
    try {
      for (let i = 0; i < 10; i += 1) {
        const ack = await emitAck(client, 'join-room', { roomId, password: `errada-${i}xx` });
        expect(ack.error).toMatch(/Invalid invite token or password/);
      }
      const ack = await emitAck(client, 'join-room', { roomId, password: 'segredo123' });
      expect(ack.error).toMatch(/Too many failed/);
      expect(Number(ack.retryAfterSeconds)).toBeGreaterThan(0);
    } finally {
      client.disconnect();
      resetRoomAuthFailures('127.0.0.1', roomId);
      resetRoomAuthFailures('::ffff:127.0.0.1', roomId);
    }
  });

  it('logger: redactUrl remove password/inviteToken/token da query', () => {
    const out = redactUrl('/api/files/abc?password=s3gr3d0&inviteToken=uuid-x&token=jwt&limit=50');
    expect(out).not.toContain('s3gr3d0');
    expect(out).not.toContain('uuid-x');
    expect(out).not.toContain('jwt');
    expect(out).toContain('limit=50');
    expect(redactUrl('/api/health')).toBe('/api/health');
  });
});

describe('item 4 — guestName validado (zod) no handshake e no upload', () => {
  let h: Harness;
  let roomId: string;

  beforeAll(async () => {
    h = await buildHarness();
    const room = await prisma.room.create({ data: { name: 'Audit Item4', isPersistent: true } });
    roomId = room.id;
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { name: 'Audit Item4' } }).catch(() => {});
    await h.app.close();
  });

  it.each([
    ['controle', 'Eve\u0000\u0007'],
    ['bidi override', '‮admin'],
    ['longo demais', 'x'.repeat(41)],
    ['so espacos', '    '],
    ['nao-string', { evil: true }],
  ])('handshake com guestName invalido (%s) entra como Guest', async (_label, guestName) => {
    const watcher = await connect(h.port, { guestName: 'Watcher' });
    const evil = await connect(h.port, { guestName });
    try {
      await emitAck(watcher, 'join-room', { roomId });
      const joined = nextEvent<Record<string, unknown>>(watcher, 'room:peer-joined');
      await emitAck(evil, 'join-room', { roomId });
      const peer = await joined;
      expect(peer.name).toBe('Guest');
    } finally {
      evil.disconnect();
      watcher.disconnect();
    }
  });

  it('handshake com guestName valido e aparado (trim)', async () => {
    const watcher = await connect(h.port, { guestName: 'Watcher' });
    const ok = await connect(h.port, { guestName: '  Ana  ' });
    try {
      await emitAck(watcher, 'join-room', { roomId });
      const joined = nextEvent<Record<string, unknown>>(watcher, 'room:peer-joined');
      await emitAck(ok, 'join-room', { roomId });
      expect((await joined).name).toBe('Ana');
    } finally {
      ok.disconnect();
      watcher.disconnect();
    }
  });

  it('upload com guestName contendo controle grava Guest', async () => {
    const boundary = '----audit4';
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="guestName"\r\n\r\n‮admin\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`,
        'utf8',
      ),
      Buffer.from('ola\n'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/files`,
      payload,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect(res.statusCode).toBe(201);
    const msg = await prisma.chatMessage.findUnique({ where: { id: JSON.parse(res.payload).messageId } });
    expect(msg?.guestName).toBe('Guest');
  });
});

describe('item 5 — sinalizacao exige que o remetente esteja na sala', () => {
  let h: Harness;
  let roomA: string;
  let roomB: string;

  beforeAll(async () => {
    h = await buildHarness();
    roomA = (await prisma.room.create({ data: { name: 'Audit Item5', isPersistent: true } })).id;
    roomB = (await prisma.room.create({ data: { name: 'Audit Item5', isPersistent: true } })).id;
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { name: 'Audit Item5' } }).catch(() => {});
    await h.app.close();
  });

  it('socket fora da sala (ou em outra sala) nao sinaliza para peer da sala', async () => {
    const victim = await connect(h.port, { guestName: 'Victim' });
    const outsider = await connect(h.port, { guestName: 'Outsider' });
    const other = await connect(h.port, { guestName: 'Other' });
    try {
      await emitAck(victim, 'join-room', { roomId: roomA });
      await emitAck(other, 'join-room', { roomId: roomB });
      let received = 0;
      victim.on('signal:offer', () => (received += 1));
      victim.on('signal:answer', () => (received += 1));
      victim.on('signal:ice-candidate', () => (received += 1));
      victim.on('signal:screen-share-state', () => (received += 1));

      const target = victim.id as string;
      const payloads: Array<[string, Record<string, unknown>]> = [
        ['signal:offer', { roomId: roomA, targetPeerId: target, offer: { type: 'offer', sdp: 'x' } }],
        ['signal:answer', { roomId: roomA, targetPeerId: target, answer: { type: 'answer', sdp: 'x' } }],
        ['signal:ice-candidate', { roomId: roomA, targetPeerId: target, candidate: { candidate: 'c' } }],
        ['signal:screen-share-state', { roomId: roomA, targetPeerId: target, isScreenSharing: true }],
      ];
      for (const sender of [outsider, other]) {
        for (const [event, payload] of payloads) {
          const ack = await emitAck(sender, event, payload);
          expect(ack.error).toBe('Not in room');
        }
      }
      await new Promise((r) => setTimeout(r, 50));
      expect(received).toBe(0);

      // remetente na sala continua funcionando
      const member = await connect(h.port, { guestName: 'Member' });
      try {
        await emitAck(member, 'join-room', { roomId: roomA });
        const ack = await emitAck(member, 'signal:offer', payloads[0][1]);
        expect(ack.success).toBe(true);
      } finally {
        member.disconnect();
      }
    } finally {
      victim.disconnect();
      outsider.disconnect();
      other.disconnect();
    }
  });
});
