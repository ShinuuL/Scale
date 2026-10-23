import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from './app.js';
import { requireMcpToken, isAuthorized, MCP_TOKEN_MIN_LENGTH } from './security.js';

const TOKEN = 'm'.repeat(MCP_TOKEN_MIN_LENGTH);

describe('item 9 — MCP endurecido', () => {
  const app = buildApp({ mcpToken: TOKEN, backendUrl: 'http://127.0.0.1:9', metricsServiceToken: '', logger: false });

  afterAll(async () => {
    await app.close();
  });

  it('start aborta sem MCP_TOKEN ou com < 32 caracteres', () => {
    expect(() => requireMcpToken(undefined)).toThrow(/MCP_TOKEN/);
    expect(() => requireMcpToken('curto')).toThrow(/MCP_TOKEN/);
    expect(() => requireMcpToken('x'.repeat(31))).toThrow(/MCP_TOKEN/);
    expect(requireMcpToken(TOKEN)).toBe(TOKEN);
  });

  it('isAuthorized compara o Bearer (tamanhos diferentes nao lancam)', () => {
    expect(isAuthorized(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(isAuthorized(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(isAuthorized('Bearer a', TOKEN)).toBe(false);
    expect(isAuthorized(undefined, TOKEN)).toBe(false);
    expect(isAuthorized(TOKEN, TOKEN)).toBe(false);
  });

  it('rotas exigem token; health e publico', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/mcp/rooms' })).statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'GET',
      url: '/mcp/rooms',
      headers: { authorization: 'Bearer errado' },
    });
    expect(wrong.statusCode).toBe(401);
  });

  it('sem CORS: nenhum Access-Control-Allow-Origin, nem para Origin arbitraria', async () => {
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/mcp/rooms',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });

  it(':id precisa ser UUID (sem path traversal para o backend)', async () => {
    const auth = { authorization: `Bearer ${TOKEN}` };
    const bad = await app.inject({ method: 'GET', url: '/mcp/rooms/..%2F..%2Fapi%2Fmetrics', headers: auth });
    expect(bad.statusCode).toBe(400);
    const kick = await app.inject({
      method: 'POST',
      url: '/mcp/rooms/nao-e-uuid/kick',
      headers: auth,
      payload: { socketId: 'abc' },
    });
    expect(kick.statusCode).toBe(400);
  });

  it('kick nao ecoa nem loga o socketId cru', async () => {
    const lines: string[] = [];
    const logged = buildApp({ mcpToken: TOKEN, backendUrl: 'http://127.0.0.1:9', metricsServiceToken: '' });
    logged.log.info = ((obj: unknown, msg?: string) => {
      lines.push(`${JSON.stringify(obj)} ${msg ?? ''}`);
    }) as typeof logged.log.info;
    const res = await logged.inject({
      method: 'POST',
      url: '/mcp/rooms/550e8400-e29b-41d4-a716-446655440000/kick',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { socketId: 'SoCkEtIdSeCrEt123456' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.payload).not.toContain('SoCkEtIdSeCrEt123456');
    expect(lines.join('\n')).not.toContain('SoCkEtIdSeCrEt123456');
    await logged.close();
  });
});
