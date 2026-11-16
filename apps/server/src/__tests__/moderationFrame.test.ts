/**
 * POST /api/rooms/:roomId/moderation/frame (amostra JPEG da tela), GET
 * /api/moderation/config e a retencao (sweep) de ModerationEvent.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Server as HttpServer } from 'http';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { io as ioClient, Socket } from 'socket.io-client';
import { MODERATION_FRAME_MAX_BYTES } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { createSocketServer } from '../socket/handler.js';
import { authPlugin } from '../plugins/auth.js';
import { moderationRoutes, isJpeg } from '../routes/moderation.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetModerationFrameRateLimit } from '../lib/rateLimit.js';
import { setModerationProviderForTests, sweepModerationEvents, type ModerationVerdict } from '../lib/moderation/index.js';
import { signRoomTicket } from '../lib/roomTicket.js';
import { sweepExpiredRooms } from '../lib/roomDeletion.js';

const TAG = `modframe-${Date.now()}`;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

function frameBody(content: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----scale${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="frame"; filename="f.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('frame de moderacao', () => {
  let app: Fastify.FastifyInstance;
  let httpServer: HttpServer;
  let port: number;
  let roomId: string;
  let ownerId = '';
  let ownerToken = '';
  let sharerId = '';
  let sharerToken = '';
  const clients: Socket[] = [];
  const classifyImage = vi.fn<(jpeg: Buffer) => Promise<ModerationVerdict>>();

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.MODERATION_PROVIDER = 'claude';
    process.env.ANTHROPIC_API_KEY = 'sk-test-nunca-usada';
    process.env.MODERATION_SCREEN = 'true';
    resetEnv();
    setModerationProviderForTests({ name: 'claude', classifyText: async () => { throw new Error('nao usar'); }, classifyImage });

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
    await app.register(moderationRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    httpServer = app.server;
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
    (app as unknown as Record<string, unknown>).io = createSocketServer(httpServer);

    const owner = await prisma.user.create({ data: { email: `${TAG}-owner@x.com`, passwordHash: 'x', name: 'Dona' } });
    ownerId = owner.id;
    ownerToken = signToken({ userId: ownerId, email: owner.email, name: 'Dona' });
    const sharer = await prisma.user.create({ data: { email: `${TAG}-sharer@x.com`, passwordHash: 'x', name: 'Sharer' } });
    sharerId = sharer.id;
    sharerToken = signToken({ userId: sharerId, email: sharer.email, name: 'Sharer' });
    const room = await prisma.room.create({ data: { name: TAG, isPersistent: true, ownerId } });
    roomId = room.id;
  });

  beforeEach(() => {
    classifyImage.mockReset();
    resetModerationFrameRateLimit(`u:${sharerId}`);
    resetModerationFrameRateLimit(`u:${ownerId}`);
    while (clients.length) clients.pop()?.disconnect();
  });

  afterAll(async () => {
    while (clients.length) clients.pop()?.disconnect();
    setModerationProviderForTests(undefined);
    delete process.env.MODERATION_SCREEN;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.MODERATION_PROVIDER = 'heuristic';
    resetEnv();
    await prisma.moderationEvent.deleteMany({ where: { roomId } });
    await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
    await app?.close();
  });

  function connect(token: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, { auth: { token }, transports: ['websocket'] });
      clients.push(client);
      client.on('connect', () => resolve(client));
      client.on('connect_error', reject);
    });
  }
  function emit<T = Record<string, unknown>>(client: Socket, event: string, payload: unknown): Promise<T> {
    return new Promise((resolve) => client.emit(event, payload, (resp: T) => resolve(resp)));
  }
  function nextEvent<T>(client: Socket, event: string, timeoutMs = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), timeoutMs);
      client.once(event, (data: T) => { clearTimeout(timer); resolve(data); });
    });
  }

  function post(content: Buffer, headers: Record<string, string>) {
    const body = frameBody(content);
    return app.inject({ method: 'POST', url: `/api/rooms/${roomId}/moderation/frame`, headers: { ...headers, ...body.headers }, payload: body.payload });
  }
  const sharerHeaders = (): Record<string, string> => ({ cookie: `token=${sharerToken}`, 'x-room-ticket': signRoomTicket(roomId, `u:${sharerId}`) });

  it('isJpeg', () => {
    expect(isJpeg(JPEG)).toBe(true);
    expect(isJpeg(Buffer.from('89504E47', 'hex'))).toBe(false);
  });

  it('GET /api/moderation/config e publico e nao vaza a chave', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/moderation/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ provider: 'claude', screen: true, minAge: 18, consentVersion: '2026-11', frameIntervalSec: 20 });
    expect(res.body).not.toContain('sk-test');
  });

  it('sem sessao 401; logado sem ticket 403; convidado com ticket g: 401', async () => {
    expect((await post(JPEG, {})).statusCode).toBe(401);
    expect((await post(JPEG, { cookie: `token=${sharerToken}` })).statusCode).toBe(403);
    expect((await post(JPEG, { 'x-room-ticket': signRoomTicket(roomId, 'g:abc') })).statusCode).toBe(401);
    expect(classifyImage).not.toHaveBeenCalled();
  });

  it('frame acima de 200 KB -> 413; nao JPEG -> 400', async () => {
    expect((await post(Buffer.alloc(MODERATION_FRAME_MAX_BYTES + 1, 0xff), sharerHeaders())).statusCode).toBe(413);
    expect((await post(Buffer.from('89504E470D0A1A0A', 'hex'), sharerHeaders())).statusCode).toBe(400);
    expect(classifyImage).not.toHaveBeenCalled();
  });

  it('veredito high -> 204, moderation:action ao sharer e moderation:notice ao dono; frame nao persiste', async () => {
    const owner = await connect(ownerToken);
    const sharer = await connect(sharerToken);
    expect((await emit<{ success?: boolean }>(owner, 'join-room', { roomId })).success).toBe(true);
    expect((await emit<{ success?: boolean }>(sharer, 'join-room', { roomId })).success).toBe(true);

    classifyImage.mockResolvedValue({ flagged: true, category: 'sexual', severity: 'high', reason: 'nudez' });
    const action = nextEvent<Record<string, unknown>>(sharer, 'moderation:action');
    const notice = nextEvent<Record<string, unknown>>(owner, 'moderation:notice');
    const res = await post(JPEG, sharerHeaders());
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(classifyImage).toHaveBeenCalledTimes(1);
    expect(await action).toEqual({ roomId, action: 'stop-screen-share', category: 'sexual', by: 'assistant' });
    expect(await notice).toEqual({ roomId, peerId: sharer.id, kind: 'frame', category: 'sexual' });
    await new Promise((r) => setTimeout(r, 50));
    const ev = await prisma.moderationEvent.findFirst({ where: { roomId, kind: 'frame', userId: sharerId } });
    expect(ev).toMatchObject({ source: 'screen', category: 'sexual', severity: 'high', action: 'stopped-share', excerpt: null });
  });

  it('veredito medium -> so moderation:warning ao sharer', async () => {
    const sharer = await connect(sharerToken);
    await emit(sharer, 'join-room', { roomId });
    classifyImage.mockResolvedValue({ flagged: true, category: 'violence', severity: 'medium', reason: 'x' });
    const warning = nextEvent<Record<string, unknown>>(sharer, 'moderation:warning');
    expect((await post(JPEG, sharerHeaders())).statusCode).toBe(204);
    expect(await warning).toMatchObject({ roomId, category: 'violence' });
  });

  it('balde moderationFrame: 7a amostra no minuto -> 429', async () => {
    classifyImage.mockResolvedValue({ flagged: false, category: 'none', severity: 'low', reason: 'ok' });
    for (let i = 0; i < 6; i++) expect((await post(JPEG, sharerHeaders())).statusCode).toBe(204);
    const res = await post(JPEG, sharerHeaders());
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeTruthy();
  });

  it('MODERATION_SCREEN desligado -> 204 sem chamar o provedor', async () => {
    process.env.MODERATION_SCREEN = 'false';
    resetEnv();
    try {
      expect((await post(JPEG, sharerHeaders())).statusCode).toBe(204);
      expect(classifyImage).not.toHaveBeenCalled();
      expect((await app.inject({ method: 'GET', url: '/api/moderation/config' })).json().screen).toBe(false);
    } finally {
      process.env.MODERATION_SCREEN = 'true';
      resetEnv();
    }
  });
});

describe('retencao de ModerationEvent', () => {
  const DAY = 24 * 60 * 60 * 1000;
  afterAll(async () => {
    await prisma.moderationEvent.deleteMany({ where: { excerpt: { startsWith: 'retencao-' } } });
  });

  it('apaga eventos mais antigos que MODERATION_RETENTION_DAYS (default 90), inclusive pelo sweep de salas', async () => {
    const now = new Date();
    const old = await prisma.moderationEvent.create({
      data: { kind: 'text', source: 'chat', category: 'bullying', severity: 'medium', action: 'warned', excerpt: 'retencao-old', createdAt: new Date(now.getTime() - 91 * DAY) },
    });
    const recent = await prisma.moderationEvent.create({
      data: { kind: 'text', source: 'chat', category: 'bullying', severity: 'medium', action: 'warned', excerpt: 'retencao-recent', createdAt: new Date(now.getTime() - 89 * DAY) },
    });
    expect(await sweepModerationEvents({ now, retentionDays: 90 })).toBe(1);
    expect(await prisma.moderationEvent.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.moderationEvent.findUnique({ where: { id: recent.id } })).not.toBeNull();

    // Mesmo mecanismo do roomSweep: a varredura de salas chama a retencao.
    await sweepExpiredRooms({ io: undefined, activeRoomIds: new Set(), now: new Date(now.getTime() + 2 * DAY) });
    expect(await prisma.moderationEvent.findUnique({ where: { id: recent.id } })).toBeNull();
  });
});
