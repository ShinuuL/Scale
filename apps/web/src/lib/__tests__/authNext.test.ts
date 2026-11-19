import { afterEach, describe, expect, it } from 'vitest';
import { authNext, rememberConsentReturn, takeConsentReturn } from '../authNext';

describe('destino após autenticação', () => {
  afterEach(() => sessionStorage.clear());

  it('aceita apenas os caminhos previstos', () => {
    expect(authNext('/invite')).toBe('/invite');
    expect(authNext('/communities')).toBe('/communities');
    for (const value of [null, '//example.com', '/invite?next=x', '/communities/']) {
      expect(authNext(value)).toBe('/');
    }
  });

  it('volta para o consentimento de app conectado so no mesmo origin', () => {
    const consent = '/oauth/authorize?response_type=code&client_id=abc&state=x%2Fy';
    expect(authNext(consent)).toBe(consent);
    for (const value of ['/oauth/authorize', '//evil.example/oauth/authorize?x', '/oauth/authorize?x#y', `/oauth/authorize?a${String.fromCharCode(92)}b`,'https://evil.example/oauth/authorize?x']) {
      expect(authNext(value)).toBe('/');
    }
  });

  it('guarda o consentimento para o login social e consome uma vez', () => {
    rememberConsentReturn('/oauth/authorize?client_id=abc');
    expect(takeConsentReturn()).toBe('/oauth/authorize?client_id=abc');
    expect(takeConsentReturn()).toBeNull();
    rememberConsentReturn('/invite');
    expect(takeConsentReturn()).toBeNull();
  });
});
