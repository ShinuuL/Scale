import { createHash, randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, type Socket } from 'socket.io-client';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetChatRateLimit, resetMcpCallRateLimit } from '../lib/rateLimit.js';
import { _resetOAuthCodes } from '../lib/oauthServer.js';
import { authPlugin } from '../plugins/auth.js';
import { communityRoutes } from '../routes/communities.js';
import { communityModerationRoutes } from '../routes/communityModeration.js';
import { roomRoutes } from '../routes/rooms.js';
import { messagesRoutes } from '../routes/messages.js';
import { mcpOAuthRoutes } from '../routes/mcpOAuth.js';
import { mcpRoutes } from '../routes/mcp.js';
import { createSocketServer } from '../socket/handler.js';

const stamp = Date.now().toString(36);
const REDIRECT = 'http://127.0.0.1:33418/callback';

type Json = Record<string, unknown>;
type ToolText = { result?: { content: Array<{ text: string }>; isError?: boolean; tools?: Array<{ name: string }> }; error?: { code: number } };

describe('servidor MCP e apps conectados', () => {
  let app: FastifyInstance;
  let port: number;
  const users = {} as Record<'owner' | 'member', { id: string; token: string; email: string }>;
  const sockets: Socket[] = [];
  const communityIds: string[] = [];
  const roomIds: string[] = [];

  const asUser = (who: 'owner' | 'member') => ({ cookie: `token=${users[who].token}` });
  const pkce = () => {
    const verifier = randomBytes(32).toString('base64url');
    return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
  };

  async function registerClient(name = 'Assistente Teste'): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/oauth/register', payload: { client_name: name, redirect_uris: [REDIRECT] } });
    expect(res.statusCode).toBe(201);
    return (res.json() as { client_id: string }).client_id;
  }

  /** Fluxo completo: consentimento -> codigo -> token. */
  async function connect(who: 'owner' | 'member', scope?: string): Promise<{ access: string; refresh: string; clientId: string }> {
    const clientId = await registerClient();
    const { verifier, challenge } = pkce();
    const params = { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', ...(scope ? { scope } : {}) };
    const decision = await app.inject({ method: 'POST', url: '/api/oauth/authorize/decision', headers: asUser(who), payload: { ...params, approve: true } });
    expect(decision.statusCode).toBe(200);
    const redirectTo = new URL((decision.json() as { redirectTo: string }).redirectTo);
    expect(redirectTo.searchParams.get('state')).toBe('xyz');
    const code = redirectTo.searchParams.get('code')!;
    const token = await app.inject({
      method: 'POST', url: '/api/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier }).toString(),
    });
    expect(token.statusCode).toBe(200);
    const body = token.json() as { access_token: string; refresh_token: string };
    return { access: body.access_token, refresh: body.refresh_token, clientId };
  }

  let rpcId = 0;
  const rpc = (access: string, method: string, params: Json = {}) =>
    app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${access}` }, payload: { jsonrpc: '2.0', id: ++rpcId, method, params } });
  const call = async (access: string, name: string, args: Json) => (await rpc(access, 'tools/call', { name, arguments: args })).json() as ToolText;

  async function createCommunity(): Promise<{ id: string; textChannelId: string }> {
    const res = await app.inject({ method: 'POST', url: '/api/communities', headers: asUser('owner'), payload: { name: 'Comunidade MCP' } });
    const id = (res.json() as { community: { id: string } }).community.id;
    communityIds.push(id);
    const detail = (await app.inject({ method: 'GET', url: `/api/communities/${id}`, headers: asUser('owner') })).json() as { channels: Array<{ id: string; kind: string }> };
    return { id, textChannelId: detail.channels.find((c) => c.kind === 'TEXT')!.id };
  }

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.PUBLIC_URL = 'https://scale.exemplo.com';
    resetEnv();
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(communityRoutes);
    await app.register(communityModerationRoutes);
    await app.register(roomRoutes);
    await app.register(messagesRoutes);
    await app.register(mcpOAuthRoutes);
    await app.register(mcpRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const server: HttpServer = app.server;
    (app as unknown as { io: unknown }).io = createSocketServer(server);
    const address = server.address();
    port = address && typeof address === 'object' ? address.port : 0;
    for (const who of ['owner', 'member'] as const) {
      const email = `mcp-${who}-${stamp}@exemplo.com`;
      const user = await prisma.user.create({ data: { email, passwordHash: 'x', name: who } });
      users[who] = { id: user.id, email, token: signToken({ userId: user.id, email, name: who }) };
    }
  });
  beforeEach(() => {
    _resetOAuthCodes();
    for (const who of ['owner', 'member'] as const) resetChatRateLimit(`user:${users[who].id}`);
  });
  afterEach(async () => {
    for (const s of sockets.splice(0)) s.disconnect();
    await prisma.community.deleteMany({ where: { id: { in: communityIds.splice(0) } } });
    await prisma.room.deleteMany({ where: { id: { in: roomIds.splice(0) } } });
  });
  afterAll(async () => {
    delete process.env.PUBLIC_URL;
    await prisma.oAuthClient.deleteMany({});
    await prisma.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
    await app.close();
  });

  it('publica os metadados de descoberta', async () => {
    const pr = (await app.inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })).json() as Json;
    expect(pr.resource).toBe('https://scale.exemplo.com/mcp');
    const as = (await app.inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' })).json() as Json;
    expect(as.authorization_endpoint).toBe('https://scale.exemplo.com/oauth/authorize');
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
  });

  it('sem token responde 401 com o endereco dos metadados', async () => {
    const res = await app.inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata="https://scale.exemplo.com/.well-known/oauth-protected-resource"');
    const bad = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: 'Bearer scl_at_inventado' }, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(bad.statusCode).toBe(401);
    // A sessao do navegador (JWT) nao vale como token MCP.
    const jwt = await app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${users.owner.token}` }, payload: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    expect(jwt.statusCode).toBe(401);
  });

  it('recusa redirect nao registrado, http publico e PKCE errado', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/oauth/register', payload: { client_name: 'x', redirect_uris: ['http://evil.example/cb'] } })).statusCode).toBe(400);
    const clientId = await registerClient();
    const { challenge } = pkce();
    const base = { response_type: 'code', client_id: clientId, code_challenge: challenge, code_challenge_method: 'S256' };
    const info = await app.inject({ method: 'GET', url: `/api/oauth/authorize/info?${new URLSearchParams({ ...base, redirect_uri: 'https://outro.example/cb' })}`, headers: asUser('owner') });
    expect(info.statusCode).toBe(400);
    expect((info.json() as Json).error).toBe('invalid_redirect');
    const noLogin = await app.inject({ method: 'GET', url: `/api/oauth/authorize/info?${new URLSearchParams({ ...base, redirect_uri: REDIRECT })}` });
    expect(noLogin.statusCode).toBe(401);

    const decision = await app.inject({ method: 'POST', url: '/api/oauth/authorize/decision', headers: asUser('owner'), payload: { ...base, redirect_uri: REDIRECT, approve: true } });
    const code = new URL((decision.json() as { redirectTo: string }).redirectTo).searchParams.get('code')!;
    const token = await app.inject({
      method: 'POST', url: '/api/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pkce().verifier }).toString(),
    });
    expect(token.statusCode).toBe(400);
    expect((token.json() as Json).error).toBe('invalid_grant');
  });

  it('cancelar devolve access_denied sem criar conexao', async () => {
    const clientId = await registerClient();
    const res = await app.inject({
      method: 'POST', url: '/api/oauth/authorize/decision', headers: asUser('member'),
      payload: { response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, code_challenge: pkce().challenge, code_challenge_method: 'S256', approve: false },
    });
    expect(new URL((res.json() as { redirectTo: string }).redirectTo).searchParams.get('error')).toBe('access_denied');
    expect(await prisma.oAuthGrant.count({ where: { clientId } })).toBe(0);
  });

  it('envia no canal como o usuario com selo via app e lista so ferramentas do escopo', async () => {
    const { id, textChannelId } = await createCommunity();
    const { access } = await connect('owner', 'channels');
    const init = (await rpc(access, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })).json() as { result: { protocolVersion: string } };
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const tools = ((await rpc(access, 'tools/list')).json() as ToolText).result!.tools!.map((t) => t.name);
    expect(tools).toContain('send_channel_message');
    expect(tools).not.toContain('create_channel');

    const sent = await call(access, 'send_channel_message', { channelId: textChannelId, content: 'ola do assistente' });
    expect(sent.result!.isError).toBeFalsy();
    const row = await prisma.chatMessage.findFirstOrThrow({ where: { roomId: textChannelId, content: 'ola do assistente' } });
    expect(row.authorId).toBe(users.owner.id);
    expect(row.viaApp).toBe('Assistente Teste');
    const history = (await app.inject({ method: 'GET', url: `/api/channels/${textChannelId}/messages`, headers: asUser('owner') })).json() as { messages: Array<{ content: string; viaApp: string | null }> };
    expect(history.messages.find((m) => m.content === 'ola do assistente')?.viaApp).toBe('Assistente Teste');

    // Sem o escopo de configuracao, a ferramenta e recusada mesmo chamada direto.
    const denied = await call(access, 'create_channel', { communityId: id, name: 'novo', kind: 'TEXT' });
    expect(denied.result!.isError).toBe(true);
  });

  it('nunca tem mais poder que o usuario: membro comum nao cria canal', async () => {
    const { id } = await createCommunity();
    const invite = (await app.inject({ method: 'POST', url: `/api/communities/${id}/invites`, headers: asUser('owner'), payload: { expiresIn: '7d' } })).json() as { invite: { code: string } };
    expect((await app.inject({ method: 'POST', url: '/api/invites/accept', headers: asUser('member'), payload: { code: invite.invite.code } })).statusCode).toBe(200);
    const member = await connect('member');
    const res = await call(member.access, 'create_channel', { communityId: id, name: 'proibido', kind: 'TEXT' });
    expect(res.result!.isError).toBe(true);
    const owner = await connect('owner');
    const ok = await call(owner.access, 'create_channel', { communityId: id, name: 'via-ia', kind: 'TEXT' });
    expect(ok.result!.isError).toBeFalsy();
    const audit = (await app.inject({ method: 'GET', url: `/api/communities/${id}/audit`, headers: asUser('owner') })).json() as { entries: Array<{ viaApp: string | null }> };
    expect(audit.entries.some((e) => e.viaApp === 'Assistente Teste')).toBe(true);
  });

  it('chat de sala so com o usuario dentro dela, marcado via app', async () => {
    const room = await prisma.room.create({ data: { name: 'Sala MCP', isPersistent: true, ownerId: users.owner.id } });
    roomIds.push(room.id);
    const { access } = await connect('owner', 'room.chat');
    const outside = await call(access, 'send_room_chat', { roomId: room.id, content: 'oi' });
    expect(outside.result!.isError).toBe(true);

    const socket = ioClient(`http://127.0.0.1:${port}`, { transports: ['websocket'], extraHeaders: { cookie: `token=${users.owner.token}` } });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once('connect', () => resolve()); socket.once('connect_error', reject); });
    const joined = await new Promise<Json>((resolve) => socket.emit('join-room', { roomId: room.id }, resolve));
    expect(joined.error).toBeUndefined();
    const received = new Promise<Json>((resolve) => socket.once('chat:message', resolve));

    const listed = await call(access, 'list_my_voice_rooms', {});
    expect(listed.result!.content[0]!.text).toContain(room.id);
    const sent = await call(access, 'send_room_chat', { roomId: room.id, content: 'mensagem da ia' });
    expect(sent.result!.isError).toBeFalsy();
    expect((await received).viaApp).toBe('Assistente Teste');
    const history = await call(access, 'read_room_chat', { roomId: room.id });
    expect(history.result!.content[0]!.text).toContain('mensagem da ia');
  });

  it('renova com rotacao, lista e desconecta o app derrubando os tokens', async () => {
    const { access, refresh, clientId } = await connect('member');
    const renew = () => app.inject({
      method: 'POST', url: '/api/oauth/token', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId }).toString(),
    });
    expect((await renew()).statusCode).toBe(200);
    expect((await renew()).statusCode).toBe(400); // o token de renovacao usado morreu

    const list = (await app.inject({ method: 'GET', url: '/api/me/apps', headers: asUser('member') })).json() as { apps: Array<{ id: string; name: string; scopes: string[] }> };
    const entry = list.apps.find((a) => a.name === 'Assistente Teste')!;
    expect(entry.scopes).toEqual(['channels', 'community.manage', 'room.chat']);
    // Outro usuario nao desconecta o app alheio.
    expect((await app.inject({ method: 'DELETE', url: `/api/me/apps/${entry.id}`, headers: asUser('owner') })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/api/me/apps/${entry.id}`, headers: asUser('member') })).statusCode).toBe(204);
    expect((await rpc(access, 'ping')).statusCode).toBe(401);
  });

  it('aplica o limite de chamadas por app', async () => {
    const { access } = await connect('member', 'channels');
    const grant = await prisma.oAuthGrant.findFirstOrThrow({ where: { userId: users.member.id }, orderBy: { createdAt: 'desc' } });
    resetMcpCallRateLimit(grant.id);
    let last = 200;
    for (let i = 0; i < 61; i++) last = (await rpc(access, 'ping')).statusCode;
    expect(last).toBe(429);
    resetMcpCallRateLimit(grant.id);
  });
});
