import { describe, expect, it } from 'vitest';
import { isRectVisible, parseConfig, parseWindowState, serializeConfig } from './config';

describe('parseConfig', () => {
  it('le um config valido', () => {
    const raw = JSON.stringify({ version: 1, serverOrigin: 'https://scale.exemplo.com.br' });
    expect(parseConfig(raw)).toEqual({ version: 1, serverOrigin: 'https://scale.exemplo.com.br' });
  });

  it('normaliza a origin salva', () => {
    const cfg = parseConfig(JSON.stringify({ version: 1, serverOrigin: 'https://SCALE.exemplo.com.br/' }));
    expect(cfg?.serverOrigin).toBe('https://scale.exemplo.com.br');
  });

  it.each([
    ['json invalido', '{nao e json'],
    ['vazio', ''],
    ['array', '[]'],
    ['sem versao', JSON.stringify({ serverOrigin: 'https://a.com' })],
    ['versao errada', JSON.stringify({ version: 2, serverOrigin: 'https://a.com' })],
    ['http remoto', JSON.stringify({ version: 1, serverOrigin: 'http://a.com' })],
    ['com path', JSON.stringify({ version: 1, serverOrigin: 'https://a.com/x' })],
    ['com credencial', JSON.stringify({ version: 1, serverOrigin: 'https://u:p@a.com' })],
    ['campo extra', JSON.stringify({ version: 1, serverOrigin: 'https://a.com', devTools: true })],
  ])('descarta config: %s', (_name, raw) => {
    expect(parseConfig(raw)).toBeNull();
  });

  it('serializa e relê', () => {
    const cfg = { version: 1 as const, serverOrigin: 'https://a.com' };
    expect(parseConfig(serializeConfig(cfg))).toEqual(cfg);
  });
});

describe('parseWindowState', () => {
  it('le estado valido', () => {
    const st = { x: 10, y: 20, width: 1200, height: 700, maximized: false };
    expect(parseWindowState(JSON.stringify(st))).toEqual(st);
  });
  it('descarta janela menor que o minimo, json ruim e tipos errados', () => {
    expect(parseWindowState(JSON.stringify({ width: 100, height: 100, maximized: false }))).toBeNull();
    expect(parseWindowState('x')).toBeNull();
    expect(parseWindowState(JSON.stringify({ width: '1200', height: 700, maximized: false }))).toBeNull();
  });
});

describe('isRectVisible', () => {
  const monitor = { x: 0, y: 0, width: 1920, height: 1040 };
  it('aceita janela dentro do monitor', () => {
    expect(isRectVisible({ x: 100, y: 100, width: 1200, height: 800 }, [monitor])).toBe(true);
  });
  it('recusa janela fora de todos os monitores', () => {
    expect(isRectVisible({ x: 3000, y: 100, width: 1200, height: 800 }, [monitor])).toBe(false);
  });
  it('recusa janela quase toda fora', () => {
    expect(isRectVisible({ x: 1900, y: 100, width: 1200, height: 800 }, [monitor])).toBe(false);
  });
});
