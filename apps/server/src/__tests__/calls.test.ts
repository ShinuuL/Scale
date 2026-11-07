/**
 * Ligacao entre amigos: so amigo liga, quem recebe e avisado na sala
 * `user:<id>`, e atender/recusar/cancelar encerra o toque dos dois lados.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server as HttpServer } from 'http';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { callRoutes, resetPendingCalls } from '../routes/calls.js';
import { createSocketServer } from '../socket/handler.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetCallRateLimit } from '../lib/rateLimit.js';

const stamp = Date.now().toString(36);
type Who = 'ana' | 'bia' | 'caio';
const EMAILS: Record<Who, string> = {
  ana: `call-ana-${stamp}@exemplo.com`,
  bia: `call-bia-${stamp}@exemplo.com`,
  caio: `call-caio-${stamp}@exemplo.com`,
};

describe('ligacao entre amigos', () => {
  let app: FastifyInstance;
  let port = 0;
  const users = {} as Record<Who, { id: string; token: string }>;
  const sockets: Socket[] = [];

  function inject(who: Who, method: 'GET' | 'POST', url: string, payload?: object) {
    const opts: InjectOptions = { method, url, headers: { cookie: `token=${users[who].token}` } };
    if (payload !== undefined) opts.payload = payload;
    return app.inject(opts);
  }

  function connect(who: Who): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = ioClient(`http://127.0.0.1:${port}`, {
        transports: ['websocket'],
        extraHeaders: { cookie: `token=${users[who].token}` },
      });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });
  }

  function next<T>(s: Socket, event: string): Promise<T> {
    return new Promise((resolve) => s.once(event, (data: T) => resolve(data)));
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(callRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const httpServer: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(httpServer);
    const addr = httpServer.address();
    port = addr && typeof addr === 'object' ? addr.port : 0;

    for (const who of Object.keys(EMAILS) as Who[]) {
      const u = await prisma.user.create({ data: { email: EMAILS[who], passwordHash: 'x', name: who.toUpperCase() } });
      users[who] = { id: u.id, token: signToken({ userId: u.id, email: EMAILS[who], name: who }) };
    }
    // ana e bia sao amigas; caio nao e amigo de ninguem.
    await prisma.friendship.create({
      data: { requesterId: users.ana.id, addresseeId: users.bia.id, status: 'ACCEPTED' },
    });
  });

  beforeEach(() => {
    resetPendingCalls();
    for (const who of Object.keys(EMAILS) as Who[]) resetCallRateLimit(users[who].id);
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    resetPendingCalls();
    const ids = Object.values(users).map((u) => u.id);
    await prisma.room.deleteMany({ where: { ownerId: { in: ids } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await app.close();
  });

  it('so amigo pode ligar', async () => {
    const res = await inject('caio', 'POST', '/api/calls', { friendId: users.ana.id });
    expect(res.statusCode).toBe(403);
    const self = await inject('ana', 'POST', '/api/calls', { friendId: users.ana.id });
    expect(self.statusCode).toBe(400);
  });

  it('a chamada toca para o amigo com o convite e cria a sala privada', async () => {
    const bia = await connect('bia');
    const ringing = next<{ callId: string; roomId: string; inviteToken: string; peer: { id: string } }>(bia, 'call:incoming');

    const res = await inject('ana', 'POST', '/api/calls', { friendId: users.bia.id });
    expect(res.statusCode).toBe(201);
    const { callId, roomId } = res.json();

    const invite = await ringing;
    expect(invite.callId).toBe(callId);
    expect(invite.peer.id).toBe(users.ana.id);
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    expect(room?.isPrivate).toBe(true);
    expect(room?.ownerId).toBe(users.ana.id);
    expect(invite.inviteToken).toBe(room?.inviteToken);

    // Quem liga ve a chamada saindo, sem o convite.
    const active = (await inject('ana', 'GET', '/api/calls')).json();
    expect(active.outgoing).toHaveLength(1);
    expect(active.outgoing[0].inviteToken).toBeUndefined();
    expect((await inject('bia', 'GET', '/api/calls')).json().incoming).toHaveLength(1);
  });

  it('atender devolve o convite e encerra o toque para quem ligou', async () => {
    const ana = await connect('ana');
    const { callId, roomId } = (await inject('ana', 'POST', '/api/calls', { friendId: users.bia.id })).json();
    const ended = next<{ callId: string; reason: string }>(ana, 'call:ended');

    // Quem ligou nao pode "atender" a propria chamada.
    expect((await inject('ana', 'POST', `/api/calls/${callId}/accept`)).statusCode).toBe(404);

    const res = await inject('bia', 'POST', `/api/calls/${callId}/accept`);
    expect(res.statusCode).toBe(200);
    expect(res.json().roomId).toBe(roomId);
    expect(await ended).toEqual({ callId, reason: 'accepted' });
    expect((await inject('bia', 'GET', '/api/calls')).json().incoming).toHaveLength(0);
  });

  it('recusar avisa quem ligou', async () => {
    const ana = await connect('ana');
    const { callId } = (await inject('ana', 'POST', '/api/calls', { friendId: users.bia.id })).json();
    const ended = next<{ reason: string }>(ana, 'call:ended');
    expect((await inject('bia', 'POST', `/api/calls/${callId}/decline`)).statusCode).toBe(200);
    expect((await ended).reason).toBe('declined');
  });

  it('cancelar para o toque de quem recebe', async () => {
    const bia = await connect('bia');
    const { callId } = (await inject('ana', 'POST', '/api/calls', { friendId: users.bia.id })).json();
    const ended = next<{ reason: string }>(bia, 'call:ended');
    // Quem recebe nao cancela; so quem ligou.
    expect((await inject('bia', 'POST', `/api/calls/${callId}/cancel`)).statusCode).toBe(404);
    expect((await inject('ana', 'POST', `/api/calls/${callId}/cancel`)).statusCode).toBe(200);
    expect((await ended).reason).toBe('cancelled');
  });

  it('ligar de novo substitui o toque anterior', async () => {
    const first = (await inject('ana', 'POST', '/api/calls', { friendId: users.bia.id })).json();
    const second = (await inject('ana', 'POST', '/api/calls', { friendId: users.bia.id })).json();
    const incoming = (await inject('bia', 'GET', '/api/calls')).json().incoming;
    expect(incoming.map((c: { callId: string }) => c.callId)).toEqual([second.callId]);
    expect(first.callId).not.toBe(second.callId);
  });
});
