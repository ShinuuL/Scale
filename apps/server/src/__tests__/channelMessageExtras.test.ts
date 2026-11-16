/**
 * Fase 2 das comunidades: responder (replyToId), reacoes (toggle, conjunto fixo)
 * e mensagens fixadas (manageMessages, limite por canal).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { MAX_PINNED_PER_CHANNEL } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetChannelReactionRateLimit, resetChatRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { channelMessageExtrasRoutes } from '../routes/channelMessageExtras.js';
import { excerptOf } from '../lib/channelMessageMeta.js';

type Who = 'owner' | 'mod' | 'member' | 'outsider';
const names: Who[] = ['owner', 'mod', 'member', 'outsider'];
const stamp = Date.now().toString(36);

type Msg = {
  id: string;
  replyTo: { id: string; authorName: string; excerpt: string; deleted: boolean } | null;
  reactions: Array<{ reaction: string; userIds: string[] }>;
  pinnedAt: string | null;
};

describe('excerptOf', () => {
  it('junta linhas e corta textos longos', () => {
    expect(excerptOf('a\n\n b')).toBe('a b');
    expect(excerptOf('x'.repeat(300)).length).toBe(120);
  });
});

describe('canais: responder, reagir e fixar', () => {
  let app: FastifyInstance;
  let communityId = '';
  let channelId = '';
  const users = {} as Record<Who, { id: string; token: string; email: string }>;
  const inject = (who: Who, method: InjectOptions['method'], url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: `token=${users[who].token}` }, ...(payload === undefined ? {} : { payload }) });
  const send = async (who: Who, content: string, replyToId?: string) =>
    inject(who, 'POST', `/api/channels/${channelId}/messages`, replyToId ? { content, replyToId } : { content });
  const list = async (): Promise<Msg[]> =>
    ((await inject('member', 'GET', `/api/channels/${channelId}/messages`)).json() as { messages: Msg[] }).messages;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.register(channelMessageExtrasRoutes);
    await app.ready();
    for (const who of names) {
      const email = `f2-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });

  beforeEach(async () => {
    for (const who of names) {
      resetChatRateLimit(`user:${users[who].id}`);
      resetChannelReactionRateLimit(`user:${users[who].id}`);
    }
    const created = await inject('owner', 'POST', '/api/communities', { name: 'F2' });
    communityId = (created.json() as { community: { id: string } }).community.id;
    const role = await prisma.communityCustomRole.create({ data: { communityId, name: 'Mod', color: '#123456', manageMessages: true } });
    await prisma.communityMember.createMany({ data: [
      { communityId, userId: users.mod.id, role: 'MEMBER', customRoleId: role.id },
      { communityId, userId: users.member.id, role: 'MEMBER' },
    ] });
    const channel = await inject('owner', 'POST', `/api/communities/${communityId}/channels`, { name: 'geral', kind: 'TEXT' });
    channelId = (channel.json() as { channel: { id: string } }).channel.id;
  });

  afterAll(async () => {
    const owned = await prisma.community.findMany({ where: { ownerId: users.owner.id }, select: { id: true } });
    for (const c of owned) await inject('owner', 'DELETE', `/api/communities/${c.id}`);
    await prisma.user.deleteMany({ where: { email: { in: names.map((who) => users[who].email) } } });
    await app.close();
  });

  it('resposta guarda a citacao (autor + trecho) e vira "apagada" quando a original some', async () => {
    const original = (await send('owner', 'Bom dia a todos')).json() as { message: Msg };
    const answer = await send('member', 'Bom dia!', original.message.id);
    expect(answer.statusCode).toBe(201);
    expect((answer.json() as { message: Msg }).message.replyTo).toEqual({ id: original.message.id, authorName: 'owner', excerpt: 'Bom dia a todos', deleted: false });
    expect((await send('member', 'x', '00000000-0000-4000-8000-000000000000')).statusCode).toBe(400);
    await inject('owner', 'DELETE', `/api/channels/${channelId}/messages/${original.message.id}`);
    const reply = (await list()).find((m) => m.replyTo)!;
    expect(reply.replyTo).toMatchObject({ deleted: true, excerpt: '' });
  });

  it('reacao: toggle, conjunto fixo, quem reagiu, de fora nao ve, apagada recusa', async () => {
    const { message } = (await send('owner', 'oi')).json() as { message: Msg };
    const url = `/api/channels/${channelId}/messages/${message.id}/reactions`;
    expect((await inject('member', 'POST', url, { reaction: 'smile' })).statusCode).toBe(400);
    expect((await inject('outsider', 'POST', url, { reaction: 'like' })).statusCode).toBe(404);
    expect((await inject('member', 'POST', url, { reaction: 'like' })).json()).toMatchObject({ userIds: [users.member.id] });
    expect((await inject('mod', 'POST', url, { reaction: 'like' })).json()).toMatchObject({ userIds: [users.member.id, users.mod.id] });
    await inject('owner', 'POST', url, { reaction: 'heart' });
    expect((await list())[0]?.reactions).toEqual([
      { reaction: 'like', userIds: [users.member.id, users.mod.id] },
      { reaction: 'heart', userIds: [users.owner.id] },
    ]);
    expect((await inject('member', 'POST', url, { reaction: 'like' })).json()).toMatchObject({ userIds: [users.mod.id] });
    await inject('owner', 'DELETE', `/api/channels/${channelId}/messages/${message.id}`);
    expect((await list())[0]?.reactions).toEqual([]);
    expect((await inject('member', 'POST', url, { reaction: 'like' })).statusCode).toBe(400);
  });

  it('reacao tem limite por usuario', async () => {
    const { message } = (await send('owner', 'oi')).json() as { message: Msg };
    const url = `/api/channels/${channelId}/messages/${message.id}/reactions`;
    for (let i = 0; i < 20; i++) expect((await inject('member', 'POST', url, { reaction: 'star' })).statusCode).toBe(200);
    expect((await inject('member', 'POST', url, { reaction: 'star' })).statusCode).toBe(429);
  });

  it('fixar exige manageMessages; painel lista as fixadas; limite por canal', async () => {
    const { message } = (await send('member', 'regras')).json() as { message: Msg };
    const pin = `/api/channels/${channelId}/messages/${message.id}/pin`;
    expect((await inject('member', 'PUT', pin)).statusCode).toBe(403);
    expect((await inject('outsider', 'PUT', pin)).statusCode).toBe(404);
    const pinned = await inject('mod', 'PUT', pin);
    expect(pinned.statusCode).toBe(200);
    expect((pinned.json() as { pinnedAt: string | null }).pinnedAt).toBeTruthy();
    const pins = (await inject('member', 'GET', `/api/channels/${channelId}/pins`)).json() as { messages: Msg[] };
    expect(pins.messages.map((m) => m.id)).toEqual([message.id]);
    expect((await list())[0]?.pinnedAt).toBeTruthy();
    expect((await inject('owner', 'DELETE', pin)).json()).toMatchObject({ pinnedAt: null });
    expect(((await inject('member', 'GET', `/api/channels/${channelId}/pins`)).json() as { messages: Msg[] }).messages).toEqual([]);

    const now = new Date();
    await prisma.chatMessage.createMany({ data: Array.from({ length: MAX_PINNED_PER_CHANNEL }, (_, i) => ({ roomId: channelId, authorId: users.owner.id, content: `p${i}`, pinnedAt: now })) });
    expect((await inject('owner', 'PUT', pin)).statusCode).toBe(409);
  });
});
