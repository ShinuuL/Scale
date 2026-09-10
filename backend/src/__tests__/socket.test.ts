import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Server as HttpServer } from 'http';
import Fastify from 'fastify';
import { io as ioClient, Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { createSocketServer } from '../socket/handler.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}

describe('Socket.io Handler', () => {
  let app: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never;
  let httpServer: HttpServer;
  let port: number;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';

    app = await buildApp();
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
});
