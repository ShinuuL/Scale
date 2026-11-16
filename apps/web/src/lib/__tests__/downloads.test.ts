import { describe, expect, it } from 'vitest';
import { detectOperatingSystem, downloadOffer } from '@/lib/downloads';

const UA = {
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ubuntu:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  firefoxLinux: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

describe('detectOperatingSystem', () => {
  it.each([
    ['windows', UA.windows, 'windows'],
    ['linux chromium', UA.ubuntu, 'linux'],
    ['linux firefox', UA.firefoxLinux, 'linux'],
    ['android antes de linux', UA.android, 'android'],
    ['ios', UA.iphone, 'ios'],
    ['macos', UA.mac, 'macos'],
  ])('reconhece %s', (_nome, ua, esperado) => {
    expect(detectOperatingSystem(ua)).toBe(esperado);
  });

  it('prefere a dica do userAgentData ao user agent congelado', () => {
    expect(detectOperatingSystem(UA.windows, 'Linux')).toBe('linux');
    expect(detectOperatingSystem(UA.ubuntu, 'Windows')).toBe('windows');
    expect(detectOperatingSystem(UA.ubuntu, 'Android')).toBe('android');
  });

  it('sem user agent nem dica fica desconhecido', () => {
    expect(detectOperatingSystem(undefined)).toBe('unknown');
    expect(detectOperatingSystem('', '')).toBe('unknown');
  });
});

describe('downloadOffer', () => {
  it('destaca o .exe no Windows', () => {
    const offer = downloadOffer('windows');
    expect(offer.primary?.url).toMatch(/\/releases\/latest\/download\/Scale-Setup-x64\.exe$/);
    expect(offer.secondary.map((o) => o.id)).toEqual(['linux-appimage', 'linux-deb']);
  });

  it('destaca o AppImage no Linux e oferece o .deb', () => {
    const offer = downloadOffer('linux');
    expect(offer.primary?.id).toBe('linux-appimage');
    expect(offer.secondary.map((o) => o.id)).toContain('linux-deb');
  });

  it('nao oferece instalador no celular', () => {
    for (const os of ['android', 'ios'] as const) {
      const offer = downloadOffer(os);
      expect(offer.primary).toBeNull();
      expect(offer.secondary).toEqual([]);
    }
  });

  it('sem sistema reconhecido lista todos os instaladores', () => {
    const offer = downloadOffer('unknown');
    expect(offer.primary).toBeNull();
    expect(offer.secondary).toHaveLength(3);
  });

  it('todos os links apontam para a release mais recente, em https', () => {
    const urls = (['windows', 'linux', 'macos', 'unknown'] as const).flatMap((os) => {
      const offer = downloadOffer(os);
      return [...(offer.primary ? [offer.primary] : []), ...offer.secondary].map((o) => o.url);
    });
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/github\.com\/ShinuuL\/Scale\/releases\/latest\/download\//);
    }
  });
});
