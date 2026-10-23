import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLocalAsset } from './localAsset';

const ROOT = path.resolve('/app/dist/renderer');

describe('resolveLocalAsset', () => {
  it('resolve arquivos dentro da pasta', () => {
    expect(resolveLocalAsset('scale-app://local/setup/index.html', ROOT)).toBe(path.join(ROOT, 'setup', 'index.html'));
    expect(resolveLocalAsset('scale-app://local/common.css', ROOT)).toBe(path.join(ROOT, 'common.css'));
  });

  it.each([
    'scale-app://local/../main/main.js',
    'scale-app://local/%2e%2e/main/main.js',
    'scale-app://local/setup/..%2f..%2fmain.js',
    'scale-app://local/%2e%2e/%2e%2e/main.js',
  ])('nunca sai da pasta: %s', (url) => {
    const file = resolveLocalAsset(url, ROOT);
    expect(file === null || file.startsWith(ROOT + path.sep)).toBe(true);
  });

  it.each([
    'scale-app://local/setup%5c..%5c..%5cmain.js',
    'scale-app://local/a%00b',
    'scale-app://outro/setup/index.html',
    'https://local/setup/index.html',
    'file:///C:/Windows/win.ini',
    'nao e url',
  ])('recusa %s', (url) => {
    expect(resolveLocalAsset(url, ROOT)).toBeNull();
  });
});
