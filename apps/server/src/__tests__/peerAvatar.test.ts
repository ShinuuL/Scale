/**
 * Foto de participante da chamada: GET /api/rooms/:roomId/peers/:peerId/avatar.
 * So quem participa da sala (room ticket ou dono) ve, e so a foto de um peer
 * que esta NELA agora. Convidado, peer de outra sala, peer que saiu e usuario
 * sem foto respondem o mesmo 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Server as HttpServer } from 'http';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { socialRoutes } from '../routes/social.js';
import { AVATARS_ROOT } from '../routes/profile.js';
import { createSocketServer } from '../socket/handler.js';
import { resetRateLimit } from '../lib/rateLimit.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { guestParticipantHeaders } from './helpers/participation.js';

const STAMP = Date.now();
const ROOM_NAME = `PeerAvatar ${STAMP}`;
const PNG = Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), Buffer.alloc(32)]);

describe('foto de participante da chamada', () => {
  let app: FastifyInstance;
  let port = 0;
  let roomId = '';
  let otherRoomId = '';
  let withPhotoId = '';
  let noPhotoId = '';
  const avatarFile = path.join(AVATARS_ROOT, `peer-avatar-test-${STAMP}.png`);
  const clients: Socket[] = [];

  function connect(auth: Record<string, string>): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const c = ioClient(`http://127.0.0.1:${port}`, { auth, transports: ['websocket'] });
      clients.push(c);
      c.on('connect', () => resolve(c));
      c.on('connect_error', reject);
    });
  }

  function join(c: Socket, id: string): Promise<Record<string, unknown>> {
    resetRateLimit(`socket:${c.id}`);
    return new Promise((resolve) => c.emit('join-room', { roomId: id }, resolve));
  }

  function getAvatar(rid: string, peerId: string, headers: Record<string, string> = {}) {
    return app.inject({ method: 'GET', url: `/api/rooms/${rid}/peers/${peerId}/avatar`, headers });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(socialRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const io = createSocketServer(app.server as HttpServer);
    (app as unknown as { io: unknown }).io = io;
    const addr = app.server.address();
    port = addr && typeof addr === 'object' ? addr.port : 0;

    await fs.mkdir(AVATARS_ROOT, { recursive: true });
    await fs.writeFile(avatarFile, PNG);
    const rel = path.relative(process.cwd(), avatarFile);
    withPhotoId = (
      await prisma.user.create({
        data: { email: `peer-foto-${STAMP}@exemplo.com`, passwordHash: 'x', name: 'Com Foto', avatarPath: rel, avatarMime: 'image/png' },
      })
    ).id;
    noPhotoId = (
      await prisma.user.create({ data: { email: `peer-sem-${STAMP}@exemplo.com`, passwordHash: 'x', name: 'Sem Foto' } })
    ).id;
    roomId = (await prisma.room.create({ data: { name: ROOM_NAME, isPersistent: true } })).id;
    otherRoomId = (await prisma.room.create({ data: { name: ROOM_NAME, isPersistent: true } })).id;
  });

  afterAll(async () => {
    clients.forEach((c) => c.disconnect());
    await prisma.room.deleteMany({ where: { name: ROOM_NAME } });
    await prisma.user.deleteMany({ where: { id: { in: [withPhotoId, noPhotoId] } } });
    await fs.unlink(avatarFile).catch(() => {});
    await app.close();
  });

  it('participante ve a foto do peer logado que esta na sala; fora da sala, 403', async () => {
    const peer = await connect({ token: signToken({ userId: withPhotoId, email: 'a@a', name: 'Com Foto' }) });
    expect((await join(peer, roomId)).error).toBeUndefined();

    const ok = await getAvatar(roomId, peer.id!, guestParticipantHeaders(roomId));
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toBe('image/png');
    expect(ok.headers['cache-control']).toBe('private, max-age=300');
    expect(ok.rawPayload.equals(PNG)).toBe(true);

    // Sem prova de participacao: 403, mesmo sabendo o peerId.
    expect((await getAvatar(roomId, peer.id!)).statusCode).toBe(403);
    // Ticket de OUTRA sala nao serve.
    expect((await getAvatar(roomId, peer.id!, guestParticipantHeaders(otherRoomId))).statusCode).toBe(403);
    // Peer existe, mas nao nesta sala: 404.
    expect((await getAvatar(otherRoomId, peer.id!, guestParticipantHeaders(otherRoomId))).statusCode).toBe(404);

    // Saiu da sala: a foto deixa de ser servida.
    peer.disconnect();
    await new Promise((r) => setTimeout(r, 100));
    expect((await getAvatar(roomId, peer.id!, guestParticipantHeaders(roomId))).statusCode).toBe(404);
  });

  it('convidado e usuario sem foto respondem 404', async () => {
    const guest = await connect({ guestName: 'Visitante' });
    const semFoto = await connect({ token: signToken({ userId: noPhotoId, email: 'b@b', name: 'Sem Foto' }) });
    await join(guest, roomId);
    await join(semFoto, roomId);
    const h = guestParticipantHeaders(roomId);
    expect((await getAvatar(roomId, guest.id!, h)).statusCode).toBe(404);
    expect((await getAvatar(roomId, semFoto.id!, h)).statusCode).toBe(404);
  });

  it('parametros invalidos: 404 sem consultar nada', async () => {
    expect((await getAvatar('nao-e-uuid', 'abc')).statusCode).toBe(404);
    expect((await getAvatar(roomId, 'a.b%20c')).statusCode).toBe(404);
  });
});
