import { describe, expect, it } from 'vitest';
import { canAutoUpdate, unavailableReason } from './updatePolicy';

describe('canAutoUpdate', () => {
  it('nao atualiza fora do pacote', () => {
    expect(canAutoUpdate({ packaged: false, platform: 'win32' })).toBe(false);
    expect(canAutoUpdate({ packaged: false, platform: 'linux', appImage: '/tmp/Scale.AppImage' })).toBe(false);
  });

  it('atualiza no Windows empacotado', () => {
    expect(canAutoUpdate({ packaged: true, platform: 'win32' })).toBe(true);
  });

  it('no Linux so atualiza a partir do AppImage', () => {
    expect(canAutoUpdate({ packaged: true, platform: 'linux', appImage: '/opt/Scale-x64.AppImage' })).toBe(true);
    expect(canAutoUpdate({ packaged: true, platform: 'linux' })).toBe(false);
    expect(canAutoUpdate({ packaged: true, platform: 'linux', appImage: '' })).toBe(false);
  });

  it('nao atualiza em plataformas sem alvo publicado', () => {
    expect(canAutoUpdate({ packaged: true, platform: 'darwin' })).toBe(false);
  });
});

describe('unavailableReason', () => {
  it.each([
    [{ packaged: false, platform: 'win32' as NodeJS.Platform }, 'instalado'],
    [{ packaged: true, platform: 'linux' as NodeJS.Platform }, '.deb'],
    [{ packaged: true, platform: 'darwin' as NodeJS.Platform }, 'este sistema'],
  ])('explica o caso %#', (env, trecho) => {
    expect(unavailableReason(env)).toContain(trecho);
  });
});
