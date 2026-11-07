import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHmac } from 'node:crypto';
import { ROOM_FILE_QUOTA_BYTES } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { filesRoutes } from '../routes/files.js';
import { turnRoutes } from '../routes/turn.js';
import { profileRoutes } from '../routes/profile.js';
import { authPlugin } from '../plugins/auth.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { signRoomTicket } from '../lib/roomTicket.js';
import { byteLimit, StreamLimitError, tryAvatarSlot } from '../lib/resourceLimits.js';
import { gcDeletedFiles, getQuotaUsage, UPLOADS_ROOT } from '../lib/uploads.js';
import { purgeRoom, retryPendingRoomDeletions } from '../lib/roomDeletion.js';
import { guestParticipantHeaders } from './helpers/participation.js';

const rooms: string[] = [];
beforeEach(() => { vi.stubEnv('JWT_SECRET', 'test-secret-for-resource-hardening'); vi.stubEnv('NODE_ENV', 'test'); resetEnv(); });
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnv();
  for (const id of rooms.splice(0)) {
    await prisma.room.deleteMany({ where: { id } });
    await fs.rm(path.join(UPLOADS_ROOT, id), { recursive: true, force: true });
    await fs.unlink(path.join(UPLOADS_ROOT, '.room-deletions', id)).catch(() => {});
  }
});
async function room() {
  const result = await prisma.room.create({ data: { name: 'Resource hardening', isPersistent: true } });
  rooms.push(result.id);
  return result;
}
async function appWithFiles() {
  const app = Fastify();
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(multipart);
  await app.register(filesRoutes);
  return app;
}
function body(files: Array<{ name: string; content: string }>) {
  const boundary = 'scale-resources';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: files.map(f => `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: text/plain\r\n\r\n${f.content}\r\n`).join('') + `--${boundary}--\r\n`,
  };
}

it('stream limita bytes antes do disco e slots de avatar sao limitados', async () => {
  const received: Buffer[] = [];
  await expect(pipeline(Readable.from([Buffer.from('ok'), Buffer.from('too large')]), byteLimit(3),
    new Writable({ write(chunk: Buffer, _encoding, done) { received.push(chunk); done(); } }),
  )).rejects.toBeInstanceOf(StreamLimitError);
  expect(Buffer.concat(received).toString()).toBe('ok');
  const first = tryAvatarSlot()!;
  const second = tryAvatarSlot()!;
  expect(tryAvatarSlot()).toBeNull();
  first(); second();
  const next = tryAvatarSlot();
  expect(next).not.toBeNull(); next?.();
});

it('uploads paralelos na fronteira da quota: um grava; outro e recusado sem exceder', async () => {
  const r = await room();
  const msg = await prisma.chatMessage.create({ data: { roomId: r.id, content: '' } });
  await prisma.chatFile.create({ data: { roomId: r.id, messageId: msg.id, filename: 'seed', mime: 'text/plain', size: ROOM_FILE_QUOTA_BYTES - 3, path: `uploads/${r.id}/seed` } });
  const app = await appWithFiles();
  try {
    const upload = () => {
      const form = body([{ name: 'x.txt', content: 'abc' }]);
      return app.inject({ method: 'POST', url: `/api/rooms/${r.id}/files`, ...form, headers: { ...form.headers, ...guestParticipantHeaders(r.id) } });
    };
    const results = await Promise.all([upload(), upload()]);
    expect(results.map(v => v.statusCode).sort()).toEqual([201, 429]);
    const retry = await upload();
    expect(retry.statusCode).toBe(413);
    expect(retry.json().error).toBe('Quota exceeded');
    expect(await getQuotaUsage(r.id)).toBe(ROOM_FILE_QUOTA_BYTES);
    expect(await fs.readdir(path.join(UPLOADS_ROOT, r.id))).toHaveLength(1);
  } finally { await app.close(); }
});

it('falha no segundo metadata faz rollback mensagem/arquivos e compensa disco', async () => {
  const r = await room();
  const app = await appWithFiles();
  const uuid = '00000000-0000-4000-8000-000000000001';
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(uuid);
  try {
    const form = body([{ name: 'a.txt', content: 'a' }, { name: 'b.txt', content: 'b' }]);
    const response = await app.inject({ method: 'POST', url: `/api/rooms/${r.id}/files`, ...form, headers: { ...form.headers, ...guestParticipantHeaders(r.id) } });
    expect(response.statusCode).toBe(500);
    expect(await prisma.chatMessage.count({ where: { roomId: r.id } })).toBe(0);
    expect(await prisma.chatFile.count({ where: { roomId: r.id } })).toBe(0);
    expect(await fs.readdir(path.join(UPLOADS_ROOT, r.id))).toEqual([]);
  } finally { await app.close(); }
});

