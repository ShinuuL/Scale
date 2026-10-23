import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server as HttpServer } from 'http';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { createSocketServer, readCookie } from '../socket/handler.js';
import { metricsRoutes } from '../routes/metrics.js';
import { authPlugin } from '../plugins/auth.js';
import { signToken } from '../lib/auth.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}

describe('Socket.io Handler', () => {
  let app: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never;
  let httpServer: HttpServer;
  let port: number;
  let token: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.METRICS_ADMIN_EMAILS = 'socket@exemplo.com';

    token = signToken({ userId: 'user-socket-test', email: 'socket@exemplo.com', name: 'Socket Tester' });

    app = await buildApp();
    // /api/metrics exige JWT: sem o authPlugin registrado o decorator
    // `fastify.authenticate` nao existe e a rota nem é montada.
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(metricsRoutes);
    await prisma.$connect();

    // Create a room for tests
    const room = await prisma.room.create({
      data: {
        name: 'Socket Test Room',
        isPersistent: true,
        isPrivate: false,
        maxParticipants: 8,
      },
    });

    // Store room ID on the app for tests
    (app as unknown as Record<string, unknown>).testRoomId = room.id;

    // Start the server
    await app.listen({ port: 0, host: '127.0.0.1' });
    httpServer = app.server;
    const address = httpServer.address();
    if (address && typeof address === 'object') {
      port = address.port;
    }
    createSocketServer(httpServer);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  function connectClient(): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        auth: { guestName: 'TestUser' },
        transports: ['websocket'],
      });
      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
    });
  }

  it('connects and joins a room', async () => {
    const roomId = (app as unknown as Record<string, string>).testRoomId;
    const client = await connectClient();

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      client.emit('join-room', { roomId }, (response: Record<string, unknown>) => {
        resolve(response);
      });
    });

    expect(result.success).toBe(true);
    expect(result.roomId).toBe(roomId);
    expect(Array.isArray(result.peers)).toBe(true);

    client.disconnect();
  });

  it('receives peer-joined event when second client joins', async () => {
    const roomId = (app as unknown as Record<string, string>).testRoomId;
    const client1 = await connectClient();
    const client2 = await connectClient();

    // Join first client
    await new Promise<void>((resolve) => {
      client1.emit('join-room', { roomId }, () => resolve());
    });

    // Set up listener on client1
    const joinedPromise = new Promise<Record<string, unknown>>((resolve) => {
      client1.on('room:peer-joined', (data: Record<string, unknown>) => {
        resolve(data);
      });
    });

    // Join second client
    await new Promise<void>((resolve) => {
      client2.emit('join-room', { roomId }, () => resolve());
    });

    const peerJoined = await joinedPromise;
    expect(peerJoined.name).toBe('TestUser');

    client1.disconnect();
    client2.disconnect();
  });

  it('ack de join-room entrega peers no shape publico `peerId` (nunca `socketId`)', async () => {
    const roomId = (app as unknown as Record<string, string>).testRoomId;
    const client1 = await connectClient();
    const client2 = await connectClient();

    // client1 ja esta na sala
    await new Promise<void>((resolve) => {
      client1.emit('join-room', { roomId }, () => resolve());
    });

    const joinedPromise = new Promise<Record<string, unknown>>((resolve) => {
      client1.on('room:peer-joined', (data: Record<string, unknown>) => resolve(data));
    });

    // client2 entra e recebe a lista de quem ja estava
    const ack = await new Promise<Record<string, unknown>>((resolve) => {
      client2.emit('join-room', { roomId }, (response: Record<string, unknown>) => resolve(response));
    });
    const peers = ack.peers as Array<Record<string, unknown>>;
    expect(Array.isArray(peers)).toBe(true);

    const peerJoined = await joinedPromise;
    expect(typeof peerJoined.peerId).toBe('string');
    expect(peerJoined.peerId).not.toBe('');
    // o evento anuncia o RECEM-CHEGADO (client2)
    expect(peerJoined.peerId).toBe(client2.id);

    // O novato tem que achar client1 pelo MESMO id que o evento
    // 'room:peer-joined' publica. Antes este ack mandava `socketId`, e o
    // front recebia `peer.peerId === undefined` em `connectToPeers`: a malha
    // so convergia quando o peer mais antigo iniciava a offer (metade das
    // vezes), causando desconexao silenciosa entre participantes.
    const match = peers.filter((p) => p.peerId === client1.id);
    expect(match).toHaveLength(1);
    expect(match[0].name).toBe('TestUser');
    expect(match[0].isRegistered).toBe(false);
    expect(match[0]).not.toHaveProperty('userId');
    expect(peers.every((p) => !('socketId' in p))).toBe(true);

    client1.disconnect();
    client2.disconnect();
  });

  it('GET /api/metrics nao vaza roomId (peers vem como contagens)', async () => {
    const roomId = (app as unknown as Record<string, string>).testRoomId;
    const client = await connectClient();
    await new Promise<void>((resolve) => {
      client.emit('join-room', { roomId }, () => resolve());
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      peers: { total: number; perRoom: number[]; byRoom?: unknown };
    };

    expect(body.peers.total).toBeGreaterThanOrEqual(1);
    expect(body.peers.perRoom.reduce((sum, n) => sum + n, 0)).toBe(body.peers.total);
    // o contrato antigo (mapa roomId -> count) nao pode voltar
    expect(body.peers.byRoom).toBeUndefined();
    // e o uuid da sala nao pode aparecer em NENHUM lugar do payload
    expect(res.payload).not.toContain(roomId);

    client.disconnect();
  });

  it('rejects join to nonexistent room', async () => {
    const client = await connectClient();

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      client.emit(
        'join-room',
        { roomId: '00000000-0000-0000-0000-000000000000' },
        (response: Record<string, unknown>) => resolve(response),
      );
    });

    expect(result.error).toBe('Room not found');
    client.disconnect();
  });

  it('validates signal payload (rejects invalid offer)', async () => {
    const roomId = (app as unknown as Record<string, string>).testRoomId;
    const client = await connectClient();

    // Join the room
    await new Promise<void>((resolve) => {
      client.emit('join-room', { roomId }, () => resolve());
    });

    // Try sending an invalid offer (missing required fields)
    const result = await new Promise<Record<string, unknown>>((resolve) => {
      client.emit(
        'signal:offer',
        {
          roomId,
          targetPeerId: 'fake-peer-id',
          offer: { type: 'offer' }, // missing sdp
        },
        (response: Record<string, unknown>) => resolve(response),
      );
    });

    expect(result.error).toBe('Invalid payload');
    client.disconnect();
  });

  it('usuário logado pelo cookie HttpOnly entra com o nome do cadastro (não Guest)', async () => {
    const roomId = (app as unknown as Record<string, string>).testRoomId;
    const observer = await connectClient();
    await new Promise<void>((resolve) => {
      observer.emit('join-room', { roomId }, () => resolve());
    });

    const joinedPromise = new Promise<Record<string, unknown>>((resolve) => {
      observer.on('room:peer-joined', (data: Record<string, unknown>) => resolve(data));
    });

    // Igual ao browser: o JWT só viaja no header Cookie do handshake.
    const logged = await new Promise<Socket>((resolve, reject) => {
      const client = ioClient(`http://127.0.0.1:${port}`, {
        auth: { guestName: 'Guest-abcd' },
        transports: ['websocket'],
        extraHeaders: { Cookie: `theme=dark; token=${token}` },
      });
      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
    });
    await new Promise<void>((resolve) => {
      logged.emit('join-room', { roomId }, () => resolve());
    });

    const peerJoined = await joinedPromise;
    expect(peerJoined.name).toBe('Socket Tester');
    // o id do usuario nunca trafega: so o flag isRegistered
    expect(peerJoined.isRegistered).toBe(true);
    expect(peerJoined).not.toHaveProperty('userId');

    observer.disconnect();
    logged.disconnect();
  });

  it('readCookie extrai o valor certo do header Cookie', () => {
    expect(readCookie('a=1; token=abc.def; b=2', 'token')).toBe('abc.def');
    expect(readCookie('xtoken=nope', 'token')).toBeUndefined();
    expect(readCookie(undefined, 'token')).toBeUndefined();
    expect(readCookie('token=', 'token')).toBeUndefined();
  });
});
