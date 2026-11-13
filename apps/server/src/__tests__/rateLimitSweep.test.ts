import { describe, it, expect } from 'vitest';
import {
  isLoginRateLimited,
  isRegisterRateLimited,
  isFileUploadRateLimited,
  isTurnRateLimited,
  isChatRateLimited,
  isRoomCreateRateLimited,
  isLoginEmailRateLimited,
  isRefreshRateLimited,
  sweepExpiredEntries,
  rateLimitStoreSizes,
} from '../lib/rateLimit.js';

/**
 * Expurgo dos baldes (memória ilimitada).
 *
 * Antes: `take` criava a entrada e nunca removia; o `cleanup` varria apenas o
 * store legado de 30/s. Com a chave controlada pelo cliente (IP/email por
 * request), cada request virava uma chave PERMANENTE — crescimento sem limite.
 *
 * Agora existe um expurgo único que varre todos os baldes registrados e derruba
 * toda entrada com a janela expirada, além do timer periódico.
 */

// IPs públicos reservados p/ documentação (RFC 5737) — loopback é isento.
const IP_A = '198.51.100.201';
const IP_B = '198.51.100.202';

describe('expurgo dos baldes de rate limit', () => {
  it('registra TODOS os baldes no expurgo', () => {
    expect(Object.keys(rateLimitStoreSizes()).sort()).toEqual([
      'adminSettings',
      'call',
      'channelReaction',
      'chat',
      'communityInvite',
      'dm',
      'friendRequest',
      'githubOAuth',
      'googleOAuth',
      'loginEmail',
      'loginIp',
      'moderationFrame',
      'moderationReport',
      'profile',
      'refresh',
      'register',
      'roomAuthFail',
      'roomCreate',
      'roomDelete',
      'signal',
      'turn',
      'upload',
      'usernameCheck',
    ]);
  });

  it('cria entrada em cada balde novo (chave por request)', () => {
    isLoginRateLimited(IP_A);
    isLoginEmailRateLimited('sweep@expurgo.test');
    isRegisterRateLimited(IP_A);
    isRefreshRateLimited(IP_A);
    isFileUploadRateLimited(IP_A);
    isTurnRateLimited(IP_A);
    isChatRateLimited('sala-sweep');
    isRoomCreateRateLimited(IP_A);

    const sizes = rateLimitStoreSizes();
    expect(sizes.loginIp).toBeGreaterThan(0);
    expect(sizes.loginEmail).toBeGreaterThan(0);
    expect(sizes.register).toBeGreaterThan(0);
    expect(sizes.refresh).toBeGreaterThan(0);
    expect(sizes.upload).toBeGreaterThan(0);
    expect(sizes.turn).toBeGreaterThan(0);
    expect(sizes.chat).toBeGreaterThan(0);
    expect(sizes.roomCreate).toBeGreaterThan(0);
  });

  it('uma entrada so existe enquanto a janela esta viva', () => {
    // Uma hora à frente: todas as janelas usadas acima (1s a 1h) já expiraram.
    const removed = sweepExpiredEntries(Date.now() + 61 * 60_000);
    expect(removed).toBeGreaterThanOrEqual(8);
    expect(rateLimitStoreSizes().loginIp).toBe(0);
    expect(rateLimitStoreSizes().loginEmail).toBe(0);
    expect(rateLimitStoreSizes().register).toBe(0);
    expect(rateLimitStoreSizes().refresh).toBe(0);
    expect(rateLimitStoreSizes().upload).toBe(0);
    expect(rateLimitStoreSizes().turn).toBe(0);
    expect(rateLimitStoreSizes().chat).toBe(0);
    expect(rateLimitStoreSizes().roomCreate).toBe(0);
  });

  it('nao derruba janela viva', () => {
    isLoginRateLimited(IP_B);
    expect(rateLimitStoreSizes().loginIp).toBe(1);

    // Expurgo com o "agora" real: a janela de 5 min do login continua viva.
    sweepExpiredEntries();
    expect(rateLimitStoreSizes().loginIp).toBe(1);

    // Passados os 5 min, a entrada sai.
    sweepExpiredEntries(Date.now() + 5 * 60_000 + 1);
    expect(rateLimitStoreSizes().loginIp).toBe(0);
  });
});
