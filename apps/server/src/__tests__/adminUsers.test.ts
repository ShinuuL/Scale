/**
 * Gestao de administradores: /api/admin/users (lista, busca, filtro, cursor),
 * grant/revoke com auditoria, isAdmin/adminSource em /api/auth/me, admin
 * concedido acessando metricas e moderacao, evento `me:admin`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { AdminRoleAuditEntry, AdminUserRow, AdminUsersPage } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';
import { adminUsersRoutes } from '../routes/adminUsers.js';
import { adminModerationRoutes } from '../routes/adminModeration.js';
import { metricsRoutes } from '../routes/metrics.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';
import { resetAdminSettingsRateLimit } from '../lib/rateLimit.js';
import { createSocketServer } from '../socket/handler.js';
import { isAdminUser, maskEmail } from '../lib/adminRole.js';

const TAG = `admusr${Date.now()}`;
const ROOT_EMAIL = `${TAG}-root@exemplo.com`;

describe('maskEmail', () => {
  it('mostra 2 caracteres do local + *** + dominio', () => {
    expect(maskEmail('gabriel@gmail.com')).toBe('ga***@gmail.com');
    expect(maskEmail('abc@x.com')).toBe('ab***@x.com');
  });
  it('local com 2 ou menos caracteres vira * + ***', () => {
    expect(maskEmail('ab@x.com')).toBe('****@x.com');
    expect(maskEmail('a@x.com')).toBe('****@x.com');
  });
  it('sem arroba nao vaza nada', () => {
    expect(maskEmail('semarroba')).toBe('***');
  });
});

describe('gestao de administradores', () => {
  let app: FastifyInstance;
  let port = 0;
  const clients: Socket[] = [];
  const ids: Record<'root' | 'user' | 'other' | 'acento', string> = { root: '', user: '', other: '', acento: '' };
  const tokens: Record<keyof typeof ids, string> = { root: '', user: '', other: '', acento: '' };
  const emails: Record<keyof typeof ids, string> = {
    root: ROOT_EMAIL,
    user: `${TAG}-maria@exemplo.com`,
    other: `${TAG}-pedro@exemplo.com`,
    acento: `${TAG}-joao@exemplo.com`,
  };
  const as = (who: keyof typeof ids): Record<string, string> => ({ cookie: `token=${tokens[who]}` });

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000';
    process.env.ADMIN_EMAILS = ROOT_EMAIL;
    delete process.env.METRICS_ADMIN_EMAILS;
    resetEnv();

    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(authRoutes);
    await app.register(metricsRoutes);
    await app.register(adminModerationRoutes);
    await app.register(adminUsersRoutes);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    if (addr && typeof addr === 'object') port = addr.port;
    (app as unknown as Record<string, unknown>).io = createSocketServer(app.server);

    const names: Record<keyof typeof ids, string> = { root: `Raiz ${TAG}`, user: `Maria ${TAG}`, other: `Pedro ${TAG}`, acento: `João ${TAG}` };
    // createdAt distintos e conhecidos: ordem estavel para a paginacao.
    const order: Array<keyof typeof ids> = ['root', 'user', 'other', 'acento'];
    for (const [i, key] of order.entries()) {
      const u = await prisma.user.create({
        data: { email: emails[key], passwordHash: 'x', name: names[key], createdAt: new Date(Date.UTC(2020, 0, 1 + i)) },
      });
      ids[key] = u.id;
      tokens[key] = signToken({ userId: u.id, email: emails[key], name: names[key] });
    }
    await prisma.username.create({ data: { userId: ids.user, name: `${TAG}_mari` } });
  });

  beforeEach(() => {
    for (const id of Object.values(ids)) resetAdminSettingsRateLimit(id);
  });

  afterAll(async () => {
    while (clients.length) clients.pop()?.disconnect();
    await prisma.adminRoleAudit.deleteMany({ where: { targetId: { in: Object.values(ids) } } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await app?.close();
  });

  async function list(who: keyof typeof ids, query: string): Promise<AdminUsersPage> {
    const res = await app.inject({ method: 'GET', url: `/api/admin/users?${query}`, headers: as(who) });
    expect(res.statusCode).toBe(200);
    return res.json() as AdminUsersPage;
  }
  const grant = (who: keyof typeof ids, target: string) =>
    app.inject({ method: 'PUT', url: `/api/admin/users/${target}/admin`, headers: as(who) });
  const revoke = (who: keyof typeof ids, target: string) =>
    app.inject({ method: 'DELETE', url: `/api/admin/users/${target}/admin`, headers: as(who) });
  const auditCount = (target: string, action: string) => prisma.adminRoleAudit.count({ where: { targetId: target, action } });

  it('nao-admin recebe 403 em todas as rotas; sem login 401', async () => {
    const reqs = [
      { method: 'GET' as const, url: '/api/admin/users' },
      { method: 'GET' as const, url: '/api/admin/users/audit' },
      { method: 'PUT' as const, url: `/api/admin/users/${ids.other}/admin` },
      { method: 'DELETE' as const, url: `/api/admin/users/${ids.other}/admin` },
    ];
    for (const r of reqs) {
      expect((await app.inject({ ...r, headers: as('user') })).statusCode).toBe(403);
      expect((await app.inject(r)).statusCode).toBe(401);
    }
    expect((await app.inject({ method: 'GET', url: '/api/metrics', headers: as('user') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/moderation', headers: as('user') })).statusCode).toBe(403);
  });

  it('lista com e-mail mascarado e sem o e-mail completo no corpo', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/admin/users?q=${TAG}`, headers: as('root') });
    expect(res.statusCode).toBe(200);
    for (const e of Object.values(emails)) expect(res.body).not.toContain(e);
    const page = res.json() as AdminUsersPage;
    expect(page.users.map((u) => u.id)).toEqual([ids.acento, ids.other, ids.user, ids.root]);
    const maria = page.users.find((u) => u.id === ids.user) as AdminUserRow;
    expect(maria).toMatchObject({ emailMasked: `${TAG.slice(0, 2)}***@exemplo.com`, username: `${TAG}_mari`, admin: null, isSelf: false });
    expect(page.users.find((u) => u.id === ids.root)).toMatchObject({ admin: 'env', isSelf: true, grantedBy: null });
  });

  it('busca por nome (sem caixa, com acento), @nome e e-mail completo', async () => {
    expect((await list('root', `q=${encodeURIComponent(`maria ${TAG}`)}`)).users.map((u) => u.id)).toEqual([ids.user]);
    expect((await list('root', `q=${encodeURIComponent(`JOÃO ${TAG}`)}`)).users.map((u) => u.id)).toEqual([ids.acento]);
    expect((await list('root', `q=${encodeURIComponent(`@${TAG}_MARI`)}`)).users.map((u) => u.id)).toEqual([ids.user]);
    expect((await list('root', `q=${encodeURIComponent(emails.other.toUpperCase())}`)).users.map((u) => u.id)).toEqual([ids.other]);
  });

  it('paginacao por cursor estavel', async () => {
    const p1 = await list('root', `q=${TAG}&limit=3`);
    expect(p1.users.map((u) => u.id)).toEqual([ids.acento, ids.other, ids.user]);
    expect(p1.nextCursor).toEqual(expect.any(String));
    const p2 = await list('root', `q=${TAG}&limit=3&cursor=${encodeURIComponent(p1.nextCursor as string)}`);
    expect(p2.users.map((u) => u.id)).toEqual([ids.root]);
    expect(p2.nextCursor).toBeNull();
    const bad = await app.inject({ method: 'GET', url: '/api/admin/users?cursor=lixo', headers: as('root') });
    expect(bad.statusCode).toBe(400);
  });

  it('grant cria auditoria, muda /api/auth/me e emite me:admin; repetido nao duplica', async () => {
    const sock = await new Promise<Socket>((resolve, reject) => {
      const c = ioClient(`http://127.0.0.1:${port}`, { auth: { guestName: 'x', token: tokens.user }, transports: ['websocket'] });
      clients.push(c);
      c.on('connect', () => resolve(c));
      c.on('connect_error', reject);
    });
    // Join na sala user:<id> acontece no connection handler; da um tick.
    await new Promise((r) => setTimeout(r, 100));
    const evt = new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('timeout me:admin')), 2000);
      sock.once('me:admin', (d: unknown) => { clearTimeout(t); resolve(d); });
    });

    const res = await grant('root', ids.user);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: ids.user, admin: 'db', grantedBy: { id: ids.root, name: `Raiz ${TAG}` } });
    expect(res.body).not.toContain(emails.user);
    expect(await evt).toEqual({ isAdmin: true, adminSource: 'db' });
    expect(await auditCount(ids.user, 'grant')).toBe(1);

    const me = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: as('user') })).json() as { user: { isAdmin: boolean; adminSource: string | null } };
    expect(me.user).toMatchObject({ isAdmin: true, adminSource: 'db' });
    const rootMe = (await app.inject({ method: 'GET', url: '/api/auth/me', headers: as('root') })).json() as { user: { isAdmin: boolean; adminSource: string | null } };
    expect(rootMe.user).toMatchObject({ isAdmin: true, adminSource: 'env' });

    expect((await grant('root', ids.user)).statusCode).toBe(200);
    expect(await auditCount(ids.user, 'grant')).toBe(1);
    // Raiz: grant idempotente, sem auditoria.
    expect((await grant('user', ids.root)).json()).toMatchObject({ admin: 'env' });
    expect(await auditCount(ids.root, 'grant')).toBe(0);
    expect((await grant('root', 'nao-existe')).statusCode).toBe(404);
  });

  it('admin concedido acessa metricas, moderacao e a lista; filtro admins inclui raiz e concedido', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/metrics', headers: as('user') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/admin/moderation', headers: as('user') })).statusCode).toBe(200);
    const admins = await list('user', `q=${TAG}&filter=admins`);
    expect(admins.users.map((u) => u.id).sort()).toEqual([ids.root, ids.user].sort());
    expect(admins.users.find((u) => u.id === ids.user)?.isSelf).toBe(true);
  });

  it('revoke: raiz 409, si mesmo 400, inexistente 404', async () => {
    const r1 = await revoke('user', ids.root);
    expect(r1.statusCode).toBe(409);
    expect(r1.json()).toEqual({ error: 'env_admin' });
    const r2 = await revoke('user', ids.user);
    expect(r2.statusCode).toBe(400);
    expect(r2.json()).toEqual({ error: 'cannot_revoke_self' });
    expect((await revoke('root', 'nao-existe')).statusCode).toBe(404);
  });

  it('revoke ok: auditoria, me:admin e perda de acesso imediata', async () => {
    const sock = clients[0] as Socket;
    const evt = new Promise<unknown>((resolve) => sock.once('me:admin', resolve));
    const res = await revoke('root', ids.user);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ admin: null, grantedBy: null });
    expect(await evt).toEqual({ isAdmin: false, adminSource: null });
    expect(await auditCount(ids.user, 'revoke')).toBe(1);
    expect((await revoke('root', ids.user)).statusCode).toBe(200);
    expect(await auditCount(ids.user, 'revoke')).toBe(1);

    // Mesmo JWT de antes: o papel e lido do banco a cada request.
    expect((await app.inject({ method: 'GET', url: '/api/metrics', headers: as('user') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/admin/users', headers: as('user') })).statusCode).toBe(403);
    expect(await isAdminUser({ userId: ids.user, email: emails.user })).toBe(false);

    const audit = (await app.inject({ method: 'GET', url: '/api/admin/users/audit', headers: as('root') })).json() as { entries: AdminRoleAuditEntry[] };
    const mine = audit.entries.filter((e) => e.target.id === ids.user);
    expect(mine.map((e) => e.action)).toEqual(['revoke', 'grant']);
    expect(mine[0]).toMatchObject({ actor: { id: ids.root, name: `Raiz ${TAG}` }, target: { name: `Maria ${TAG}` } });
  });
});
