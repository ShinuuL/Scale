/** Fase 2: busca de mensagens (GET /api/communities/:id/search). */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetMessageSearchRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { communitySearchRoutes } from '../routes/communitySearch.js';

type Who = 'owner' | 'member' | 'outsider';
const names: Who[] = ['owner', 'member', 'outsider'];
const stamp = Date.now().toString(36);
type Res = { results: Array<{ id: string; channelId: string; channelName: string; author: { id: string | null; name: string }; content: string }>; nextCursor: string | null };

describe('busca de mensagens da comunidade', () => {
  let app: FastifyInstance;
  let communityId = '';
  let geral = '';
  let outro = '';
  let voz = '';
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const get = (who: Who, qs: string) => app.inject({ method: 'GET', url: `/api/communities/${communityId}/search?${qs}`, headers: { cookie: `token=${users[who].token}` } });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.register(communitySearchRoutes);
    await app.ready();
    for (const who of names) {
      const email = `search-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });

  beforeEach(async () => {
    for (const who of names) resetMessageSearchRateLimit(users[who].id);
    const created = await app.inject({ method: 'POST', url: '/api/communities', headers: { cookie: `token=${users.owner.token}` }, payload: { name: 'Busca' } });
    communityId = (created.json() as { community: { id: string } }).community.id;
    await prisma.communityMember.create({ data: { communityId, userId: users.member.id, role: 'MEMBER' } });
    const rooms = await prisma.room.findMany({ where: { communityId }, orderBy: { position: 'asc' } });
    geral = rooms.find((r) => r.channelKind === 'TEXT')!.id;
    voz = rooms.find((r) => r.channelKind === 'VOICE')!.id;
    outro = (await prisma.room.create({ data: { communityId, name: 'outro', channelKind: 'TEXT', isPersistent: true, isPrivate: true, position: 2 } })).id;
    const t = Date.now() - 60_000;
    await prisma.chatMessage.createMany({ data: [
      { roomId: geral, authorId: users.owner.id, content: 'Reunião de AÇÃO amanhã', createdAt: new Date(t) },
      { roomId: outro, authorId: users.member.id, content: 'a acao foi boa', createdAt: new Date(t + 1000) },
      { roomId: geral, authorId: users.member.id, content: 'acao apagada', deletedAt: new Date(), createdAt: new Date(t + 2000) },
      { roomId: voz, authorId: users.member.id, content: 'acao na voz', createdAt: new Date(t + 3000) },
      { roomId: geral, authorId: users.member.id, content: 'nada a ver', createdAt: new Date(t + 4000) },
    ] });
  });

  afterAll(async () => {
    const owned = await prisma.community.findMany({ where: { ownerId: users.owner.id }, select: { id: true } });
    for (const c of owned) await prisma.community.delete({ where: { id: c.id } });
    await prisma.user.deleteMany({ where: { email: { in: names.map((who) => users[who].email) } } });
    await app.close();
  });

  it('acha sem caixa e sem acento, em todos os canais de texto, ignorando apagadas e voz', async () => {
    const res = await get('member', 'q=acao');
    expect(res.statusCode).toBe(200);
    const body = res.json() as Res;
    expect(body.results.map((r) => r.content)).toEqual(['a acao foi boa', 'Reunião de AÇÃO amanhã']);
    expect(body.results[0]?.channelName).toBe('outro');
    expect(body.nextCursor).toBeNull();
  });

  it('filtra por canal, autor e datas', async () => {
    expect(((await get('member', `q=acao&channelId=${geral}`)).json() as Res).results).toHaveLength(1);
    expect(((await get('member', `q=acao&authorId=${users.member.id}`)).json() as Res).results.map((r) => r.content)).toEqual(['a acao foi boa']);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(((await get('member', `q=acao&from=${encodeURIComponent(future)}`)).json() as Res).results).toHaveLength(0);
    expect((await get('member', `q=acao&channelId=${voz}`)).statusCode).toBe(404);
  });

  it('valida entrada, esconde de quem nao e membro e limita por usuario', async () => {
    expect((await get('member', 'q=a')).statusCode).toBe(400);
    expect((await get('member', `q=${'x'.repeat(101)}`)).statusCode).toBe(400);
    expect((await get('outsider', 'q=acao')).statusCode).toBe(404);
    for (let i = 0; i < 30; i++) await get('owner', 'q=acao');
    expect((await get('owner', 'q=acao')).statusCode).toBe(429);
  });

  it('pagina com cursor de 25 em 25', async () => {
    const base = Date.now() - 30_000;
    await prisma.chatMessage.createMany({ data: Array.from({ length: 30 }, (_, i) => ({ roomId: geral, authorId: users.owner.id, content: `lote ${i}`, createdAt: new Date(base + i) })) });
    const first = (await get('member', 'q=lote')).json() as Res;
    expect(first.results).toHaveLength(25);
    expect(first.nextCursor).toBeTruthy();
    const second = (await get('member', `q=lote&cursor=${first.nextCursor}`)).json() as Res;
    expect(second.results).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.results, ...second.results].map((r) => r.id)).size).toBe(30);
  });
});
