import { test, expect } from '@playwright/test';

/**
 * Secao "Baixar o aplicativo" da home: resolve os instaladores do desktop
 * nativo pela API de releases do GitHub e destaca o do sistema do visitante.
 *
 * A API e interceptada em todos os testes: sem isso o resultado dependeria da
 * rede, do limite de 60 requisicoes/hora da API publica e de quais releases
 * existem de verdade no repositorio.
 */

const API = 'https://api.github.com/repos/ShinuuL/Scale/releases*';
const BASE = 'https://github.com/ShinuuL/Scale/releases/download';

/** Mesma forma do payload real, com os nomes que o cargo-packager gera. */
function releases(version = '0.1.2') {
  const url = (file: string) => `${BASE}/desktop-v${version}/${file}`;
  return [
    // Release de outra coisa, mais nova: a pagina tem de ignorar.
    { tag_name: 'v9.9.9', draft: false, prerelease: false, assets: [] },
    {
      tag_name: `desktop-v${version}`,
      draft: false,
      prerelease: false,
      assets: [
        { name: 'SHA256SUMS', browser_download_url: url('SHA256SUMS') },
        {
          name: `scale-desktop_${version}_x64-setup.exe`,
          browser_download_url: url(`scale-desktop_${version}_x64-setup.exe`),
        },
        {
          name: `scale-desktop_${version}_x64.AppImage`,
          browser_download_url: url(`scale-desktop_${version}_x64.AppImage`),
        },
        {
          name: `scale-desktop_${version}_amd64.deb`,
          browser_download_url: url(`scale-desktop_${version}_amd64.deb`),
        },
      ],
    },
  ];
}

async function mockReleases(page: import('@playwright/test').Page, body: unknown, status = 200) {
  await page.route(API, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

/** A home abre no wizard de onboarding na primeira visita. */
async function abrirHome(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar como convidado' }).click();
  await page.locator('#baixar').waitFor();
}

test.describe('baixar o aplicativo', () => {
  test('destaca o instalador do sistema e oferece os outros como alternativa', async ({ page }) => {
    await mockReleases(page, releases());
    await abrirHome(page);

    const secao = page.locator('#baixar');
    await secao.scrollIntoViewIfNeeded();

    // Os runners do Playwright sao Windows/Linux; nos dois casos ha um primario.
    const primario = secao.getByRole('link', { name: /Baixar para (Windows|Linux)/ }).first();
    await expect(primario).toBeVisible();

    const href = await primario.getAttribute('href');
    expect(href).toMatch(/^https:\/\/github\.com\/ShinuuL\/Scale\/releases\/download\/desktop-v0\.1\.2\//);
    expect(href).toMatch(/\.(exe|AppImage)$/);

    // A versao resolvida aparece no link para as releases.
    await expect(secao.getByRole('link', { name: /Versão 0\.1\.2/ })).toBeVisible();
  });

  test('avisa que voz e tela ainda nao estao no app nativo', async ({ page }) => {
    await mockReleases(page, releases());
    await abrirHome(page);

    await expect(page.locator('#baixar')).toContainText('só pelo navegador');
  });

  test('ignora release de desktop em rascunho e usa a publicada', async ({ page }) => {
    const payload = [
      { tag_name: 'desktop-v0.9.0', draft: true, prerelease: false, assets: [] },
      ...releases('0.1.2'),
    ];
    await mockReleases(page, payload);
    await abrirHome(page);

    const secao = page.locator('#baixar');
    await expect(secao.getByRole('link', { name: /Versão 0\.1\.2/ })).toBeVisible();
    await expect(secao).not.toContainText('0.9.0');
  });

  test('API fora do ar cai no link de releases, sem botao quebrado', async ({ page }) => {
    await mockReleases(page, { message: 'rate limit' }, 403);
    await abrirHome(page);

    const secao = page.locator('#baixar');
    await expect(secao).toContainText('Não foi possível consultar os downloads agora');
    await expect(secao.getByRole('link', { name: /Baixar para/ })).toHaveCount(0);
  });
});
