import { describe, expect, it } from 'vitest';
import {
  desktopAssets,
  detectOperatingSystem,
  downloadOffer,
  latestDesktopRelease,
  type Release,
} from '@/lib/downloads';

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

/** Nomes reais do cargo-packager (conferidos rodando `cargo packager`). */
function release(version: string, extra: Partial<Release> = {}): Release {
  const base = `https://github.com/ShinuuL/Scale/releases/download/desktop-v${version}`;
  return {
    tag_name: `desktop-v${version}`,
    assets: [
      { name: 'SHA256SUMS', browser_download_url: `${base}/SHA256SUMS` },
      {
        name: `scale-desktop_${version}_x64-setup.exe`,
        browser_download_url: `${base}/scale-desktop_${version}_x64-setup.exe`,
      },
      {
        name: `scale-desktop_${version}_x64.AppImage`,
        browser_download_url: `${base}/scale-desktop_${version}_x64.AppImage`,
      },
      {
        name: `scale-desktop_${version}_amd64.deb`,
        browser_download_url: `${base}/scale-desktop_${version}_amd64.deb`,
      },
    ],
    ...extra,
  };
}

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

describe('latestDesktopRelease', () => {
  it('ignora tags que nao sao de desktop', () => {
    const found = latestDesktopRelease([
      { tag_name: 'v9.9.9', assets: [] },
      release('0.1.2'),
    ]);
    expect(found?.tag_name).toBe('desktop-v0.1.2');
  });

  it('compara versao numericamente, nao por ordem de texto', () => {
    const found = latestDesktopRelease([release('0.9.0'), release('0.10.0'), release('0.2.0')]);
    expect(found?.tag_name).toBe('desktop-v0.10.0');
  });

  it('descarta rascunho e pre-release', () => {
    const found = latestDesktopRelease([
      release('0.2.0', { draft: true }),
      release('0.1.9', { prerelease: true }),
      release('0.1.2'),
    ]);
    expect(found?.tag_name).toBe('desktop-v0.1.2');
  });

  it('sem release de desktop devolve null', () => {
    expect(latestDesktopRelease([{ tag_name: 'v1.0.0', assets: [] }])).toBeNull();
    expect(latestDesktopRelease([])).toBeNull();
  });
});

describe('desktopAssets', () => {
  it('acha os tres instaladores pela extensao e expoe a versao', () => {
    const assets = desktopAssets(release('0.1.2'));
    expect(assets?.version).toBe('0.1.2');
    expect(assets?.windows?.url).toMatch(/scale-desktop_0\.1\.2_x64-setup\.exe$/);
    expect(assets?.appImage?.url).toMatch(/\.AppImage$/);
    expect(assets?.deb?.url).toMatch(/\.deb$/);
  });

  it('nao confunde o SHA256SUMS com instalador', () => {
    const assets = desktopAssets(release('0.1.2'));
    for (const option of [assets?.windows, assets?.appImage, assets?.deb]) {
      expect(option?.url).not.toMatch(/SHA256SUMS$/);
    }
  });

  it('release sem os binarios devolve tudo nulo', () => {
    const assets = desktopAssets({ tag_name: 'desktop-v0.1.2', assets: [] });
    expect(assets?.windows).toBeNull();
    expect(assets?.appImage).toBeNull();
    expect(assets?.deb).toBeNull();
  });

  it('sem release devolve null', () => {
    expect(desktopAssets(null)).toBeNull();
  });
});

describe('downloadOffer', () => {
  const assets = desktopAssets(release('0.1.2'));

  it('destaca o .exe no Windows', () => {
    const offer = downloadOffer('windows', assets);
    expect(offer.primary?.id).toBe('windows-exe');
    expect(offer.secondary.map((o) => o.id)).toEqual(['linux-appimage', 'linux-deb']);
  });

  it('destaca o AppImage no Linux e oferece o .deb', () => {
    const offer = downloadOffer('linux', assets);
    expect(offer.primary?.id).toBe('linux-appimage');
    expect(offer.secondary.map((o) => o.id)).toContain('linux-deb');
  });

  it('nao oferece instalador no celular', () => {
    for (const os of ['android', 'ios'] as const) {
      const offer = downloadOffer(os, assets);
      expect(offer.primary).toBeNull();
      expect(offer.secondary).toEqual([]);
    }
  });

  it('macOS e sistema desconhecido nao destacam nada, mas listam o que existe', () => {
    for (const os of ['macos', 'unknown'] as const) {
      const offer = downloadOffer(os, assets);
      expect(offer.primary).toBeNull();
      expect(offer.secondary).toHaveLength(3);
    }
  });

  it('avisa que voz e tela ainda nao estao no app nativo', () => {
    for (const os of ['windows', 'linux'] as const) {
      expect(downloadOffer(os, assets).note).toMatch(/pelo navegador/);
    }
  });

  it('sem assets nao oferece link quebrado', () => {
    const offer = downloadOffer('windows', null);
    expect(offer.primary).toBeNull();
    expect(offer.secondary).toEqual([]);
    expect(offer.note).toMatch(/GitHub/);
  });

  it('todos os links apontam para a release de desktop, em https', () => {
    const urls = (['windows', 'linux', 'macos', 'unknown'] as const).flatMap((os) => {
      const offer = downloadOffer(os, assets);
      return [...(offer.primary ? [offer.primary] : []), ...offer.secondary].map((o) => o.url);
    });
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(
        /^https:\/\/github\.com\/ShinuuL\/Scale\/releases\/download\/desktop-v/,
      );
    }
  });
});
