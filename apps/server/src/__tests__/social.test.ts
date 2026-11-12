/**
 * Amizades e mensagens privadas: @nome unico, pedido/aceite/recusa/remocao,
 * DM so entre amigos, aviso em tempo real na sala `user:<id>` e foto de amigo.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Server as HttpServer } from 'http';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { socialRoutes } from '../routes/social.js';
import { profileRoutes } from '../routes/profile.js';
import { createSocketServer } from '../socket/handler.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetDirectMessageRateLimit, resetFriendRequestRateLimit } from '../lib/rateLimit.js';

const stamp = Date.now().toString(36);
type Who = 'ana' | 'bia' | 'caio';
const EMAILS: Record<Who, string> = {
  ana: `social-ana-${stamp}@exemplo.com`,
  bia: `social-bia-${stamp}@exemplo.com`,
  caio: `social-caio-${stamp}@exemplo.com`,
};
const handle = (who: Who): string => `${who}_${stamp}`.slice(0, 20);

describe('amizades e mensagens privadas', () => {
  let app: FastifyInstance;
  let port = 0;
  const users = {} as Record<Who, { id: string; token: string }>;
  const sockets: Socket[] = [];

  const as = (who: Who): Record<string, string> => ({ cookie: `token=${users[who].token}` });

  function inject(who: Who | null, method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) {
    const opts: InjectOptions = { method, url, headers: who ? as(who) : {} };
    if (payload !== undefined) opts.payload = payload;
    return app.inject(opts);
  }

  async function friendsOf(who: Who) {
    return (await inject(who, 'GET', '/api/friends')).json() as {
      friends: Array<{ id: string; username: string }>;
      incoming: Array<{ id: string; user: { id: string } }>;
      outgoing: Array<{ id: string; user: { id: string } }>;
    };
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

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(profileRoutes);
    await app.register(socialRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const httpServer: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(httpServer);
    const addr = httpServer.address();
    port = addr && typeof addr === 'object' ? addr.port : 0;

    for (const who of Object.keys(EMAILS) as Who[]) {
      const u = await prisma.user.create({ data: { email: EMAILS[who], passwordHash: 'x', name: who.toUpperCase() } });
      users[who] = { id: u.id, token: signToken({ userId: u.id, email: EMAILS[who], name: who }) };
    }
  });

  beforeEach(() => {
    for (const who of Object.keys(EMAILS) as Who[]) {
      resetFriendRequestRateLimit(users[who].id);
      resetDirectMessageRateLimit(users[who].id);
    }
  });

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } }).catch(() => {});
    await app.close();
  });

  it('sem sessao -> 401', async () => {
    expect((await inject(null, 'GET', '/api/friends')).statusCode).toBe(401);
  });

  it('@nome: normaliza, valida e e unico', async () => {
    const res = await inject('ana', 'PUT', '/api/me/username', { username: `  @${handle('ana').toUpperCase()} ` });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.username).toBe(handle('ana'));

    expect((await inject('bia', 'PUT', '/api/me/username', { username: 'ab' })).statusCode).toBe(400);
    expect((await inject('bia', 'PUT', '/api/me/username', { username: 'com espaço' })).statusCode).toBe(400);
    expect((await inject('bia', 'PUT', '/api/me/username', { username: handle('ana') })).statusCode).toBe(409);

    expect((await inject('bia', 'PUT', '/api/me/username', { username: handle('bia') })).statusCode).toBe(200);
    expect((await inject('caio', 'PUT', '/api/me/username', { username: handle('caio') })).statusCode).toBe(200);
  });

  it('pedido: nome inexistente 404, a si mesmo 400, duplicado 409', async () => {
    expect((await inject('ana', 'POST', '/api/friends/requests', { username: 'naoexiste_xyz' })).statusCode).toBe(404);
    expect((await inject('ana', 'POST', '/api/friends/requests', { username: handle('ana') })).statusCode).toBe(400);
    expect((await inject('ana', 'POST', '/api/friends/requests', { username: handle('bia') })).statusCode).toBe(201);
    expect((await inject('ana', 'POST', '/api/friends/requests', { username: handle('bia') })).statusCode).toBe(409);

    const bia = await friendsOf('bia');
    expect(bia.incoming.map((r) => r.user.id)).toEqual([users.ana.id]);
    expect((await friendsOf('ana')).outgoing.map((r) => r.user.id)).toEqual([users.bia.id]);
    // DTO publico: sem e-mail.
    expect(JSON.stringify(bia)).not.toContain('@exemplo.com');
  });

  it('so o destinatario aceita; DM antes de aceitar e 403', async () => {
    const req = (await friendsOf('bia')).incoming[0];
    expect((await inject('ana', 'POST', `/api/friends/requests/${req.id}/accept`, {})).statusCode).toBe(404);
    expect((await inject('ana', 'POST', `/api/dm/${users.bia.id}/messages`, { content: 'oi' })).statusCode).toBe(403);

    expect((await inject('bia', 'POST', `/api/friends/requests/${req.id}/accept`, {})).statusCode).toBe(200);
    expect((await friendsOf('ana')).friends.map((f) => f.id)).toEqual([users.bia.id]);
  });

  it('pedido cruzado vira aceite direto', async () => {
    await inject('caio', 'POST', '/api/friends/requests', { username: handle('ana') });
    const res = await inject('ana', 'POST', '/api/friends/requests', { username: handle('caio') });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ACCEPTED');
    expect((await friendsOf('caio')).friends.map((f) => f.id)).toEqual([users.ana.id]);
  });

  it('DM: envia, chega em tempo real aos dois e aparece no historico', async () => {
    const anaSocket = await connect('ana');
    const biaSocket = await connect('bia');
    const caioSocket = await connect('caio');
    let caioGot = false;
    caioSocket.on('dm:message', () => {
      caioGot = true;
    });
    const biaGot = new Promise<{ content: string; senderId: string }>((r) => biaSocket.once('dm:message', r));
    const anaGot = new Promise<{ content: string }>((r) => anaSocket.once('dm:message', r));

    const res = await inject('ana', 'POST', `/api/dm/${users.bia.id}/messages`, { content: '  olá, Bia  ' });
    expect(res.statusCode).toBe(201);
    expect((await biaGot).content).toBe('olá, Bia');
    expect((await biaGot).senderId).toBe(users.ana.id);
    expect((await anaGot).content).toBe('olá, Bia');

    await inject('bia', 'POST', `/api/dm/${users.ana.id}/messages`, { content: 'oi, Ana' });
    const hist = (await inject('bia', 'GET', `/api/dm/${users.ana.id}/messages`)).json();
    expect(hist.messages.map((m: { content: string }) => m.content)).toEqual(['olá, Bia', 'oi, Ana']);
    expect(hist.hasMore).toBe(false);

    // Terceiro (amigo da Ana, nao da Bia) nao le a conversa nem recebe o evento.
    expect((await inject('caio', 'GET', `/api/dm/${users.bia.id}/messages`)).statusCode).toBe(403);
    expect(caioGot).toBe(false);
  });

  it('DM: moderacao bloqueia ofensa grave (422 MODERATED) sem gravar; medium entrega e avisa so o autor', async () => {
    const before = await prisma.directMessage.count({ where: { senderId: users.ana.id } });
    const res = await inject('ana', 'POST', `/api/dm/${users.bia.id}/messages`, { content: '@Bia vai se matar' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'Mensagem bloqueada pela moderacao', code: 'MODERATED', category: 'bullying' });
    expect(await prisma.directMessage.count({ where: { senderId: users.ana.id } })).toBe(before);
    expect(await prisma.moderationEvent.findFirst({ where: { source: 'dm', userId: users.ana.id, action: 'blocked' } })).toBeTruthy();

    const anaSocket = await connect('ana');
    const warning = new Promise<{ category: string }>((r) => anaSocket.once('moderation:warning', r));
    const ok = await inject('ana', 'POST', `/api/dm/${users.bia.id}/messages`, { content: 'que idiota' });
    expect(ok.statusCode).toBe(201);
    expect((await warning).category).toBe('bullying');
    anaSocket.disconnect();
  });

  it('DM: recusa vazio e acima do limite', async () => {
    expect((await inject('ana', 'POST', `/api/dm/${users.bia.id}/messages`, { content: '   ' })).statusCode).toBe(400);
    expect((await inject('ana', 'POST', `/api/dm/${users.bia.id}/messages`, { content: 'a'.repeat(2001) })).statusCode).toBe(400);
  });

  it('DM: rate limit por usuario', async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await inject('ana', 'POST', `/api/dm/${users.bia.id}/messages`, { content: `m${i}` })).statusCode;
    }
    expect(last).toBe(429);
  });

  it('foto de amigo: amigo ve (404 sem foto), nao-amigo recebe 404 igual', async () => {
    expect((await inject('bia', 'GET', `/api/users/${users.ana.id}/avatar`)).statusCode).toBe(404);
    expect((await inject('caio', 'GET', `/api/users/${users.bia.id}/avatar`)).statusCode).toBe(404);
  });

  it('remover amizade corta a DM; recusar pedido apaga o pedido', async () => {
    expect((await inject('bia', 'DELETE', `/api/friends/${users.ana.id}`)).statusCode).toBe(200);
    expect((await inject('ana', 'POST', `/api/dm/${users.bia.id}/messages`, { content: 'oi?' })).statusCode).toBe(403);
    expect((await inject('ana', 'DELETE', `/api/friends/${users.bia.id}`)).statusCode).toBe(404);

    await inject('bia', 'POST', '/api/friends/requests', { username: handle('caio') });
    const req = (await friendsOf('caio')).incoming[0];
    expect((await inject('ana', 'DELETE', `/api/friends/requests/${req.id}`)).statusCode).toBe(404);
    expect((await inject('caio', 'DELETE', `/api/friends/requests/${req.id}`)).statusCode).toBe(200);
    expect((await friendsOf('bia')).outgoing).toEqual([]);
  });
});
