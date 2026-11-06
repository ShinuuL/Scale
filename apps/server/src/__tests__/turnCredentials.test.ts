import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { resetEnv } from '../lib/env.js';
import { buildIceServers, signTurnCredential, isTurnMisconfigured } from '../lib/turnCredentials.js';

const KEYS = ['ENABLE_TURN', 'TURN_URL', 'TURN_SECRET', 'TURN_USERNAME', 'TURN_CREDENTIAL', 'TURN_TTL_SECONDS'] as const;

describe('lib/turnCredentials — TURN com credencial temporaria', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    process.env.JWT_SECRET ??= 'test-secret-for-unit-tests';
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    resetEnv();
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    resetEnv();
  });

  it('TURN desligado → so STUN', () => {
    const res = buildIceServers('abc');
    expect(res.turnEnabled).toBe(false);
    expect(res.iceServers).toHaveLength(1);
    expect(String(res.iceServers[0].urls)).toMatch(/^stun:/);
  });

  it('credencial no formato da REST API do coturn (HMAC-SHA1 base64 de "expira:rotulo")', () => {
    const { username, credential } = signTurnCredential('segredo', 'sock_1-A', 1_900_000_000);
    expect(username).toBe('1900000000:sock_1-A');
    expect(credential).toBe(createHmac('sha1', 'segredo').update(username).digest('base64'));
  });

  it('rotulo nao injeta ":" (separador do coturn)', () => {
    const { username } = signTurnCredential('s', 'a:b:c', 10);
    expect(username).toBe('10:abc');
  });

  it('ENABLE_TURN + TURN_SECRET → TURN com validade padrao de 24 h e varias URLs', () => {
    process.env.ENABLE_TURN = 'true';
    process.env.TURN_URL = 'turn:1.2.3.4:3478?transport=udp, turn:1.2.3.4:3478?transport=tcp';
    process.env.TURN_SECRET = 'x'.repeat(32);
    resetEnv();
    const now = 1_800_000_000_000;
    const res = buildIceServers('sock1', now);
    expect(res.turnEnabled).toBe(true);
    expect(res.expiresAt).toBe(now / 1000 + 24 * 3600);
    const turn = res.iceServers[1];
    expect(turn.urls).toEqual(['turn:1.2.3.4:3478?transport=udp', 'turn:1.2.3.4:3478?transport=tcp']);
    expect(turn.username).toBe(`${res.expiresAt}:sock1`);
    expect(turn.credential).toBe(createHmac('sha1', 'x'.repeat(32)).update(String(turn.username)).digest('base64'));
  });

  it('TURN_TTL_SECONDS valido muda a validade; invalido cai no padrao', () => {
    process.env.ENABLE_TURN = 'true';
    process.env.TURN_URL = 'turn:h:3478';
    process.env.TURN_SECRET = 's'.repeat(32);
    process.env.TURN_TTL_SECONDS = '3600';
    resetEnv();
    expect(buildIceServers('a', 0).expiresAt).toBe(3600);
    process.env.TURN_TTL_SECONDS = '5';
    expect(buildIceServers('a', 0).expiresAt).toBe(24 * 3600);
  });

  it('sem TURN_SECRET usa usuario/senha fixos (provedor externo)', () => {
    process.env.ENABLE_TURN = 'true';
    process.env.TURN_URL = 'turn:h:3478';
    process.env.TURN_USERNAME = 'u';
    process.env.TURN_CREDENTIAL = 'p';
    resetEnv();
    const res = buildIceServers('a');
    expect(res.turnEnabled).toBe(true);
    expect(res.iceServers[1]).toMatchObject({ username: 'u', credential: 'p' });
    expect(res.expiresAt).toBeUndefined();
  });

  it('ENABLE_TURN sem URL ou sem credencial → STUN e marcado como mal configurado', () => {
    process.env.ENABLE_TURN = 'true';
    process.env.TURN_SECRET = 's'.repeat(32);
    resetEnv();
    expect(buildIceServers('a').turnEnabled).toBe(false);
    expect(isTurnMisconfigured()).toBe(true);
    process.env.TURN_URL = 'turn:h:3478';
    expect(isTurnMisconfigured()).toBe(false);
  });
});
