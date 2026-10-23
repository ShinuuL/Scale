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

// Unique email helper to avoid 409 conflicts across test runs
let emailCounter = 0;
function uniqueEmail(prefix: string): string {
  emailCounter++;
  return `${prefix}-${Date.now()}-${emailCounter}@test.com`;
}

describe('Room API', () => {
  let app: ReturnType<typeof buildApp> extends Promise<infer T> ? T : never;
  // Etapa 1: POST /api/rooms exige login. Um usuário fixo criado no beforeAll
  // fornece o header Authorization usado pelos testes de criação.
  let auth: { authorization: string };

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    app = await buildApp();
    await prisma.$connect();
    // Clean up any leftover test data from previous runs
    await prisma.chatFile.deleteMany({});
    await prisma.chatMessage.deleteMany({});
    await prisma.roomMember.deleteMany({});
    await prisma.room.deleteMany({});
    await prisma.user.deleteMany({});

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: uniqueEmail('room-creator'),
        password: 'pass12345',
        name: 'Room Creator',
      },
    });
    expect(reg.statusCode).toBe(201);
    auth = { authorization: `Bearer ${JSON.parse(reg.payload).token}` };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('POST /api/rooms sem login → 401', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { name: 'Sem login', isPersistent: false },
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload).error).toBe('Authentication required');
  });

  it('POST /api/rooms creates a room', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth,
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
      headers: auth,
      payload: {
        name: 'AB',
        isPersistent: false,
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.error).toBe('Validation failed');
  });

  it('POST /api/rooms e limitado por IP (429 no flood, sem afetar outro IP)', async () => {
    const floodIp = '203.0.113.77';
    const create = (remoteAddress: string, name: string) =>
      app.inject({
        method: 'POST',
        url: '/api/rooms',
        remoteAddress,
        headers: auth,
        payload: { name, isPersistent: false },
      });

    const results = [];
    for (let i = 0; i < 11; i += 1) {
      results.push(await create(floodIp, `Flood ${i}`));
    }

    // 10 passam dentro da janela de 5s; a 11a e barrada
    expect(results.slice(0, 10).map((r) => r.statusCode)).toEqual(Array(10).fill(201));
    expect(results[10].statusCode).toBe(429);
    expect(JSON.parse(results[10].payload)).toMatchObject({
      error: 'Too many rooms created. Try again in a few seconds.',
    });

    // o balde e por IP: outro cliente continua criando normalmente
    const other = await create('203.0.113.78', 'Outro cliente');
    expect(other.statusCode).toBe(201);
  });

  it('GET /api/rooms/:id returns room details', async () => {
    // Create a room first
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth,
      payload: {
        name: 'Details Room',
        isPersistent: true,
      },
    });

    const { room } = JSON.parse(createRes.payload);

    // Não-dono (anônimo): ownerId NÃO é exposto (evita vazar quem é o dono).
    const response = await app.inject({
      method: 'GET',
      url: `/api/rooms/${room.id}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.room.name).toBe('Details Room');
    expect(body.room.isPersistent).toBe(true);
    // Sala sem senha → hasPassword false (flag para o gate de password da UI).
    // passwordHash nunca aparece na resposta.
    expect(body.room.hasPassword).toBe(false);
    expect(body.room.passwordHash).toBeUndefined();
    expect(body.room.ownerId).toBeUndefined();

    // Dono (mesmo token da criação): recebe ownerId.
    const owned = await app.inject({
      method: 'GET',
      url: `/api/rooms/${room.id}`,
      headers: auth,
    });
    expect(owned.statusCode).toBe(200);
    expect(JSON.parse(owned.payload).room.ownerId).toBeDefined();
  });

  it('GET /api/rooms/:id returns 404 for nonexistent room', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/rooms/00000000-0000-0000-0000-000000000000',
    });

    expect(response.statusCode).toBe(404);
  });

  it('GET /api/rooms sem login → 401', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/rooms',
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload).error).toBe('Authentication required');
  });

  it('GET /api/rooms lists active public rooms', async () => {
    // Create some rooms
    await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth,
      payload: { name: 'List Room 1', isPersistent: true },
    });
    await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: auth,
      payload: { name: 'List Room 2', isPersistent: true, isPrivate: true },
    });

    // Listar exige login (401 acima); com sessão válida a lista vem.
    const response = await app.inject({
      method: 'GET',
      url: '/api/rooms',
      headers: auth,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.rooms).toBeDefined();
    expect(Array.isArray(body.rooms)).toBe(true);
    // Should only include public rooms
    for (const r of body.rooms) {
      expect(r.isPrivate).toBe(false);
      // A listagem nunca expõe o dono (ownerId é usado só internamente para o
      // gate do inviteToken).
      expect(r.ownerId).toBeUndefined();
    }
  });

  // --- Task 8: password bcrypt + rotate-invite ---

  describe('password + rotate-invite', () => {
    it('cria sala persistente com senha bcrypt e rotaciona invite só dono', async () => {
      // 1. Register + login to get a token
      const ownerEmail = uniqueEmail('owner-pw');
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: ownerEmail, password: 'pass12345', name: 'Owner PW' },
      });
      expect(regRes.statusCode).toBe(201);
      const { token } = JSON.parse(regRes.payload);

      // 2. Create persistent room with password (authenticated so ownerId is set)
      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { name: 'Privada', isPersistent: true, password: 'supersec8' },
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(201);
      const { room } = JSON.parse(res.payload);
      expect(room.id).toBeDefined();
      expect(room.passwordHash).toBeUndefined(); // must not be exposed in response
      // POST /api/rooms não expõe hasPassword — o flag é do GET /:id (a UI do
      // room page consome GET). A asserção está no GET abaixo.

      // GET da sala mostra hasPassword true sem expor hash
      const getRes = await app.inject({
        method: 'GET',
        url: `/api/rooms/${room.id}`,
      });
      expect(getRes.statusCode).toBe(200);
      const getBody = JSON.parse(getRes.payload);
      expect(getBody.room.hasPassword).toBe(true);
      expect(getBody.room.passwordHash).toBeUndefined();

      // 3. Owner rotates invite → 200 with new token
      const rot = await app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/rotate-invite`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(rot.statusCode).toBe(200);
      const rotBody = JSON.parse(rot.payload);
      expect(rotBody.inviteToken).toBeDefined();
      expect(rotBody.inviteToken).not.toBe(room.inviteToken);

      // 4. Guest (no auth / different user) → 403
      const guestEmail = uniqueEmail('guest-pw');
      const regGuest = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: guestEmail, password: 'pass12345', name: 'Guest PW' },
      });
      const { token: guestToken } = JSON.parse(regGuest.payload);

      const rotGuest = await app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/rotate-invite`,
        headers: { authorization: `Bearer ${guestToken}` },
      });
      expect(rotGuest.statusCode).toBe(403);
    });

    it('password curta <8 rejeita', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth,
        payload: { name: 'ShortPw', isPersistent: true, password: 'short' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('password only allowed for persistent rooms', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth,
        payload: { name: 'TempPw', isPersistent: false, password: 'supersec8' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rotate-invite sem auth → 401', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: auth,
        payload: { name: 'NoAuth', isPersistent: true },
      });
      const { room } = JSON.parse(createRes.payload);

      const rot = await app.inject({
        method: 'POST',
        url: `/api/rooms/${room.id}/rotate-invite`,
      });
      expect(rot.statusCode).toBe(401);
    });

    it('rotate-invite sala inexistente → 404', async () => {
      const ownerEmail404 = uniqueEmail('owner404');
      const regRes = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: ownerEmail404, password: 'pass12345', name: 'Owner 404' },
      });
      const { token } = JSON.parse(regRes.payload);

      const rot = await app.inject({
        method: 'POST',
        url: '/api/rooms/00000000-0000-0000-0000-000000000000/rotate-invite',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(rot.statusCode).toBe(404);
    });
  });
});