it('GC percorre mais de dois lotes; falha de unlink preserva referencia e retry', async () => {
  const r = await room();
  const msg = await prisma.chatMessage.create({ data: { roomId: r.id, content: '' } });
  const directory = path.join(UPLOADS_ROOT, r.id);
  await fs.mkdir(directory, { recursive: true });
  const old = new Date(Date.now() - 8 * 86400_000);
  await prisma.chatFile.createMany({ data: Array.from({ length: 205 }, (_, index) => ({ id: `${r.id}-${String(index).padStart(3, '0')}`, roomId: r.id, messageId: msg.id, filename: 'x', mime: 'text/plain', size: 1, path: `uploads/${r.id}/${index}`, deletedAt: old })) });
  await fs.writeFile(path.join(directory, '0'), 'x');
  const recent = await prisma.chatFile.create({ data: { roomId: r.id, messageId: msg.id, filename: 'recent', mime: 'text/plain', size: 1, path: `uploads/${r.id}/recent`, deletedAt: new Date(Date.now() - 6 * 86400_000) } });
  const unlink = fs.unlink.bind(fs);
  vi.spyOn(fs, 'unlink').mockImplementation(async file => {
    if (String(file) === path.join(directory, '0')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return unlink(file);
  });
  expect((await gcDeletedFiles()).deletedCount).toBe(204);
  expect(await prisma.chatFile.count({ where: { roomId: r.id } })).toBe(2);
  expect(await getQuotaUsage(r.id)).toBe(2);
  vi.restoreAllMocks();
  expect((await gcDeletedFiles()).deletedCount).toBe(1);
  expect(await prisma.chatFile.findUnique({ where: { id: recent.id } })).not.toBeNull();
});

it('purge falho fica ENDED com metadata+marker e retoma sem orfaos', async () => {
  const r = await room();
  const msg = await prisma.chatMessage.create({ data: { roomId: r.id, content: '' } });
  await prisma.chatFile.create({ data: { roomId: r.id, messageId: msg.id, filename: 'x', mime: 'text/plain', size: 1, path: `uploads/${r.id}/x` } });
  const directory = path.join(UPLOADS_ROOT, r.id);
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'x'), 'x');
  const remove = fs.rm.bind(fs);
  vi.spyOn(fs, 'rm').mockImplementation(async (file, opts) => {
    if (String(file) === directory) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    return remove(file, opts);
  });
  await expect(purgeRoom(undefined, r.id)).rejects.toThrow('denied');
  expect((await prisma.room.findUnique({ where: { id: r.id } }))?.status).toBe('ENDED');
  expect(await prisma.chatFile.count({ where: { roomId: r.id } })).toBe(1);
  await expect(fs.stat(path.join(UPLOADS_ROOT, '.room-deletions', r.id))).resolves.toBeDefined();
  vi.restoreAllMocks();
  await retryPendingRoomDeletions(undefined);
  expect(await prisma.room.findUnique({ where: { id: r.id } })).toBeNull();
  await expect(fs.stat(directory)).rejects.toThrow();
});

describe('TURN para participante efetivo', () => {
  it('valida sala/ticket, rejeita ended/expirado e mantem sessao legado', async () => {
    vi.stubEnv('ENABLE_TURN', 'true');
    vi.stubEnv('TURN_URL', 'turn:relay.example.test:3478');
    vi.stubEnv('TURN_AUTH_SECRET', 'synthetic-test-secret');
    resetEnv();
    const r = await room();
    const other = await room();
    const app = Fastify();
    await app.register(cookie); await app.register(authPlugin); await app.register(turnRoutes);
    const ticket = signRoomTicket(r.id, 'g:test');
    const get = (id: string, supplied = ticket) => app.inject({ url: `/api/turn/credentials?roomId=${id}`, headers: { 'x-room-ticket': supplied } });
    try {
      const response = await get(r.id);
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json().ttlSeconds).toBe(3600);
      const server = response.json().iceServers[1] as { username: string; credential: string };
      expect(server.credential).toBe(createHmac('sha1', 'synthetic-test-secret').update(server.username).digest('base64'));
      expect((await get(other.id)).statusCode).toBe(401);
      expect((await get(r.id, 'invalid')).statusCode).toBe(401);
      await prisma.room.update({ where: { id: r.id }, data: { status: 'ENDED' } });
      expect((await get(r.id)).statusCode).toBe(401);
      await prisma.room.update({ where: { id: r.id }, data: { status: 'ACTIVE', expiresAt: new Date(Date.now() - 1000) } });
      expect((await get(r.id)).statusCode).toBe(401);
      const token = signToken({ userId: 'legacy', email: 'legacy@example.test', name: 'Legacy' });
      expect((await app.inject({ url: '/api/turn/credentials', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200);
    } finally { await app.close(); }
  });
});

it('avatar em streaming compensa arquivo novo apos falha DB', async () => {
  const user = await prisma.user.create({ data: { name: 'Avatar Resource', email: `avatar-resource-${Date.now()}@example.test`, passwordHash: 'x' } });
  const app = Fastify();
  await app.register(cookie); await app.register(authPlugin); await app.register(multipart); await app.register(profileRoutes);
  const form = body([{ name: 'a.png', content: '\u0089PNG0000000000000000' }]);
  const token = signToken({ userId: user.id, email: user.email, name: user.name });
  const directory = path.join(UPLOADS_ROOT, 'avatars');
  await fs.mkdir(directory, { recursive: true });
  const before = await fs.readdir(directory);
  // Magic PNG ASCII prefix plus binary signature via payload replaces UTF8 sequence.
  const payload = Buffer.concat([Buffer.from(form.payload.split('\u0089')[0]), Buffer.from('89504e47', 'hex'), Buffer.from(form.payload.split('PNG')[1])]);
  vi.spyOn(prisma.user, 'update').mockRejectedValueOnce(new Error('synthetic DB failure'));
  try {
    const response = await app.inject({ method: 'PUT', url: '/api/me/avatar', headers: { ...form.headers, cookie: `token=${token}` }, payload });
    expect(response.statusCode).toBe(500);
    expect(await fs.readdir(directory)).toEqual(before);
  } finally { await app.close(); await prisma.user.delete({ where: { id: user.id } }); }
});
