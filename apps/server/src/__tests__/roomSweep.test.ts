/**
 * Limpeza de salas temporarias vencidas (sweepExpiredRooms) e contagem de
 * salas ativas nas metricas considerando o prazo (expiresAt), nao so o status.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { metricsRoutes } from '../routes/metrics.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { UPLOADS_ROOT } from '../lib/uploads.js';
import { sweepExpiredRooms } from '../lib/roomDeletion.js';

const TAG = `sweep-${Date.now()}`;
const HOUR = 60 * 60 * 1000;

function makeRoom(data: { isPersistent: boolean; expiresAt: Date | null; suffix: string }) {
  return prisma.room.create({
    data: {
      name: `${TAG}-${data.suffix}`,
      isPersistent: data.isPersistent,
      isPrivate: false,
      maxParticipants: 8,
      expiresAt: data.expiresAt,
    },
  });
}

describe('sweepExpiredRooms', () => {
  afterEach(async () => {
    await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('apaga temporaria vencida (mensagens e diretorio de uploads juntos)', async () => {
    const expired = await makeRoom({ isPersistent: false, expiresAt: new Date(Date.now() - HOUR), suffix: 'expired' });
    await prisma.chatMessage.create({ data: { roomId: expired.id, content: 'oi', guestName: 'G' } });
    const dir = path.join(UPLOADS_ROOT, expired.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'x.txt'), 'x');

    const result = await sweepExpiredRooms({ io: undefined, activeRoomIds: new Set() });

    expect(result.deleted).toContain(expired.id);
    expect(await prisma.room.findUnique({ where: { id: expired.id } })).toBeNull();
    expect(await prisma.chatMessage.count({ where: { roomId: expired.id } })).toBe(0);
    await expect(fs.access(dir)).rejects.toThrow();
  });

  it('nao toca em persistente, temporaria no prazo nem sala com gente conectada', async () => {
    const persistent = await makeRoom({ isPersistent: true, expiresAt: null, suffix: 'persist' });
    const valid = await makeRoom({ isPersistent: false, expiresAt: new Date(Date.now() + HOUR), suffix: 'valid' });
    const busy = await makeRoom({ isPersistent: false, expiresAt: new Date(Date.now() - HOUR), suffix: 'busy' });

    const result = await sweepExpiredRooms({ io: undefined, activeRoomIds: new Set([busy.id]) });

    expect(result.deleted).not.toContain(persistent.id);
    expect(result.deleted).not.toContain(valid.id);
    expect(result.deleted).not.toContain(busy.id);
    expect(result.skippedBusy).toContain(busy.id);
    for (const id of [persistent.id, valid.id, busy.id]) {
      expect(await prisma.room.findUnique({ where: { id } })).not.toBeNull();
    }
  });
});

describe('/api/metrics: salas ativas consideram o prazo', () => {
  let app: FastifyInstance;
  const ADMIN = `sweep-admin-${Date.now()}@exemplo.com`;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.ADMIN_EMAILS = ADMIN;
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(metricsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    delete process.env.ADMIN_EMAILS;
    resetEnv();
    await prisma.room.deleteMany({ where: { name: { startsWith: TAG } } });
    await app.close();
  });

  it('temporaria vencida com status ACTIVE nao conta como ativa', async () => {
    const token = signToken({ userId: 'sweep-admin', email: ADMIN, name: 'Admin' });
    const read = async () => {
      const res = await app.inject({ method: 'GET', url: '/api/metrics', cookies: { token } });
      expect(res.statusCode).toBe(200);
      return JSON.parse(res.payload).rooms as { total: number; active: number };
    };

    const before = await read();
    await makeRoom({ isPersistent: false, expiresAt: new Date(Date.now() - HOUR), suffix: 'm-expired' });
    await makeRoom({ isPersistent: false, expiresAt: new Date(Date.now() + HOUR), suffix: 'm-valid' });
    const after = await read();

    expect(after.total - before.total).toBe(2);
    expect(after.active - before.active).toBe(1);
  });
});
