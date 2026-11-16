/**
 * Fase 4: topicos (threads) em canal de texto de comunidade.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify';
import cookie from '@fastify/cookie';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetChatRateLimit } from '../lib/rateLimit.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { channelSettingsRoutes } from '../routes/channelSettings.js';
import { channelThreadRoutes } from '../routes/channelThreads.js';

type Who = 'owner' | 'member' | 'outsider';
const names: Who[] = ['owner', 'member', 'outsider'];
const stamp = Date.now().toString(36);
interface Thread { id: string; name: string; replyCount: number; archivedAt: string | null; rootMessageId: string }
interface Message { id: string; threadId: string | null; thread: Thread | null }

describe('topicos de canal', () => {
  let app: FastifyInstance;
  let communityId = '';
  let channelId = '';
  let rootId = '';
  const users = {} as Record<Who, { id: string; token: string }>;
  const inject = (who: Who, method: InjectOptions['method'], url: string, payload?: object) =>
    app.inject({ method, url, headers: { cookie: `token=${users[who].token}` }, ...(payload === undefined ? {} : { payload }) });
  const open = (who: Who, name = 'Discussao', messageId = rootId) => inject(who, 'POST', `/api/channels/${channelId}/messages/${messageId}/thread`, { name });
  const openThread = async (): Promise<Thread> => (((await open('owner')).json()) as { thread: Thread }).thread;
  const reply = (who: Who, threadId: string, content = 'no topico') => inject(who, 'POST', `/api/threads/${threadId}/messages`, { content });
  const settings = (payload: object) => inject('owner', 'PUT', `/api/channels/${channelId}/settings`, payload);

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.register(channelSettingsRoutes);
    await app.register(channelThreadRoutes);
    await app.ready();
    for (const who of names) {
      const email = `f4t-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, token: signToken({ userId: user.id, email, name: who }) };
    }
  });

  beforeEach(async () => {
    for (const who of names) resetChatRateLimit(`user:${users[who].id}`);
    const created = await inject('owner', 'POST', '/api/communities', { name: 'F4' });
    communityId = (created.json() as { community: { id: string } }).community.id;
    await prisma.communityMember.create({ data: { communityId, userId: users.member.id, role: 'MEMBER' } });
    const channel = await inject('owner', 'POST', `/api/communities/${communityId}/channels`, { name: 'texto', kind: 'TEXT' });
    channelId = (channel.json() as { channel: { id: string } }).channel.id;
    rootId = ((await inject('member', 'POST', `/api/channels/${channelId}/messages`, { content: 'origem' })).json() as { message: { id: string } }).message.id;
  });

  afterAll(async () => {
    await prisma.community.deleteMany({ where: { ownerId: users.owner.id } });
    await prisma.user.deleteMany({ where: { id: { in: names.map((w) => users[w].id) } } });
    await app.close();
  });

  it('abre topico com nome valido; um por mensagem; nao membro = 404', async () => {
    expect((await open('member', '   ')).statusCode).toBe(400);
    expect((await open('member', 'x'.repeat(81))).statusCode).toBe(400);
    expect((await open('outsider')).statusCode).toBe(404);
    const created = await open('member', '  Plano  ');
    expect(created.statusCode).toBe(201);
    expect((created.json() as { thread: Thread }).thread).toMatchObject({ name: 'Plano', replyCount: 0, archivedAt: null, rootMessageId: rootId });
    expect((await open('owner', 'outro')).statusCode).toBe(409);
  });

  it('mensagens do topico ficam fora do canal; origem mostra a contagem', async () => {
    const thread = await openThread();
    const sent = await reply('member', thread.id);
    expect(sent.statusCode).toBe(201);
    expect((sent.json() as { message: Message }).message.threadId).toBe(thread.id);
    await reply('owner', thread.id, 'segunda');
    const channel = (await inject('member', 'GET', `/api/channels/${channelId}/messages`)).json() as { messages: Message[] };
    expect(channel.messages).toHaveLength(1);
    expect(channel.messages[0]?.thread).toMatchObject({ id: thread.id, replyCount: 2 });
    const history = (await inject('member', 'GET', `/api/threads/${thread.id}/messages?limit=1`)).json() as { messages: Message[]; nextCursor: string | null };
    expect(history.messages).toHaveLength(1);
    expect(history.nextCursor).not.toBeNull();
    const older = (await inject('member', 'GET', `/api/threads/${thread.id}/messages?limit=1&cursor=${history.nextCursor}`)).json() as { messages: Message[] };
    expect(older.messages).toHaveLength(1);
    expect(older.messages[0]?.id).not.toBe(history.messages[0]?.id);
    expect((await inject('outsider', 'GET', `/api/threads/${thread.id}/messages`)).statusCode).toBe(404);
    // Mensagem de topico nao vira origem de outro topico nem cursor do canal.
    expect((await open('owner', 'x', history.messages[0]!.id)).statusCode).toBe(404);
    expect((await inject('member', 'GET', `/api/channels/${channelId}/messages?cursor=${history.messages[0]!.id}`)).statusCode).toBe(404);
  });

  it('arquivar: so quem gerencia mensagens; arquivado nao aceita envio', async () => {
    const thread = await openThread();
    expect((await inject('member', 'PATCH', `/api/threads/${thread.id}`, { archived: true })).statusCode).toBe(403);
    const archived = await inject('owner', 'PATCH', `/api/threads/${thread.id}`, { archived: true });
    expect(archived.statusCode).toBe(200);
    expect((archived.json() as { thread: Thread }).thread.archivedAt).not.toBeNull();
    expect((await reply('member', thread.id)).statusCode).toBe(409);
    expect(((await inject('member', 'GET', `/api/threads/${thread.id}`)).json() as { canSend: boolean }).canSend).toBe(false);
    await inject('owner', 'PATCH', `/api/threads/${thread.id}`, { archived: false });
    expect((await reply('member', thread.id)).statusCode).toBe(201);
  });

  it('herda permissoes do canal: oculto = 404, aviso = 403, modo lento = 429, castigo = 403', async () => {
    const thread = await openThread();
    await settings({ announcement: true, slowModeSeconds: 0, overrides: [] });
    expect((await reply('member', thread.id)).statusCode).toBe(403);
    expect((await reply('owner', thread.id)).statusCode).toBe(201);
    await settings({ announcement: false, slowModeSeconds: 60, overrides: [] });
    expect((await reply('member', thread.id)).statusCode).toBe(429);
    await settings({ announcement: false, slowModeSeconds: 0, overrides: [{ target: 'everyone', viewChannel: false, sendMessages: null }] });
    expect((await inject('member', 'GET', `/api/threads/${thread.id}`)).statusCode).toBe(404);
    expect((await reply('member', thread.id)).statusCode).toBe(404);
    await settings({ announcement: false, slowModeSeconds: 0, overrides: [] });
    await prisma.communityMember.update({ where: { communityId_userId: { communityId, userId: users.member.id } }, data: { timeoutUntil: new Date(Date.now() + 60_000) } });
    expect((await reply('member', thread.id)).statusCode).toBe(403);
    expect((await open('member', 'novo', (await prisma.chatMessage.create({ data: { roomId: channelId, authorId: users.owner.id, content: 'x' } })).id)).statusCode).toBe(403);
  });
});
