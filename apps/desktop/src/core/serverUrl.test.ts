import { describe, expect, it } from 'vitest';
import { originOf, parseServerUrl } from './serverUrl';

describe('parseServerUrl', () => {
  it.each([
    ['https://scale.exemplo.com.br', 'https://scale.exemplo.com.br'],
    ['https://scale.exemplo.com.br/', 'https://scale.exemplo.com.br'],
    ['  https://Scale.Exemplo.com.br  ', 'https://scale.exemplo.com.br'],
    ['https://abc-def.trycloudflare.com', 'https://abc-def.trycloudflare.com'],
    ['https://scale.exemplo.com.br:8443', 'https://scale.exemplo.com.br:8443'],
    ['https://scale.exemplo.com.br:443', 'https://scale.exemplo.com.br'],
    ['http://localhost:8090', 'http://localhost:8090'],
    ['http://127.0.0.1:8090/', 'http://127.0.0.1:8090'],
    ['http://[::1]:8090', 'http://[::1]:8090'],
  ])('aceita %s', (input, origin) => {
    expect(parseServerUrl(input)).toEqual({ ok: true, origin });
  });

  it.each([
    ['', 'Informe'],
    ['   ', 'Informe'],
    ['scale.exemplo.com.br', 'inválido'],
    ['http://scale.exemplo.com.br', 'https://'],
    ['http://192.168.0.10:8090', 'https://'],
    ['http://localhost.evil.com', 'https://'],
    ['ftp://scale.exemplo.com.br', 'https://'],
    ['file:///C:/x.html', 'https://'],
    ['javascript:alert(1)', 'https://'],
    ['https://user:senha@scale.exemplo.com.br', 'usuário'],
    ['https://user@scale.exemplo.com.br', 'usuário'],
    ['https://scale.exemplo.com.br/sala', 'caminho'],
    ['https://scale.exemplo.com.br/?a=1', 'caminho'],
    ['https://scale.exemplo.com.br/#x', 'caminho'],
    ['https://scale.exemplo.com.br?', 'caminho'],
    [`https://${'a'.repeat(3000)}.com`, 'longo'],
  ])('recusa %s', (input, fragment) => {
    const result = parseServerUrl(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(fragment);
  });

  it('recusa valores que nao sao string', () => {
    expect(parseServerUrl(42).ok).toBe(false);
    expect(parseServerUrl(null).ok).toBe(false);
    expect(parseServerUrl({ url: 'https://x.com' }).ok).toBe(false);
  });
});

describe('originOf', () => {
  it('extrai a origin', () => {
    expect(originOf('https://a.com/x?y=1')).toBe('https://a.com');
  });
  it('retorna null para url invalida ou opaca', () => {
    expect(originOf('nada')).toBeNull();
    expect(originOf('data:text/html,oi')).toBeNull();
  });
});
