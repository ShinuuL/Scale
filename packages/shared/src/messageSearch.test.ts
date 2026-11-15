import { describe, expect, it } from 'vitest';
import { matchesSearch, messageSearchQuerySchema, splitHighlight } from './messageSearch.js';

describe('busca de mensagens', () => {
  it('compara sem caixa e sem acento', () => {
    expect(matchesSearch('Reunião de AÇÃO', 'acao')).toBe(true);
    expect(matchesSearch('Reuniao', 'união')).toBe(true);
    expect(matchesSearch('nada', 'acao')).toBe(false);
  });
  it('destaca o trecho original', () => {
    expect(splitHighlight('Faça a AÇÃO já', 'acao')).toEqual([{ text: 'Faça a ', hit: false }, { text: 'AÇÃO', hit: true }, { text: ' já', hit: false }]);
    expect(splitHighlight('aa aa', 'aa').filter((p) => p.hit)).toHaveLength(2);
  });
  it('valida tamanho e intervalo', () => {
    expect(messageSearchQuerySchema.safeParse({ q: ' a ' }).success).toBe(false);
    expect(messageSearchQuerySchema.safeParse({ q: 'ok', from: '2026-02-01T00:00:00.000Z', to: '2026-01-01T00:00:00.000Z' }).success).toBe(false);
    expect(messageSearchQuerySchema.safeParse({ q: 'ok' }).success).toBe(true);
  });
});
