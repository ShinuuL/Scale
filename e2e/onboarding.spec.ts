import { test, expect } from '@playwright/test';
import { registerUser } from './auth';

/**
 * Wizard de onboarding (guia de uso) — Etapa 3:
 *  - o guia nao ensina mais instalacao de rede privada (VPN): passos de conta,
 *    sala, link e mic/tela;
 *  - CRIAR sala dentro do wizard exige login (mesma regra da home): sem sessao
 *    nao chama POST /api/rooms e mostra o aviso para entrar.
 */
test.describe('wizard de onboarding', () => {
  test('anonimo: aviso de login e botao de criar desabilitado', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Abrir guia de uso' }).click();
    await page.getByRole('button', { name: 'Começar' }).click();
    await page.getByRole('button', { name: 'Já tenho conta' }).click();

    // Passo 3: criar sala exige login.
    await expect(page.getByText('Faça login para criar uma sala')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Criar Sala' })).toBeDisabled();
    // Continua no wizard: nenhuma navegacao para /room?id=...
    await expect(page).toHaveURL('http://localhost:3000/');
  });

  test('anonimo: entrar por codigo nao exige login', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Abrir guia de uso' }).click();
    await page.getByRole('button', { name: 'Começar' }).click();
    await page.getByRole('button', { name: 'Já tenho conta' }).click();

    await page.getByLabel('Código da sala (ID)').fill('11111111-1111-4111-8111-111111111111');
    await page.getByRole('button', { name: 'Entrar na Sala' }).click();

    await expect(page).toHaveURL(
      /\/room\?id=11111111-1111-4111-8111-111111111111$/,
      { timeout: 15_000 },
    );
  });

  test('autenticado: cria a sala pelo wizard com o nome digitado', async ({ page }) => {
    await registerUser(page);

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Abrir guia de uso' }).click();
    await page.getByRole('button', { name: 'Começar' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();

    await page.getByLabel('Nome da sala').fill('Wizard E2E');
    await page.getByRole('button', { name: 'Criar Sala' }).click();

    await expect(page).toHaveURL(/\/room\?id=[0-9a-f-]{36}$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Wizard E2E' })).toBeVisible({
      timeout: 15_000,
    });
  });

  test('passos do guia nao mencionam rede privada/VPN (regressao)', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('button', { name: 'Abrir guia de uso' }).click();

    for (let step = 1; step <= 5; step += 1) {
      // Guarda de regressao: o produto nao pode voltar a ensinar essas ferramentas.
      await expect(page.getByText(/tailscale|tailnet/i)).toHaveCount(0);
      const next = page.getByRole('button', { name: /^(Começar|Continuar|Já tenho conta)$/ });
      if ((await next.count()) === 0) break;
      await next.first().click();
    }
  });
});
