/**
 * Cifra dos segredos gravados no banco (AES-256-GCM, chave derivada do
 * JWT_SECRET): ida e volta, formato, tag invalida e troca de segredo.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { resetEnv } from '../lib/env.js';
import { decryptSecret, encryptSecret } from '../lib/settingsCrypto.js';

describe('settingsCrypto', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    resetEnv();
  });

  it('cifra e decifra; o texto cifrado nao contem o segredo em claro e tem o formato v1', () => {
    const stored = encryptSecret('sk-ant-chave-super-secreta-123');
    expect(stored).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain('sk-ant');
    expect(decryptSecret(stored)).toBe('sk-ant-chave-super-secreta-123');
    // IV aleatorio: cifrar duas vezes nunca repete.
    expect(encryptSecret('x'.repeat(20))).not.toBe(encryptSecret('x'.repeat(20)));
  });

  it('formato invalido ou versao desconhecida -> null + warn (nao lanca)', () => {
    const warn = vi.fn();
    expect(decryptSecret('lixo', { warn })).toBeNull();
    expect(decryptSecret('v2.a.b.c', { warn })).toBeNull();
    expect(decryptSecret('v1.a.b', { warn })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('tag adulterada -> null + warn', () => {
    const warn = vi.fn();
    const [v, iv, tag, ct] = encryptSecret('segredo-de-teste-12345').split('.');
    const badTag = Buffer.from(tag, 'base64');
    badTag[0] ^= 0xff;
    expect(decryptSecret([v, iv, badTag.toString('base64'), ct].join('.'), { warn })).toBeNull();
    const badCt = Buffer.from(ct, 'base64');
    badCt[0] ^= 0xff;
    expect(decryptSecret([v, iv, tag, badCt.toString('base64')].join('.'), { warn })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('segredo-de-teste');
  });

  it('JWT_SECRET trocado nao decifra o que foi gravado antes', () => {
    const stored = encryptSecret('chave-antiga-0123456789');
    process.env.JWT_SECRET = 'outro-segredo-para-o-teste';
    resetEnv();
    try {
      expect(decryptSecret(stored)).toBeNull();
    } finally {
      process.env.JWT_SECRET = 'test-secret-for-unit-tests';
      resetEnv();
    }
    expect(decryptSecret(stored)).toBe('chave-antiga-0123456789');
  });
});
