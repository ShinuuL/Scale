/**
 * Foto de membro da comunidade: GET /api/communities/:id/members/:userId/avatar.
 * So quem e membro ve, e so a foto de outro membro da MESMA comunidade.
 * Nao membro, alvo de fora e sem foto respondem o mesmo 404.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { socialRoutes } from '../routes/social.js';
import { communityRoutes } from '../routes/communities.js';
import { AVATARS_ROOT } from '../routes/profile.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';

const STAMP = Date.now();
const PNG = Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), Buffer.alloc(32)]);

describe('foto de membro da comunidade', () => {
  let app: FastifyInstance;
  let communityId = '';
  const users: Record<'photo' | 'plain' | 'outsider', { id: string; token: string }> = {} as never;
  const avatarFile = path.join(AVATARS_ROOT, `member-avatar-test-${STAMP}.png`);

  const get = (who: keyof typeof users, userId: string, cid = communityId) =>
    app.inject({ method: 'GET', url: `/api/communities/${cid}/members/${userId}/avatar`, headers: { cookie: `token=${users[who].token}` } });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(socialRoutes);
    await app.register(communityRoutes);
    await app.ready();

    await fs.mkdir(AVATARS_ROOT, { recursive: true });
    await fs.writeFile(avatarFile, PNG);
    const rel = path.relative(process.cwd(), avatarFile);
    for (const who of ['photo', 'plain', 'outsider'] as const) {
      const email = `member-avatar-${who}-${STAMP}@exemplo.com`;
      const user = await prisma.user.create({
        data: { email, passwordHash: 'x', name: who, ...(who === 'photo' ? { avatarPath: rel, avatarMime: 'image/png', avatarUpdatedAt: new Date() } : {}) },
      });
      users[who] = { id: user.id, token: signToken({ userId: user.id, email, name: who }) };
    }
    const community = await prisma.community.create({
      data: { name: 'Fotos', ownerId: users.photo.id, members: { create: [{ userId: users.photo.id, role: 'OWNER' }, { userId: users.plain.id, role: 'MEMBER' }] } },
    });
    communityId = community.id;
  });

  afterAll(async () => {
    await prisma.community.deleteMany({ where: { id: communityId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await fs.rm(avatarFile, { force: true });
    await app.close();
  });

  it('membro ve a foto de outro membro e a propria', async () => {
    const res = await get('plain', users.photo.id);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/png');
    expect((await get('photo', users.photo.id)).statusCode).toBe(200);
  });

  it('nao membro, alvo de fora e sem foto respondem 404', async () => {
    expect((await get('outsider', users.photo.id)).statusCode).toBe(404);
    expect((await get('photo', users.outsider.id)).statusCode).toBe(404);
    expect((await get('photo', users.plain.id)).statusCode).toBe(404);
  });

  it('detalhe da comunidade informa a versao da foto de cada membro', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/communities/${communityId}`, headers: { cookie: `token=${users.plain.token}` } });
    const members = (res.json() as { members: Array<{ userId: string; avatarUpdatedAt: string | null }> }).members;
    expect(members.find((m) => m.userId === users.photo.id)?.avatarUpdatedAt).toEqual(expect.any(String));
    expect(members.find((m) => m.userId === users.plain.id)?.avatarUpdatedAt).toBeNull();
  });
});
