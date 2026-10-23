import { describe, expect, it } from 'vitest';
import { canOpenExternally, decideNavigation } from './navigation';

const ORIGIN = 'https://scale.exemplo.com.br';

describe('decideNavigation', () => {
  it.each([
    'https://scale.exemplo.com.br/',
    'https://scale.exemplo.com.br/room?id=abc',
    'https://SCALE.exemplo.com.br/login',
    'https://scale.exemplo.com.br:443/x',
  ])('permite mesma origin: %s', (url) => {
    expect(decideNavigation(url, ORIGIN)).toBe('allow');
  });

  it.each([
    'https://example.com',
    'https://scale.exemplo.com.br.evil.com/',
    'https://sub.scale.exemplo.com.br/',
    'https://scale.exemplo.com.br:8443/',
  ])('outra origin https abre fora: %s', (url) => {
    expect(decideNavigation(url, ORIGIN)).toBe('external');
  });

  it.each([
    'http://scale.exemplo.com.br/',
    'http://example.com',
    'file:///C:/Windows/win.ini',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'mailto:a@b.com',
    'ms-settings:privacy',
    'https://user:pass@example.com',
    'nao e url',
  ])('bloqueia: %s', (url) => {
    expect(decideNavigation(url, ORIGIN)).toBe('block');
  });

  it('sem servidor configurado nada e permitido dentro do app', () => {
    expect(decideNavigation('https://scale.exemplo.com.br/', null)).toBe('external');
    expect(decideNavigation('http://localhost:8090/', null)).toBe('block');
  });

  it('origin http de dev so permite ela mesma', () => {
    expect(decideNavigation('http://localhost:8090/room', 'http://localhost:8090')).toBe('allow');
    expect(decideNavigation('http://localhost:3000/', 'http://localhost:8090')).toBe('block');
  });
});

describe('canOpenExternally', () => {
  it('so https', () => {
    expect(canOpenExternally('https://example.com/doc')).toBe(true);
    expect(canOpenExternally('http://example.com')).toBe(false);
    expect(canOpenExternally('file:///C:/x')).toBe(false);
    expect(canOpenExternally('smb://server/share')).toBe(false);
  });
});
