/**
 * Fase 1 das comunidades: icone/banner (PUT|GET|DELETE /api/communities/:id/{icon|banner})
 * e categorias + ordem dos canais (/categories, /community-categories/:id, /layout).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetProfileUpdateRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { communityExtrasRoutes, sameSet } from '../routes/communityExtras.js';

type Who = 'owner' | 'admin' | 'channels' | 'member' | 'outsider';
const names: Who[] = ['owner', 'admin', 'channels', 'member', 'outsider'];
const stamp = Date.now().toString(36);
const PNG = Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), Buffer.alloc(32)]);
const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(16)]);

function multipartBody(content: Buffer): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----scale${Math.random().toString(16).slice(2)}`;
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

type Detail = {
  community: { iconUpdatedAt: string | null; bannerUpdatedAt: string | null };
  categories: Array<{ id: string; name: string; position: number }>;
  channels: Array<{ id: string; name: string; position: number; categoryId: string | null }>;
};

describe('sameSet', () => {
  it('exige os mesmos ids sem repeticao', () => {
    expect(sameSet(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameSet(['a', 'a'], ['a', 'b'])).toBe(false);
    expect(sameSet(['a'], ['a', 'b'])).toBe(false);
    expect(sameSet([], [])).toBe(true);
  });
});

describe('comunidades: imagens, categorias e ordem', () => {
  let app: FastifyInstance;
  let communityId = '';
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const cookieOf = (who: Who) => ({ cookie: `token=${users[who].token}` });
  const inject = (who: Who, method: InjectOptions['method'], url: string, payload?: object) =>
    app.inject({ method, url, headers: cookieOf(who), ...(payload === undefined ? {} : { payload }) });
  const putImage = (who: Who, kind: string, content: Buffer) => {
    const body = multipartBody(content);
    return app.inject({ method: 'PUT', url: `/api/communities/${communityId}/${kind}`, headers: { ...cookieOf(who), ...body.headers }, payload: body.payload });
  };
  const detail = async (): Promise<Detail> => (await inject('owner', 'GET', `/api/communities/${communityId}`)).json() as Detail;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
    await app.register(communityRoutes);
    await app.register(communityExtrasRoutes);
    await app.ready();
    for (const who of names) {
      const email = `extras-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });

  beforeEach(async () => {
    for (const who of names) resetProfileUpdateRateLimit(`community-media:${users[who].id}`);
    const created = await inject('owner', 'POST', '/api/communities', { name: 'Extras' });
    communityId = (created.json() as { community: { id: string } }).community.id;
    const role = await prisma.communityCustomRole.create({ data: { communityId, name: 'Canais', color: '#123456', manageChannels: true } });
    await prisma.communityMember.createMany({ data: [
      { communityId, userId: users.admin.id, role: 'ADMIN' },
      { communityId, userId: users.channels.id, role: 'MEMBER', customRoleId: role.id },
      { communityId, userId: users.member.id, role: 'MEMBER' },
    ] });
  });

  afterAll(async () => {
    const owned = await prisma.community.findMany({ where: { ownerId: users.owner.id }, select: { id: true } });
    for (const c of owned) await inject('owner', 'DELETE', `/api/communities/${c.id}`);
    await prisma.user.deleteMany({ where: { email: { in: names.map((who) => users[who].email) } } });
    await app.close();
  });

  it('icone: ADMIN envia, membro le com Content-Type, membro comum e cargo de canais nao enviam, de fora nao ve', async () => {
    const put = await putImage('admin', 'icon', PNG);
    expect(put.statusCode).toBe(200);
    expect((put.json() as { iconUpdatedAt: string }).iconUpdatedAt).toBeTruthy();
    expect((await detail()).community.iconUpdatedAt).toBeTruthy();
    const list = (await inject('member', 'GET', '/api/communities')).json() as { communities: Array<{ id: string; iconUpdatedAt: string | null }> };
    expect(list.communities.find((c) => c.id === communityId)?.iconUpdatedAt).toBeTruthy();

    const get = await inject('member', 'GET', `/api/communities/${communityId}/icon`);
    expect(get.statusCode).toBe(200);
    expect(get.headers['content-type']).toBe('image/png');
    expect(get.headers['x-content-type-options']).toBe('nosniff');
    expect((await inject('outsider', 'GET', `/api/communities/${communityId}/icon`)).statusCode).toBe(404);
    expect((await putImage('member', 'icon', PNG)).statusCode).toBe(403);
    expect((await putImage('channels', 'icon', PNG)).statusCode).toBe(403);
    expect((await putImage('outsider', 'icon', PNG)).statusCode).toBe(404);
    expect((await inject('member', 'DELETE', `/api/communities/${communityId}/icon`)).statusCode).toBe(403);
  });

  it('banner: recusa formato fora da lista e troca apaga o arquivo antigo', async () => {
    expect((await putImage('owner', 'banner', WAV)).statusCode).toBe(400);
    expect((await putImage('owner', 'banner', PNG)).statusCode).toBe(200);
    const first = (await prisma.community.findUniqueOrThrow({ where: { id: communityId } })).bannerPath!;
    expect((await putImage('owner', 'banner', PNG)).statusCode).toBe(200);
    const second = (await prisma.community.findUniqueOrThrow({ where: { id: communityId } })).bannerPath!;
    expect(second).not.toBe(first);
    await expect(fs.access(path.resolve(process.cwd(), first))).rejects.toThrow();
    const del = await inject('owner', 'DELETE', `/api/communities/${communityId}/banner`);
    expect(del.statusCode).toBe(200);
    await expect(fs.access(path.resolve(process.cwd(), second))).rejects.toThrow();
    expect((await detail()).community.bannerUpdatedAt).toBeNull();
    expect((await inject('member', 'GET', `/api/communities/${communityId}/banner`)).statusCode).toBe(404);
    expect((await inject('owner', 'GET', `/api/communities/${communityId}/outro`)).statusCode).toBe(400);
  });

  it('categorias: cargo com manageChannels cria/renomeia/apaga; membro comum nao; apagar solta os canais', async () => {
    expect((await inject('member', 'POST', `/api/communities/${communityId}/categories`, { name: 'X' })).statusCode).toBe(403);
    expect((await inject('channels', 'POST', `/api/communities/${communityId}/categories`, { name: '  ' })).statusCode).toBe(400);
    const created = await inject('channels', 'POST', `/api/communities/${communityId}/categories`, { name: 'Jogos' });
    expect(created.statusCode).toBe(201);
    const categoryId = (created.json() as { category: { id: string } }).category.id;
    expect((await inject('channels', 'PATCH', `/api/community-categories/${categoryId}`, { name: 'Partidas' })).statusCode).toBe(200);
    expect((await inject('outsider', 'PATCH', `/api/community-categories/${categoryId}`, { name: 'Y' })).statusCode).toBe(404);

    const before = await detail();
    expect(before.categories).toEqual([{ id: categoryId, name: 'Partidas', position: 0 }]);
    const [geral, voz] = before.channels;
    const layout = { categories: [categoryId], channels: [{ id: voz.id, categoryId }, { id: geral.id, categoryId: null }] };
    expect((await inject('member', 'PUT', `/api/communities/${communityId}/layout`, layout)).statusCode).toBe(403);
    expect((await inject('channels', 'PUT', `/api/communities/${communityId}/layout`, layout)).statusCode).toBe(200);
    const after = await detail();
    expect(after.channels.map((c) => [c.id, c.position, c.categoryId])).toEqual([[voz.id, 0, categoryId], [geral.id, 1, null]]);

    expect((await inject('member', 'DELETE', `/api/community-categories/${categoryId}`)).statusCode).toBe(403);
    expect((await inject('admin', 'DELETE', `/api/community-categories/${categoryId}`)).statusCode).toBe(200);
    const final = await detail();
    expect(final.categories).toEqual([]);
    expect(final.channels.every((c) => c.categoryId === null)).toBe(true);
    expect(final.channels).toHaveLength(2);
  });

  it('layout: recusa lista incompleta, repetida ou com categoria de outra comunidade', async () => {
    const { channels } = await detail();
    const url = `/api/communities/${communityId}/layout`;
    expect((await inject('owner', 'PUT', url, { categories: [], channels: [{ id: channels[0].id, categoryId: null }] })).statusCode).toBe(409);
    expect((await inject('owner', 'PUT', url, { categories: [], channels: [channels[0], channels[0]].map((c) => ({ id: c.id, categoryId: null })) })).statusCode).toBe(409);
    const other = await prisma.community.create({ data: { name: 'Outra', ownerId: users.outsider.id, categories: { create: { name: 'Alheia' } } }, include: { categories: true } });
    const foreign = other.categories[0].id;
    expect((await inject('owner', 'PUT', url, { categories: [foreign], channels: channels.map((c) => ({ id: c.id, categoryId: foreign })) })).statusCode).toBe(409);
    expect((await inject('owner', 'PUT', url, { categories: [], channels: channels.map((c) => ({ id: c.id, categoryId: foreign })) })).statusCode).toBe(409);
    expect((await inject('owner', 'PUT', url, { categories: [], channels: [{ id: 'x', categoryId: null }] })).statusCode).toBe(400);
    await prisma.community.delete({ where: { id: other.id } });
  });

  it('canal novo entra no fim mesmo depois de reordenar', async () => {
    const { channels } = await detail();
    await inject('owner', 'PUT', `/api/communities/${communityId}/layout`, { categories: [], channels: [...channels].reverse().map((c) => ({ id: c.id, categoryId: null })) });
    await inject('owner', 'DELETE', `/api/channels/${channels[1].id}`);
    const created = await inject('owner', 'POST', `/api/communities/${communityId}/channels`, { name: 'novo', kind: 'TEXT' });
    expect(created.statusCode).toBe(201);
    const after = await detail();
    expect(after.channels[after.channels.length - 1].name).toBe('novo');
  });
});
