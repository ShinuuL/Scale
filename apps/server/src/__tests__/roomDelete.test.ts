/**
 * Exclusao definitiva de sala (DELETE /api/rooms/:id): dono ou admin do
 * sistema (ADMIN_EMAILS ∪ METRICS_ADMIN_EMAILS legado). Tambem cobre o
 * `canDelete` exposto em GET /api/rooms(/:id) e o aviso `room:deleted`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Server as HttpServer } from 'http';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { roomRoutes } from '../routes/rooms.js';
import { messagesRoutes } from '../routes/messages.js';
import { filesRoutes } from '../routes/files.js';
import { metricsRoutes } from '../routes/metrics.js';
import { createSocketServer, getRoomPeersSnapshot } from '../socket/handler.js';
import { resetRateLimit, resetRoomDeleteRateLimit } from '../lib/rateLimit.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { UPLOADS_ROOT } from '../lib/uploads.js';
import { guestParticipantHeaders } from './helpers/participation.js';

const ROOM_NAME = 'Room Delete Test';
const stamp = Date.now();
const OWNER_EMAIL = `del-owner-${stamp}@exemplo.com`;
const OTHER_EMAIL = `del-other-${stamp}@exemplo.com`;
const ADMIN_EMAIL = `del-admin-${stamp}@exemplo.com`;
const LEGACY_ADMIN_EMAIL = `del-legacy-${stamp}@exemplo.com`;

type Ack = Record<string, unknown>;

describe('DELETE /api/rooms/:id (dono ou admin do sistema)', () => {
  let app: FastifyInstance;
  let port: number;
  const users: Record<'owner' | 'other' | 'admin' | 'legacy', { id: string; token: string }> = {
    owner: { id: '', token: '' },
    other: { id: '', token: '' },
    admin: { id: '', token: '' },
    legacy: { id: '', token: '' },
  };
  const sockets: Socket[] = [];

  function auth(who: keyof typeof users): Record<string, string> {
    return { cookie: `token=${users[who].token}` };
  }

  async function createRoom(isPersistent = true): Promise<string> {
    const room = await prisma.room.create({
      data: { name: ROOM_NAME, isPersistent, ownerId: users.owner.id },
    });
    return room.id;
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.ADMIN_EMAILS = ` ${ADMIN_EMAIL.toUpperCase()} `;
    process.env.METRICS_ADMIN_EMAILS = LEGACY_ADMIN_EMAIL;
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
    await app.register(roomRoutes);
    await app.register(messagesRoutes);
    await app.register(filesRoutes);
    await app.register(metricsRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const httpServer: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(httpServer);
    const addr = httpServer.address();
    port = addr && typeof addr === 'object' ? addr.port : 0;

    const emails = { owner: OWNER_EMAIL, other: OTHER_EMAIL, admin: ADMIN_EMAIL, legacy: LEGACY_ADMIN_EMAIL };
    for (const [key, email] of Object.entries(emails) as Array<[keyof typeof users, string]>) {
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: key } });
      users[key] = { id: user.id, token: signToken({ userId: user.id, email, name: key }) };
    }
  });

  beforeEach(() => {
    for (const key of Object.keys(users) as Array<keyof typeof users>) resetRoomDeleteRateLimit(users[key].id);
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    delete process.env.ADMIN_EMAILS;
    delete process.env.METRICS_ADMIN_EMAILS;
    await prisma.room.deleteMany({ where: { name: ROOM_NAME } }).catch(() => {});
    await prisma.user
      .deleteMany({ where: { email: { in: [OWNER_EMAIL, OTHER_EMAIL, ADMIN_EMAIL, LEGACY_ADMIN_EMAIL] } } })
      .catch(() => {});
    await app.close();
  });

  it('dono apaga → 200; sala, mensagens, arquivos (linhas e diretorio) somem', async () => {
    const roomId = await createRoom();
    const msg = await prisma.chatMessage.create({ data: { roomId, content: 'vai sumir' } });
    const dir = path.join(UPLOADS_ROOT, roomId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'x-a.txt'), 'ola');
    await prisma.chatFile.create({
      data: { roomId, messageId: msg.id, filename: 'a.txt', mime: 'text/plain', size: 3, path: `uploads/${roomId}/x-a.txt` },
    });
    await prisma.roomMember.create({ data: { roomId, userId: users.other.id } });

    const res = await app.inject({ method: 'DELETE', url: `/api/rooms/${roomId}`, headers: auth('owner') });
    expect(res.statusCode).toBe(200);
    expect(await prisma.room.findUnique({ where: { id: roomId } })).toBeNull();
    expect(await prisma.chatMessage.count({ where: { roomId } })).toBe(0);
    expect(await prisma.chatFile.count({ where: { roomId } })).toBe(0);
    expect(await prisma.roomMember.count({ where: { roomId } })).toBe(0);
    await expect(fs.stat(dir)).rejects.toThrow();
    // GET da sala apagada → 404
    expect((await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` })).statusCode).toBe(404);
  });

  it('admin via ADMIN_EMAILS apaga sala de outro → 200', async () => {
    const roomId = await createRoom();
    const res = await app.inject({ method: 'DELETE', url: `/api/rooms/${roomId}`, headers: auth('admin') });
    expect(res.statusCode).toBe(200);
    expect(await prisma.room.findUnique({ where: { id: roomId } })).toBeNull();
  });

  it('admin via METRICS_ADMIN_EMAILS (legado) tambem apaga → 200', async () => {
    const roomId = await createRoom();
    const res = await app.inject({ method: 'DELETE', url: `/api/rooms/${roomId}`, headers: auth('legacy') });
    expect(res.statusCode).toBe(200);
  });

  it('usuario comum → 403 e a sala continua', async () => {
    const roomId = await createRoom();
    const res = await app.inject({ method: 'DELETE', url: `/api/rooms/${roomId}`, headers: auth('other') });
    expect(res.statusCode).toBe(403);
    expect(await prisma.room.findUnique({ where: { id: roomId } })).not.toBeNull();
  });

  it('sem login → 401; id invalido → 400; inexistente → 404', async () => {
    const roomId = await createRoom();
    expect((await app.inject({ method: 'DELETE', url: `/api/rooms/${roomId}` })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/rooms/nao-e-uuid', headers: auth('owner') })).statusCode,
    ).toBe(400);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/rooms/${randomUUID()}`, headers: auth('admin') })).statusCode,
    ).toBe(404);
  });

  it('rate limit: 21a exclusao em 10 min → 429', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({ method: 'DELETE', url: `/api/rooms/${randomUUID()}`, headers: auth('other') });
      expect(res.statusCode).toBe(404);
    }
    const res = await app.inject({ method: 'DELETE', url: `/api/rooms/${randomUUID()}`, headers: auth('other') });
    expect(res.statusCode).toBe(429);
  });

  it('peers conectados recebem room:deleted e saem da sala; ticket antigo nao le mais nada', async () => {
    const roomId = await createRoom();
    await prisma.chatMessage.create({ data: { roomId, content: 'historico' } });
    const headers = guestParticipantHeaders(roomId);
    expect((await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages`, headers })).statusCode).toBe(200);

    const client = await new Promise<Socket>((resolve, reject) => {
      const c = ioClient(`http://127.0.0.1:${port}`, {
        auth: { guestName: 'Convidado' },
        transports: ['websocket'],
      });
      c.on('connect', () => resolve(c));
      c.on('connect_error', reject);
    });
    sockets.push(client);
    resetRateLimit(`socket:${client.id}`);
    const ack = await new Promise<Ack>((resolve) => client.emit('join-room', { roomId }, resolve));
    expect(ack.error).toBeUndefined();
    expect(getRoomPeersSnapshot().get(roomId)).toBe(1);

    const deleted = new Promise<{ roomId: string }>((resolve) => client.once('room:deleted', resolve));
    const res = await app.inject({ method: 'DELETE', url: `/api/rooms/${roomId}`, headers: auth('owner') });
    expect(res.statusCode).toBe(200);
    expect(await deleted).toEqual({ roomId });
    expect(getRoomPeersSnapshot().has(roomId)).toBe(false);

    const after = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages`, headers });
    expect([403, 404]).toContain(after.statusCode);
    expect(after.payload).not.toContain('historico');
  });

  it('canDelete em GET /api/rooms/:id e GET /api/rooms, sem expor ownerId a terceiros', async () => {
    const roomId = await createRoom();
    const asOwner = (await app.inject({ method: 'GET', url: `/api/rooms/${roomId}`, headers: auth('owner') })).json();
    const asAdmin = (await app.inject({ method: 'GET', url: `/api/rooms/${roomId}`, headers: auth('admin') })).json();
    const asOther = (await app.inject({ method: 'GET', url: `/api/rooms/${roomId}`, headers: auth('other') })).json();
    const anon = (await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` })).json();
    expect(asOwner.room.canDelete).toBe(true);
    expect(asAdmin.room.canDelete).toBe(true);
    expect(asOther.room.canDelete).toBe(false);
    expect(anon.room.canDelete).toBe(false);
    expect(asAdmin.room.ownerId).toBeUndefined();
    expect(asOther.room.ownerId).toBeUndefined();

    const item = (who: keyof typeof users) =>
      app
        .inject({ method: 'GET', url: '/api/rooms', headers: auth(who) })
        .then((r) => (r.json().rooms as Array<Record<string, unknown>>).find((x) => x.id === roomId));
    const ownerItem = await item('owner');
    expect(ownerItem?.canDelete).toBe(true);
    expect((await item('admin'))?.canDelete).toBe(true);
    const otherItem = await item('other');
    expect(otherItem?.canDelete).toBe(false);
    expect(Object.keys(otherItem ?? {}).sort()).toEqual(
      ['canDelete', 'hasPassword', 'id', 'isPersistent', 'name', 'participantCount'].sort(),
    );
  });

  it('/api/metrics continua aceitando admin (novo e legado) e recusa comum', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/metrics', headers: auth('admin') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/metrics', headers: auth('legacy') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/metrics', headers: auth('other') })).statusCode).toBe(403);
  });
});
