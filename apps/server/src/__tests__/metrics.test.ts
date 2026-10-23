import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import {
  incChatMessages,
  incChatEdits,
  incChatDeletes,
  addChatFilesBytes,
  incQuotaExceeded,
  getChatMetricsText,
} from '../lib/metrics.js';
import { metricsRoutes } from '../routes/metrics.js';
import { authPlugin } from '../plugins/auth.js';
import { signToken } from '../lib/auth.js';
import { resetEnv } from '../lib/env.js';

/** Extrai o valor numérico de uma linha Prometheus (name + optional labels). */
function metricValue(text: string, name: string): number {
  for (const line of text.split('\n')) {
    if (line.startsWith(name)) {
      const value = line.slice(name.length).trim();
      return Number(value);
    }
  }
  return 0;
}

describe('chat metrics (scale_chat_*)', () => {
  it('incChatMessages incrementa contadores por room_type', () => {
    const beforePersistent = metricValue(
      getChatMetricsText(),
      'scale_chat_messages_total{room_type="persistent"}',
    );
    const beforeTemporary = metricValue(
      getChatMetricsText(),
      'scale_chat_messages_total{room_type="temporary"}',
    );

    incChatMessages('persistent');
    incChatMessages('persistent');
    incChatMessages('temporary');

    const after = getChatMetricsText();
    expect(
      metricValue(after, 'scale_chat_messages_total{room_type="persistent"}'),
    ).toBe(beforePersistent + 2);
    expect(
      metricValue(after, 'scale_chat_messages_total{room_type="temporary"}'),
    ).toBe(beforeTemporary + 1);
  });

  it('incChatEdits/incChatDeletes/addChatFilesBytes/incQuotaExceeded incrementam', () => {
    const before = getChatMetricsText();
    const editsBefore = metricValue(before, 'scale_chat_edits_total');
    const deletesBefore = metricValue(before, 'scale_chat_deletes_total');
    const bytesBefore = metricValue(before, 'scale_chat_files_bytes_total');
    const quotaBefore = metricValue(before, 'scale_chat_quota_exceeded_total');

    incChatEdits();
    incChatDeletes();
    addChatFilesBytes(2048);
    incQuotaExceeded();

    const after = getChatMetricsText();
    expect(metricValue(after, 'scale_chat_edits_total')).toBe(editsBefore + 1);
    expect(metricValue(after, 'scale_chat_deletes_total')).toBe(deletesBefore + 1);
    expect(metricValue(after, 'scale_chat_files_bytes_total')).toBe(bytesBefore + 2048);
    expect(metricValue(after, 'scale_chat_quota_exceeded_total')).toBe(quotaBefore + 1);
  });

  it('getChatMetricsText expõe linhas Prometheus scale_chat_* com labels', () => {
    const text = getChatMetricsText();
    expect(text).toContain('scale_chat_messages_total{room_type="persistent"}');
    expect(text).toContain('scale_chat_messages_total{room_type="temporary"}');
    expect(text).toContain('scale_chat_edits_total');
    expect(text).toContain('scale_chat_deletes_total');
    expect(text).toContain('scale_chat_files_bytes_total');
    expect(text).toContain('scale_chat_quota_exceeded_total');
  });
});

describe('GET /api/metrics', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    // /api/metrics exige admin: o usuario destes testes esta na allowlist.
    process.env.METRICS_ADMIN_EMAILS = 'metrics@exemplo.com';
    // getEnv() cacheia o ambiente no primeiro acesso; como os tokens são
    // assinados aqui, garante que o secret acima já está valendo.
    resetEnv();
    token = signToken({
      userId: 'user-metrics-test',
      email: 'metrics@exemplo.com',
      name: 'Metrics Tester',
    });
    app = Fastify({ logger: false });
    await app.register(cookie);
    await app.register(authPlugin);
    await app.register(metricsRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env.NODE_ENV = 'test';
  });

  it('JSON inclui chat counters escalar (chat.messagesPersistent etc)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      chat?: {
        messagesPersistent: number;
        messagesTemporary: number;
        edits: number;
        deletes: number;
        filesBytes: number;
        quotaExceeded: number;
      };
    };
    expect(body.chat).toBeDefined();
    expect(typeof body.chat?.messagesPersistent).toBe('number');
    expect(typeof body.chat?.messagesTemporary).toBe('number');
    expect(typeof body.chat?.edits).toBe('number');
    expect(typeof body.chat?.deletes).toBe('number');
    expect(typeof body.chat?.filesBytes).toBe('number');
    expect(typeof body.chat?.quotaExceeded).toBe('number');
  });

  it('Accept: text/plain responde Prometheus text com scale_chat_*', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { accept: 'text/plain', authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.payload).toContain('scale_chat_messages_total{room_type="persistent"}');
    expect(res.payload).toContain('scale_chat_messages_total{room_type="temporary"}');
    expect(res.payload).toContain('scale_chat_edits_total');
    expect(res.payload).toContain('scale_chat_deletes_total');
    expect(res.payload).toContain('scale_chat_files_bytes_total');
    expect(res.payload).toContain('scale_chat_quota_exceeded_total');
  });

  it('?format=prometheus também responde text/plain', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics?format=prometheus',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.payload).toContain('scale_chat_messages_total');
  });

  /* ------------------------------------------------------------------ */
  /*  Auth: /api/metrics deixou de ser publico                           */
  /* ------------------------------------------------------------------ */

  it('sem credencial responde 401 e nao vaza contadores', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/metrics' });
    expect(res.statusCode).toBe(401);
    expect(res.payload).not.toContain('scale_chat');
    expect(JSON.parse(res.payload)).toMatchObject({ error: 'Authentication required' });
  });

  it('Prometheus text tambem exige credencial', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics?format=prometheus',
      headers: { accept: 'text/plain' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('token invalido responde 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      headers: { authorization: 'Bearer nao-e-um-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('cookie token valido responde 200 (mesmo caminho do browser)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/metrics',
      cookies: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toHaveProperty('peers');
  });
});