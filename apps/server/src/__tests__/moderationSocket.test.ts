/**
 * Socket: gate de partilha de tela no servidor, moderacao de chat (bloqueio e
 * aviso), denuncia e stop-share do dono, e `me:screen-share` apos mudar o
 * consentimento via REST.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Server as HttpServer } from 'http';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, Socket } from 'socket.io-client';
import { SCREEN_SHARE_CONSENT_VERSION } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { createSocketServer } from '../socket/handler.js';
import { authPlugin } from '../plugins/auth.js';
import { profileRoutes } from '../routes/profile.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetChatRateLimit, resetProfileUpdateRateLimit } from '../lib/rateLimit.js';
import { setModerationProviderForTests } from '../lib/moderation/index.js';

const TAG = `modsock-${Date.now()}`;

describe('socket moderacao e gate', () => {
  let app: Fastify.FastifyInstance;
  let httpServer: HttpServer;
  let port: number;
  let roomId: string;
  let ownerId = '';
  let ownerToken = '';
  let adultId = '';
  let adultToken = '';
  let teenId = '';
  let teenToken = '';
  const clients: Socket[] = [];

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.MODERATION_PROVIDER = 'heuristic';
    resetEnv();
    setModerationProviderForTests(undefined);

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(profileRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    httpServer = app.server;
    const addr = httpServer.address();
    if (addr && typeof addr === 'object') port = addr.port;
    const io = createSocketServer(httpServer);
    (app as unknown as Record<string, unknown>).io = io;

    const owner = await prisma.user.create({ data: { email: `${TAG}-owner@x.com`, passwordHash: 'x', name: 'Dona' } });
    ownerId = owner.id;
    ownerToken = signToken({ userId: ownerId, email: owner.email, name: 'Dona' });
    const adult = await prisma.user.create({
      data: {
        email: `${TAG}-adult@x.com`, passwordHash: 'x', name: 'Adulto',
        birthDate: new Date('1990-01-01T00:00:00Z'), ageVerifiedAt: new Date(),
        screenShareConsentAt: new Date(), screenShareConsentVersion: SCREEN_SHARE_CONSENT_VERSION,
      },
    });
    adultId = adult.id;
    adultToken = signToken({ userId: adultId, email: adult.email, name: 'Adulto' });
    const teen = await prisma.user.create({
      data: { email: `${TAG}-teen@x.com`, passwordHash: 'x', name: 'Teen', birthDate: new Date('2012-01-01T00:00:00Z'), ageVerifiedAt: new Date() },
    });
    teenId = teen.id;
    teenToken = signToken({ userId: teenId, email: teen.email, name: 'Teen' });

    const room = await prisma.room.create({ data: { name: TAG, isPersistent: true, ownerId } });
    roomId = room.id;
  });

  beforeEach(() => {
    while (clients.length) clients.pop()?.disconnect();
  });

  afterAll(async () => {
    while (clients.length) clients.pop()?.disconnect();
    await prisma.moderationEvent.deleteMany({ where: { roomId } });
    await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
    await app?.close();
  });

  function connect(opts: { guestName?: string; token?: string }): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        auth: { guestName: opts.guestName ?? 'Convidado', token: opts.token },
        transports: ['websocket'],
      });
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

  function noEvent(client: Socket, event: string, ms = 300): Promise<void> {
    return new Promise((resolve, reject) => {
      const handler = () => reject(new Error(`unexpected ${event}`));
      client.once(event, handler);
      setTimeout(() => { client.off(event, handler); resolve(); }, ms);
    });
  }

  async function join(client: Socket) {
    const ack = await emit<{ success?: boolean; error?: string }>(client, 'join-room', { roomId });
    expect(ack.success, ack.error).toBe(true);
    resetChatRateLimit(`chat:${client.id}`);
    return ack;
  }

  it('convidado nao liga a partilha de tela (reason guest); desligar passa', async () => {
    const guest = await connect({ guestName: 'Visita' });
    const other = await connect({ token: adultToken });
    await join(guest);
    await join(other);
    const on = await emit(guest, 'signal:screen-share-state', { roomId, targetPeerId: other.id, isScreenSharing: true });
    expect(on).toEqual({ error: 'Partilha de tela nao liberada', code: 'SCREEN_SHARE_NOT_ALLOWED', reason: 'guest' });
    const off = await emit(guest, 'signal:screen-share-state', { roomId, targetPeerId: other.id, isScreenSharing: false });
    expect(off).toEqual({ success: true });
  });

  it('logado menor -> reason age; adulto sem termo -> consent; adulto com termo -> repassa', async () => {
    const teen = await connect({ token: teenToken });
    const owner = await connect({ token: ownerToken });
    const adult = await connect({ token: adultToken });
    await join(teen);
    await join(owner);
    await join(adult);

    expect(await emit(teen, 'signal:screen-share-state', { roomId, targetPeerId: adult.id, isScreenSharing: true })).toMatchObject({
      code: 'SCREEN_SHARE_NOT_ALLOWED', reason: 'age',
    });
    // Dona ainda nao informou a idade: reason age. Adulto sem termo: consent.
    expect(await emit(owner, 'signal:screen-share-state', { roomId, targetPeerId: adult.id, isScreenSharing: true })).toMatchObject({
      code: 'SCREEN_SHARE_NOT_ALLOWED', reason: 'age',
    });
    await prisma.user.update({ where: { id: adultId }, data: { screenShareConsentVersion: 'antiga' } });
    const adult2 = await connect({ token: adultToken });
    await join(adult2);
    expect(await emit(adult2, 'signal:screen-share-state', { roomId, targetPeerId: owner.id, isScreenSharing: true })).toMatchObject({
      code: 'SCREEN_SHARE_NOT_ALLOWED', reason: 'consent',
    });
    await prisma.user.update({ where: { id: adultId }, data: { screenShareConsentVersion: SCREEN_SHARE_CONSENT_VERSION } });

    const received = nextEvent<{ fromPeerId: string; isScreenSharing: boolean }>(owner, 'signal:screen-share-state');
    expect(await emit(adult, 'signal:screen-share-state', { roomId, targetPeerId: owner.id, isScreenSharing: true })).toEqual({ success: true });
    expect(await received).toEqual({ fromPeerId: adult.id, isScreenSharing: true });
  });

  it('PUT consentimento via REST emite me:screen-share e libera o socket ja conectado', async () => {
    resetProfileUpdateRateLimit(ownerId);
    const owner = await connect({ token: ownerToken });
    const adult = await connect({ token: adultToken });
    await join(owner);
    await join(adult);

    const ageEvent = nextEvent<{ allowed: boolean; reason: string }>(owner, 'me:screen-share');
    await app.inject({ method: 'PUT', url: '/api/me/age', headers: { cookie: `token=${ownerToken}` }, payload: { birthDate: '1985-03-03' } });
    expect(await ageEvent).toMatchObject({ allowed: false, reason: 'consent' });
    const gateEvent = nextEvent<{ allowed: boolean; reason: string }>(owner, 'me:screen-share');
    const res = await app.inject({
      method: 'PUT', url: '/api/me/screen-share-consent', headers: { cookie: `token=${ownerToken}` },
      payload: { version: SCREEN_SHARE_CONSENT_VERSION },
    });
    expect(res.statusCode).toBe(200);
    expect(await gateEvent).toMatchObject({ allowed: true, reason: 'ok' });
    expect(await emit(owner, 'signal:screen-share-state', { roomId, targetPeerId: adult.id, isScreenSharing: true })).toEqual({ success: true });

    // Revogar fecha de novo, sem reconectar.
    const revoked = nextEvent<{ allowed: boolean }>(owner, 'me:screen-share');
    await app.inject({ method: 'DELETE', url: '/api/me/screen-share-consent', headers: { cookie: `token=${ownerToken}` } });
    expect((await revoked).allowed).toBe(false);
    expect(await emit(owner, 'signal:screen-share-state', { roomId, targetPeerId: adult.id, isScreenSharing: true })).toMatchObject({ reason: 'consent' });
  });

  it('chat:message: high bloqueia com MODERATED e grava evento; medium entrega e avisa so o autor', async () => {
    const a = await connect({ token: adultToken });
    const b = await connect({ guestName: 'Bia' });
    await join(a);
    await join(b);

    const blocked = await emit<{ error?: string; code?: string; category?: string }>(a, 'chat:message', { roomId, content: '@Bia vai se matar' });
    expect(blocked).toEqual({ error: 'Mensagem bloqueada pela moderacao', code: 'MODERATED', category: 'bullying' });
    await new Promise((r) => setTimeout(r, 50));
    const ev = await prisma.moderationEvent.findFirst({ where: { roomId, userId: adultId, action: 'blocked' } });
    expect(ev).toMatchObject({ kind: 'text', source: 'chat', category: 'bullying', severity: 'high' });
    expect(ev?.excerpt?.length ?? 0).toBeLessThanOrEqual(120);

    const warning = nextEvent<{ roomId: string; category: string; text: string }>(a, 'moderation:warning');
    const bNoWarning = noEvent(b, 'moderation:warning');
    const bGets = nextEvent<{ content: string }>(b, 'chat:message');
    const ok = await emit<{ success?: boolean }>(a, 'chat:message', { roomId, content: 'que idiota' });
    expect(ok.success).toBe(true);
    expect((await bGets).content).toBe('que idiota');
    expect(await warning).toMatchObject({ roomId, category: 'bullying' });
    await bNoWarning;

    const clean = await emit<{ success?: boolean }>(a, 'chat:message', { roomId, content: 'oi pessoal' });
    expect(clean.success).toBe(true);
  });

  it('chat:edit tambem passa pela moderacao', async () => {
    const a = await connect({ token: adultToken });
    await join(a);
    const sent = await emit<{ messageId: string }>(a, 'chat:message', { roomId, content: 'mensagem normal' });
    const edit = await emit<{ code?: string }>(a, 'chat:edit', { roomId, messageId: sent.messageId, content: 'seu macaco' });
    expect(edit.code).toBe('MODERATED');
    const row = await prisma.chatMessage.findUnique({ where: { id: sent.messageId } });
    expect(row?.content).toBe('mensagem normal');
  });

  it('moderation:report grava evento e avisa o dono na sala; nao o proprio alvo', async () => {
    const owner = await connect({ token: ownerToken });
    const reporter = await connect({ guestName: 'Rep' });
    const target = await connect({ token: adultToken });
    await join(owner);
    await join(reporter);
    await join(target);

    expect(await emit(reporter, 'moderation:report', { roomId, targetPeerId: reporter.id, reason: 'other' })).toEqual({ error: 'Cannot report yourself' });

    const notice = nextEvent<{ roomId: string; peerId: string; kind: string; category: string }>(owner, 'moderation:notice');
    const targetSilent = noEvent(target, 'moderation:notice');
    const ack = await emit(reporter, 'moderation:report', { roomId, targetPeerId: target.id, reason: 'hate', details: 'xingou todo mundo' });
    expect(ack).toEqual({ success: true });
    expect(await notice).toEqual({ roomId, peerId: target.id, kind: 'report', category: 'hate' });
    await targetSilent;
    const ev = await prisma.moderationEvent.findFirst({ where: { roomId, kind: 'report', userId: adultId } });
    expect(ev).toMatchObject({ source: 'user', category: 'hate', action: 'reported', excerpt: 'xingou todo mundo', reporterId: null });
  });

  it('moderation:stop-share: so o dono; alvo recebe moderation:action by owner', async () => {
    const owner = await connect({ token: ownerToken });
    const other = await connect({ token: adultToken });
    const guest = await connect({ guestName: 'G' });
    await join(owner);
    await join(other);
    await join(guest);

    expect(await emit(other, 'moderation:stop-share', { roomId, targetPeerId: guest.id })).toEqual({ error: 'Not room owner', code: 'NOT_OWNER' });
    expect(await emit(guest, 'moderation:stop-share', { roomId, targetPeerId: other.id })).toEqual({ error: 'Not room owner', code: 'NOT_OWNER' });

    const action = nextEvent<Record<string, unknown>>(other, 'moderation:action');
    expect(await emit(owner, 'moderation:stop-share', { roomId, targetPeerId: other.id })).toEqual({ success: true });
    expect(await action).toEqual({ roomId, action: 'stop-screen-share', category: 'none', by: 'owner' });
    expect(await emit(owner, 'moderation:stop-share', { roomId, targetPeerId: 'nao-existe' })).toEqual({ error: 'Target peer not in room' });
  });
});
