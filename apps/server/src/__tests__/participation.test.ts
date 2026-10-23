/**
 * Participacao efetiva (room ticket) e guestId emitido pelo servidor.
 *
 *  1. Historico, download e upload exigem ter ENTRADO na sala (ticket do
 *     join-room) ou ser o dono — inclusive em sala publica sem senha.
 *  2. Autoria de convidado e o guestId do cookie assinado, nunca o guestName.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, createHmac } from 'node:crypto';
import type { Server as HttpServer } from 'http';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import jwt from 'jsonwebtoken';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { messagesRoutes } from '../routes/messages.js';
import { filesRoutes } from '../routes/files.js';
import { roomRoutes } from '../routes/rooms.js';
import { createSocketServer } from '../socket/handler.js';
import { resetRateLimit, resetChatRateLimit } from '../lib/rateLimit.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { signRoomTicket, verifyRoomTicket } from '../lib/roomTicket.js';
import { GUEST_COOKIE_NAME, getGuestCookieSecret, signGuestId, verifyGuestCookie } from '../lib/guestId.js';
import { guestCookie, guestParticipantHeaders } from './helpers/participation.js';

type Ack = Record<string, unknown>;

interface Harness {
  app: FastifyInstance;
  port: number;
}

const ROOM_NAME = 'Participation Test';

async function buildHarness(): Promise<Harness> {
  process.env.JWT_SECRET = 'test-secret-for-unit-tests';
  process.env.NODE_ENV = 'test';
  process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
  resetEnv();
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
  await app.register(roomRoutes);
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

function connect(port: number, opts: { guestName?: string; guestId?: string; rawCookie?: string; token?: string } = {}): Promise<Socket> {
  const cookieHeader = opts.rawCookie ?? (opts.guestId ? guestCookie(opts.guestId) : undefined);
  return new Promise((resolve, reject) => {
    const client = ioClient(`http://127.0.0.1:${port}`, {
      auth: opts.token ? { token: opts.token } : { guestName: opts.guestName ?? 'Convidado' },
      transports: ['websocket'],
      extraHeaders: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
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

function txtUpload(extraHeaders: Record<string, string> = {}, guestName?: string) {
  const boundary = '----participation';
  const nameField = guestName
    ? `--${boundary}\r\nContent-Disposition: form-data; name="guestName"\r\n\r\n${guestName}\r\n`
    : '';
  return {
    payload: Buffer.concat([
      Buffer.from(
        nameField +
          `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\n`,
      ),
      Buffer.from('ola\n'),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...extraHeaders },
  };
}

describe('participacao efetiva: historico, download e upload exigem room ticket (ou dono)', () => {
  let h: Harness;
  let roomId: string;
  let otherRoomId: string;
  let fileId: string;
  let ownerId: string;
  let ownerToken: string;

  beforeAll(async () => {
    h = await buildHarness();
    const owner = await prisma.user.create({
      data: { email: `part-owner-${Date.now()}@exemplo.com`, passwordHash: 'x', name: 'Dono' },
    });
    ownerId = owner.id;
    ownerToken = signToken({ userId: owner.id, email: owner.email, name: 'Dono' });
    // Sala PUBLICA sem senha: antes qualquer um com o id lia tudo.
    const room = await prisma.room.create({ data: { name: ROOM_NAME, isPersistent: true, ownerId } });
    roomId = room.id;
    otherRoomId = (await prisma.room.create({ data: { name: ROOM_NAME, isPersistent: true } })).id;
    const msg = await prisma.chatMessage.create({ data: { roomId, content: 'historico secreto' } });
    fileId = (
      await prisma.chatFile.create({
        data: { roomId, messageId: msg.id, filename: 'a.txt', mime: 'text/plain', size: 3, path: `uploads/${roomId}/nao-existe.txt` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { name: ROOM_NAME } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: ownerId } }).catch(() => {});
    await h.app.close();
  });

  it('sem ticket → 403 em /messages, /files/:id e upload, mesmo em sala publica sem senha', async () => {
    const anon = { cookie: guestCookie(randomUUID()) };
    const messages = await h.app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages`, headers: anon });
    expect(messages.statusCode).toBe(403);
    expect(messages.payload).not.toContain('historico secreto');
    const file = await h.app.inject({ method: 'GET', url: `/api/files/${fileId}`, headers: anon });
    expect(file.statusCode).toBe(403);
    const upload = await h.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/files`, ...txtUpload(anon) });
    expect(upload.statusCode).toBe(403);
  });

  it('ticket de outra sala → 403', async () => {
    const guestId = randomUUID();
    const headers = { cookie: guestCookie(guestId), 'x-room-ticket': signRoomTicket(otherRoomId, `g:${guestId}`) };
    expect((await h.app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages`, headers })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'GET', url: `/api/files/${fileId}`, headers })).statusCode).toBe(403);
    expect((await h.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/files`, ...txtUpload(headers) })).statusCode).toBe(403);
  });

  it('ticket expirado, adulterado, assinado com o segredo da sessao ou de outra identidade → 403', async () => {
    const guestId = randomUUID();
    const cookieHeader = guestCookie(guestId);
    const valid = signRoomTicket(roomId, `g:${guestId}`);
    const [head, body, sig] = valid.split('.');
    const forgedBody = Buffer.from(JSON.stringify({ roomId: otherRoomId, sub: `g:${guestId}` })).toString('base64url');
    const sessionSecret = jwt.sign({ roomId }, 'test-secret-for-unit-tests', {
      audience: 'scale:room-ticket',
      subject: `g:${guestId}`,
      expiresIn: 60,
    });
    const tickets = {
      expirado: signRoomTicket(roomId, `g:${guestId}`, -10),
      adulterado: `${head}.${forgedBody}.${sig}`,
      assinaturaTrocada: `${head}.${body}.${sig.slice(0, -4)}AAAA`,
      segredoDaSessao: sessionSecret,
      outraIdentidade: signRoomTicket(roomId, `g:${randomUUID()}`),
    };
    for (const [label, ticket] of Object.entries(tickets)) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/messages`,
        headers: { cookie: cookieHeader, 'x-room-ticket': ticket },
      });
      expect(res.statusCode, label).toBe(403);
    }
    // Ticket valido SEM o cookie da identidade (ticket vazado) tambem nao serve.
    const leaked = await h.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages`,
      headers: { 'x-room-ticket': valid },
    });
    expect(leaked.statusCode).toBe(403);
  });

  it('com ticket da sala → 200 (historico e upload)', async () => {
    const headers = guestParticipantHeaders(roomId);
    const messages = await h.app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages`, headers });
    expect(messages.statusCode).toBe(200);
    expect(messages.payload).toContain('historico secreto');
    const upload = await h.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/files`, ...txtUpload(headers) });
    expect(upload.statusCode).toBe(201);
    const uploadedId = (JSON.parse(upload.payload) as { files: Array<{ id: string }> }).files[0].id;
    const download = await h.app.inject({ method: 'GET', url: `/api/files/${uploadedId}`, headers });
    expect(download.statusCode).toBe(200);
  });

  it('dono sem ticket → 200', async () => {
    const headers = { cookie: `token=${ownerToken}` };
    expect((await h.app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages`, headers })).statusCode).toBe(200);
    expect((await h.app.inject({ method: 'POST', url: `/api/rooms/${roomId}/files`, ...txtUpload(headers) })).statusCode).toBe(201);
  });

  it('sala ENDED ou expirada → negado mesmo com ticket valido (e para o dono)', async () => {
    const ended = await prisma.room.create({ data: { name: ROOM_NAME, isPersistent: true, status: 'ENDED', ownerId } });
    const expired = await prisma.room.create({
      data: { name: ROOM_NAME, isPersistent: true, ownerId, expiresAt: new Date(Date.now() - 60_000) },
    });
    for (const id of [ended.id, expired.id]) {
      const asGuest = await h.app.inject({ method: 'GET', url: `/api/rooms/${id}/messages`, headers: guestParticipantHeaders(id) });
      expect(asGuest.statusCode).toBe(403);
      const asOwner = await h.app.inject({
        method: 'GET',
        url: `/api/rooms/${id}/messages`,
        headers: { cookie: `token=${ownerToken}` },
      });
      expect(asOwner.statusCode).toBe(403);
    }
  });

  it('fluxo real: join-room devolve o ticket (ack + evento room:ticket) e ele abre o historico', async () => {
    const guestId = randomUUID();
    const client = await connect(h.port, { guestName: 'Real', guestId });
    try {
      const ticketEvent = nextEvent<{ roomId: string; ticket: string }>(client, 'room:ticket');
      const ack = await emitAck(client, 'join-room', { roomId });
      expect(ack.success).toBe(true);
      const evt = await ticketEvent;
      expect(evt.roomId).toBe(roomId);
      expect(evt.ticket).toBe(ack.ticket);
      expect(verifyRoomTicket(evt.ticket, roomId, { userId: null, guestId })).toBe(true);
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/messages`,
        headers: { cookie: guestCookie(guestId), 'x-room-ticket': evt.ticket },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      client.disconnect();
    }
  });

  it('join-room negado (senha errada) nao emite ticket', async () => {
    const bcrypt = (await import('bcryptjs')).default;
    const locked = await prisma.room.create({
      data: { name: ROOM_NAME, isPersistent: true, passwordHash: bcrypt.hashSync('segredo123', 4) },
    });
    const client = await connect(h.port, { guestName: 'Errado', guestId: randomUUID() });
    try {
      let got = false;
      client.on('room:ticket', () => (got = true));
      const ack = await emitAck(client, 'join-room', { roomId: locked.id, password: 'errada-xx' });
      expect(ack.error).toBeDefined();
      expect(ack.ticket).toBeUndefined();
      await new Promise((r) => setTimeout(r, 50));
      expect(got).toBe(false);
    } finally {
      client.disconnect();
    }
  });

  it('GET /api/rooms: so publicas ativas, dados minimos (sem historico/convite/dono)', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/api/rooms', headers: { cookie: `token=${ownerToken}` } });
    expect(res.statusCode).toBe(200);
    const rooms = JSON.parse(res.payload).rooms as Array<Record<string, unknown>>;
    const mine = rooms.find((r) => r.id === roomId);
    expect(mine).toEqual({ id: roomId, name: ROOM_NAME, participantCount: 0, isPersistent: true, hasPassword: false });
    expect(res.payload).not.toContain('inviteToken');
    expect(res.payload).not.toContain('historico secreto');
  });
});

describe('guestId emitido pelo servidor: autoria de convidado', () => {
  let h: Harness;
  let roomId: string;

  beforeAll(async () => {
    h = await buildHarness();
    roomId = (await prisma.room.create({ data: { name: `${ROOM_NAME} guest`, isPersistent: true } })).id;
  });

  afterAll(async () => {
    await prisma.room.deleteMany({ where: { name: `${ROOM_NAME} guest` } }).catch(() => {});
    await h.app.close();
  });

  it('cookie: assinatura valida e reconhecida; adulterada/sem assinatura e ignorada', () => {
    const id = randomUUID();
    expect(verifyGuestCookie(signGuestId(id))).toBe(id);
    expect(verifyGuestCookie(id)).toBeNull();
    expect(verifyGuestCookie(`${randomUUID()}.${signGuestId(id).split('.')[1]}`)).toBeNull();
    expect(verifyGuestCookie(undefined)).toBeNull();
  });

  it('HTTP: convidado sem cookie recebe scale_guest HttpOnly/SameSite=Strict; com cookie valido nao; logado nao', async () => {
    const first = await h.app.inject({ method: 'GET', url: `/api/rooms/${roomId}/messages` });
    const setCookie = String(first.headers['set-cookie'] ?? '');
    expect(setCookie).toContain(`${GUEST_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Max-Age=15552000/);

    const again = await h.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages`,
      headers: { cookie: guestCookie(randomUUID()) },
    });
    expect(again.headers['set-cookie']).toBeUndefined();

    const logged = await h.app.inject({
      method: 'GET',
      url: `/api/rooms/${roomId}/messages`,
      headers: { cookie: `token=${signToken({ userId: 'u-guest-test', email: 'g@exemplo.com', name: 'L' })}` },
    });
    expect(logged.headers['set-cookie']).toBeUndefined();
  });

  it('handshake do Socket.io emite o cookie quando ausente (antes de qualquer mensagem)', async () => {
    const res = await fetch(`http://127.0.0.1:${h.port}/socket.io/?EIO=4&transport=polling`);
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`${GUEST_COOKIE_NAME}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    const raw = decodeURIComponent(setCookie.split(';')[0].split('=').slice(1).join('='));
    expect(verifyGuestCookie(raw)).not.toBeNull();
    await res.text();
  });

  it('dois convidados com o MESMO guestName: o segundo nao edita nem apaga; o mesmo cookie em outra conexao consegue', async () => {
    const aliceId = randomUUID();
    const alice = await connect(h.port, { guestName: 'Ana', guestId: aliceId });
    const impostor = await connect(h.port, { guestName: 'Ana', guestId: randomUUID() });
    try {
      await emitAck(alice, 'join-room', { roomId });
      await emitAck(impostor, 'join-room', { roomId });
      const sent = await emitAck(alice, 'chat:message', { roomId, content: 'mensagem da Ana' });
      const messageId = sent.messageId as string;
      const row = await prisma.chatMessage.findUnique({ where: { id: messageId } });
      expect(row?.guestId).toBe(aliceId);

      expect((await emitAck(impostor, 'chat:edit', { roomId, messageId, content: 'forjada' })).error).toMatch(/Not message author/);
      expect((await emitAck(impostor, 'chat:delete', { roomId, messageId })).error).toMatch(/Not authorized/);

      // Mesmo cookie (mesmo navegador), outra conexao: e a Ana.
      const aliceAgain = await connect(h.port, { guestName: 'Ana', guestId: aliceId });
      try {
        await emitAck(aliceAgain, 'join-room', { roomId });
        expect((await emitAck(aliceAgain, 'chat:edit', { roomId, messageId, content: 'editada pela Ana' })).success).toBe(true);
        expect((await emitAck(aliceAgain, 'chat:delete', { roomId, messageId })).success).toBe(true);
      } finally {
        aliceAgain.disconnect();
      }
    } finally {
      alice.disconnect();
      impostor.disconnect();
    }
  });

  it('cookie com assinatura invalida e ignorado: vira convidado novo sem autoria', async () => {
    const aliceId = randomUUID();
    const alice = await connect(h.port, { guestName: 'Bia', guestId: aliceId });
    // Mesmo UUID, assinatura forjada.
    const forged = await connect(h.port, { guestName: 'Bia', rawCookie: `${GUEST_COOKIE_NAME}=${aliceId}.assinaturaFalsa` });
    try {
      await emitAck(alice, 'join-room', { roomId });
      await emitAck(forged, 'join-room', { roomId });
      const messageId = (await emitAck(alice, 'chat:message', { roomId, content: 'da Bia' })).messageId as string;
      expect((await emitAck(forged, 'chat:edit', { roomId, messageId, content: 'x' })).error).toMatch(/Not message author/);
      expect((await emitAck(forged, 'chat:delete', { roomId, messageId })).error).toMatch(/Not authorized/);
    } finally {
      alice.disconnect();
      forged.disconnect();
    }
  });

  it('mensagem antiga de convidado sem guestId: ninguem (convidado) edita/apaga', async () => {
    const legacy = await prisma.chatMessage.create({ data: { roomId, content: 'legado', guestName: 'Caio' } });
    const caio = await connect(h.port, { guestName: 'Caio', guestId: randomUUID() });
    try {
      await emitAck(caio, 'join-room', { roomId });
      expect((await emitAck(caio, 'chat:edit', { roomId, messageId: legacy.id, content: 'x' })).error).toMatch(/Not message author/);
      expect((await emitAck(caio, 'chat:delete', { roomId, messageId: legacy.id })).error).toMatch(/Not authorized/);
    } finally {
      caio.disconnect();
    }
  });

  it('isMine correto no broadcast, no historico do join-room e no REST (por guestId, nunca pelo nome)', async () => {
    const authorId = randomUUID();
    const author = await connect(h.port, { guestName: 'Duda', guestId: authorId });
    const twin = await connect(h.port, { guestName: 'Duda', guestId: randomUUID() });
    try {
      await emitAck(author, 'join-room', { roomId });
      await emitAck(twin, 'join-room', { roomId });
      const authorGets = nextEvent<Ack>(author, 'chat:message');
      const twinGets = nextEvent<Ack>(twin, 'chat:message');
      const messageId = (await emitAck(author, 'chat:message', { roomId, content: 'isMine?' })).messageId as string;
      const [a, t] = await Promise.all([authorGets, twinGets]);
      expect(a.isMine).toBe(true);
      expect(t.isMine).toBe(false);
      expect(JSON.stringify(a)).not.toContain(authorId);

      // Historico do join-room (nova conexao, mesmo cookie)
      const back = await connect(h.port, { guestName: 'Outro nome', guestId: authorId });
      try {
        const join = await emitAck(back, 'join-room', { roomId });
        const hist = (join.history as Ack[]).find((m) => m.id === messageId);
        expect(hist?.isMine).toBe(true);
      } finally {
        back.disconnect();
      }

      // REST
      const restMine = await h.app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/messages`,
        headers: guestParticipantHeaders(roomId, authorId),
      });
      expect(restMine.statusCode).toBe(200);
      expect(restMine.payload).not.toContain(authorId);
      const fromRest = (JSON.parse(restMine.payload).messages as Ack[]).find((m) => m.id === messageId);
      expect(fromRest?.isMine).toBe(true);
      const restTwin = await h.app.inject({
        method: 'GET',
        url: `/api/rooms/${roomId}/messages`,
        headers: guestParticipantHeaders(roomId),
      });
      expect((JSON.parse(restTwin.payload).messages as Ack[]).find((m) => m.id === messageId)?.isMine).toBe(false);
    } finally {
      author.disconnect();
      twin.disconnect();
    }
  });

  it('upload grava o guestId do cookie (nome nao concede nada) e o autor pode apagar', async () => {
    const authorId = randomUUID();
    const author = await connect(h.port, { guestName: 'Eva', guestId: authorId });
    try {
      await emitAck(author, 'join-room', { roomId });
      const up = await h.app.inject({
        method: 'POST',
        url: `/api/rooms/${roomId}/files`,
        ...txtUpload(guestParticipantHeaders(roomId, authorId), 'Eva'),
      });
      expect(up.statusCode).toBe(201);
      const messageId = JSON.parse(up.payload).messageId as string;
      const msg = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: { files: true } });
      expect(msg?.guestId).toBe(authorId);
      expect(msg?.files[0].guestId).toBe(authorId);
      expect((await emitAck(author, 'chat:delete', { roomId, messageId })).success).toBe(true);
    } finally {
      author.disconnect();
    }
  });
});

describe('GUEST_COOKIE_SECRET', () => {
  afterAll(() => {
    process.env.NODE_ENV = 'test';
    delete process.env.GUEST_COOKIE_SECRET;
    resetEnv();
  });

  it('producao sem segredo (ou curto) falha; com >= 32 caracteres usa o valor; dev deriva do JWT_SECRET', () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'production';
    resetEnv();
    delete process.env.GUEST_COOKIE_SECRET;
    expect(() => getGuestCookieSecret()).toThrow(/GUEST_COOKIE_SECRET/);
    process.env.GUEST_COOKIE_SECRET = 'curto';
    expect(() => getGuestCookieSecret()).toThrow(/GUEST_COOKIE_SECRET/);
    process.env.GUEST_COOKIE_SECRET = 'z'.repeat(32);
    expect(getGuestCookieSecret()).toBe('z'.repeat(32));

    process.env.NODE_ENV = 'development';
    resetEnv();
    delete process.env.GUEST_COOKIE_SECRET;
    const expected = createHmac('sha256', 'test-secret-for-unit-tests').update('scale:guest-cookie:dev').digest('hex');
    expect(getGuestCookieSecret()).toBe(expected);
  });
});
