import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Server as HttpServer } from 'http';
import Fastify from 'fastify';
import { io as ioClient, Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { createSocketServer } from '../socket/handler.js';

/**
 * Estado do microfone entre peers: quem entra informa `muted` no join-room,
 * mudanças vão por `peer:audio-state` e a sala recebe `room:peer-audio-state`.
 * Quem entra depois recebe o estado atual na lista de peers do ack.
 */
describe('socket peer:audio-state', () => {
  let app: Fastify.FastifyInstance;
  let httpServer: HttpServer;
  let port: number;
  let roomId: string;
  const clients: Socket[] = [];

  beforeAll(async () => {
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

    const room = await prisma.room.create({ data: { name: 'Audio State', isPersistent: false } });
    roomId = room.id;
  });

  beforeEach(() => {
    // Clientes novos a cada teste: o balde de rate limit e por socket.
    while (clients.length) clients.pop()?.disconnect();
  });

  afterAll(async () => {
    while (clients.length) clients.pop()?.disconnect();
    await prisma.room.delete({ where: { id: roomId } }).catch(() => undefined);
    await app?.close();
    await prisma.$disconnect();
  });

  function connect(name: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        auth: { guestName: name },
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

  function nextEvent<T>(client: Socket, event: string): Promise<T> {
    return new Promise((resolve) => client.once(event, (data: T) => resolve(data)));
  }

  it('join-room com muted chega no peer-joined e no ack de quem entra depois', async () => {
    const a = await connect('Ana');
    await emit(a, 'join-room', { roomId });

    const joined = nextEvent<{ peerId: string; muted?: boolean }>(a, 'room:peer-joined');
    const b = await connect('Bia');
    await emit(b, 'join-room', { roomId, muted: true });
    expect((await joined).muted).toBe(true);

    const c = await connect('Caio');
    const ack = await emit<{ peers: { peerId: string; muted?: boolean }[] }>(c, 'join-room', { roomId });
    const byId = new Map(ack.peers.map((p) => [p.peerId, p.muted]));
    expect(byId.get(a.id!)).toBe(false);
    expect(byId.get(b.id!)).toBe(true);
  });

  it('peer:audio-state repassa para a sala e atualiza o estado guardado', async () => {
    const a = await connect('Ana');
    const b = await connect('Bia');
    await emit(a, 'join-room', { roomId });
    await emit(b, 'join-room', { roomId });

    const received = nextEvent<{ peerId: string; muted: boolean }>(b, 'room:peer-audio-state');
    const resp = await emit(a, 'peer:audio-state', { roomId, muted: true });
    expect(resp).toEqual({ success: true });
    expect(await received).toEqual({ peerId: a.id, muted: true });

    const c = await connect('Caio');
    const ack = await emit<{ peers: { peerId: string; muted?: boolean }[] }>(c, 'join-room', { roomId });
    expect(ack.peers.find((p) => p.peerId === a.id)?.muted).toBe(true);
  });

  it('recusa quem não está na sala e payload inválido', async () => {
    const outsider = await connect('Fora');
    expect(await emit(outsider, 'peer:audio-state', { roomId, muted: true })).toEqual({
      error: 'Not in room',
    });
    const resp = await emit<{ error?: string }>(outsider, 'peer:audio-state', { roomId, muted: 'sim' });
    expect(resp.error).toBe('Invalid payload');
  });
});
