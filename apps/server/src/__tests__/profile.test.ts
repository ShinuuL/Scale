/**
 * Perfil do usuario: PATCH /api/me (nome + JWT reemitido) e a foto de perfil
 * (PUT/GET/DELETE /api/me/avatar, ate 32 MB, PNG/JPEG/WebP por magic bytes).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { profileRoutes, detectAvatarMime } from '../routes/profile.js';
import { signToken, verifyToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetProfileUpdateRateLimit } from '../lib/rateLimit.js';

const EMAIL = `profile-${Date.now()}@exemplo.com`;
const PNG = Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), Buffer.alloc(32)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(16)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16)]);

function avatarBody(content: Buffer, contentType = 'image/png'): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----scale${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="avatar"; filename="a.png"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe('detectAvatarMime', () => {
  it('aceita PNG e WebP, recusa WAV (tambem RIFF) e SVG', () => {
    expect(detectAvatarMime(PNG)).toBe('image/png');
    expect(detectAvatarMime(WEBP)).toBe('image/webp');
    expect(detectAvatarMime(WAV)).toBeNull();
    expect(detectAvatarMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });
});

describe('rotas de perfil', () => {
  let app: FastifyInstance;
  let userId = '';
  let token = '';
  const auth = (): Record<string, string> => ({ cookie: `token=${token}` });

  async function putAvatar(content: Buffer, contentType?: string) {
    const body = avatarBody(content, contentType);
    return app.inject({
      method: 'PUT',
      url: '/api/me/avatar',
      headers: { ...auth(), ...body.headers },
      payload: body.payload,
    });
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    // Mesmo limite global do server.ts (chat): a rota de foto sobe o proprio teto.
    await app.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
    await app.register(profileRoutes);
    await app.ready();
    const user = await prisma.user.create({ data: { email: EMAIL, passwordHash: 'x', name: 'Ana' } });
    userId = user.id;
    token = signToken({ userId, email: EMAIL, name: 'Ana' });
  });

  beforeEach(() => resetProfileUpdateRateLimit(userId));

  afterAll(async () => {
    const u = await prisma.user.findUnique({ where: { id: userId } });
    if (u?.avatarPath) await fs.unlink(path.resolve(process.cwd(), u.avatarPath)).catch(() => {});
    await prisma.user.deleteMany({ where: { email: EMAIL } }).catch(() => {});
    await app.close();
  });

  it('sem sessao -> 401', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/me', payload: { name: 'X' } });
    expect(res.statusCode).toBe(401);
  });

  it('PATCH /api/me troca o nome e reemite o JWT com o nome novo', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(), payload: { name: '  Shinuu  ' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('Shinuu');
    const sessao = res.cookies.find((c) => c.name === 'token');
    expect(sessao?.httpOnly).toBe(true);
    expect(verifyToken(sessao!.value).name).toBe('Shinuu');
  });

  it('PATCH /api/me recusa nome vazio ou longo', async () => {
    for (const name of ['   ', 'a'.repeat(101)]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/me', headers: auth(), payload: { name } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('foto: envia, le, troca (apaga a anterior) e remove', async () => {
    const res = await putAvatar(PNG);
    expect(res.statusCode).toBe(200);
    expect(res.json().user.avatarUpdatedAt).toBeTruthy();
    const first = (await prisma.user.findUnique({ where: { id: userId } }))!.avatarPath!;

    const get = await app.inject({ method: 'GET', url: '/api/me/avatar', headers: auth() });
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['x-content-type-options']).toBe('nosniff');

    const res2 = await putAvatar(WEBP, 'image/webp');
    expect(res2.statusCode).toBe(200);
    await expect(fs.access(path.resolve(process.cwd(), first))).rejects.toThrow();

    const del = await app.inject({ method: 'DELETE', url: '/api/me/avatar', headers: auth(), payload: {} });
    expect(del.statusCode).toBe(200);
    expect(del.json().user.avatarUpdatedAt).toBeNull();
    const after = await app.inject({ method: 'GET', url: '/api/me/avatar', headers: auth() });
    expect(after.statusCode).toBe(404);
  });

  it('foto: recusa conteudo que nao e imagem, mesmo declarado image/png', async () => {
    expect((await putAvatar(WAV)).statusCode).toBe(400);
  });

  it('foto: aceita acima de 15 MB (teto do chat) e recusa acima de 32 MB', async () => {
    expect((await putAvatar(Buffer.concat([PNG, Buffer.alloc(20_000_000)]))).statusCode).toBe(200);
    expect((await putAvatar(Buffer.concat([PNG, Buffer.alloc(32_000_001)]))).statusCode).toBe(413);
  });
});
