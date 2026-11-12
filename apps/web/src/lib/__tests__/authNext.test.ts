import { describe, expect, it } from 'vitest';
import { authNext } from '../authNext';

describe('destino após autenticação', () => {
  it('aceita apenas os caminhos previstos', () => {
    expect(authNext('/invite')).toBe('/invite');
    expect(authNext('/communities')).toBe('/communities');
    for (const value of [null, '//example.com', '/invite?next=x', '/communities/']) {
      expect(authNext(value)).toBe('/');
    }
  });
});
