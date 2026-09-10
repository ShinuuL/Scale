import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';
import { roomRoutes } from '../routes/rooms.js';

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(roomRoutes);
  return app;
}

describe('Room API', () => {
  let app: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await prisma.$connect();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /api/rooms creates a room', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: {
        name: 'Test Room',
        isPersistent: false,
        isPrivate: false,
        maxParticipants: 4,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.room).toBeDefined();
    expect(body.room.name).toBe('Test Room');
    expect(body.room.maxParticipants).toBe(4);
    expect(body.room.id).toBeDefined();
    expect(body.room.inviteToken).toBeDefined();
    expect(body.room.expiresAt).toBeDefined();
  });

  it('POST /api/rooms rejects invalid name (too short)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: {
        name: 'AB',
        isPersistent: false,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Validation failed');
  });

  it('GET /api/rooms/:id returns room details', async () => {
    // Create a room first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: {
        name: 'Details Room',
        isPersistent: true,
      },
    });

    const { room } = JSON.parse(createRes.payload);

    const response = await app.inject({
      method: 'GET',
      url: `/api/rooms/${room.id}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.room.name).toBe('Details Room');
    expect(body.room.isPersistent).toBe(true);
  });

  it('GET /api/rooms/:id returns 404 for nonexistent room', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/rooms/00000000-0000-0000-0000-000000000000',
    });

    expect(response.statusCode).toBe(404);
  });

  it('GET /api/rooms lists active public rooms', async () => {
    // Create some rooms
    await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'List Room 1', isPersistent: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'List Room 2', isPersistent: true, isPrivate: true },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/rooms',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.rooms).toBeDefined();
    expect(Array.isArray(body.rooms)).toBe(true);
    // Should only include public rooms
    for (const r of body.rooms) {
      expect(r.isPrivate).toBe(false);
    }
  });
});
