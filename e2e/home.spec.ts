import { test, expect } from '@playwright/test';
import { registerUser } from './auth';

/**
 * Regras de criação de sala na home (Etapa 2):
 *  - criar sala (temporária OU persistente) exige login;
 *  - o nome da sala é OBRIGATÓRIO (min 3) e é o nome digitado (não mais gerado).
 *
 * O botão "Criar Sala" aparece duas vezes (formulário e estado vazio de "Salas
 * na rede") — usamos `.first()` para o do formulário, que vem antes no DOM.
 */
function createButton(page: import('@playwright/test').Page) {
  return page.getByRole('button', { name: 'Criar Sala' }).first();
}

test.describe('criar sala na home', () => {
  test('anônimo: mostra aviso de login e não cria a sala', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continuar como convidado' }).click();

    await page.getByLabel('Nome da sala').fill('Sala anonima');
    await createButton(page).click();

    // Sem sessão o primeiro clique já avisa (não abre as opções da sala).
    await expect(page.getByRole('alert').filter({ hasText: 'Entre na sua conta para criar uma sala' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /Sala persistente/ })).toHaveCount(0);
    // Continua na home: nenhuma navegação para /room?id=...
    await expect(page).toHaveURL('http://localhost:3000/');
  });

  test('nome curto: mostra erro de validação', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continuar como convidado' }).click();

    const name = page.getByLabel('Nome da sala');
    await name.fill('ab');
    await name.blur();

    await expect(page.getByText('O nome precisa de pelo menos 3 caracteres')).toBeVisible();
  });

  test('autenticado: cria a sala com o nome digitado', async ({ page }) => {
    await registerUser(page); // cookie HttpOnly fica no context do `page`

    await page.goto('/');
    // Espera a verificação de auth (GET /api/auth/me) concluir para não cair no
    // aviso "faça login" por corrida de estado.
    await page.waitForLoadState('networkidle');

    await page.getByLabel('Nome da sala').fill('Reuniao E2E');
    await createButton(page).click();
    // Primeiro clique abre as opções da sala; o segundo confirma.
    await page.getByRole('button', { name: 'Confirmar e criar sala' }).click();

    await expect(page).toHaveURL(/\/room\?id=[0-9a-f-]{36}$/, { timeout: 15_000 });
    // A sala carregou com o nome que foi digitado (header do room).
    await expect(page.getByRole('heading', { name: 'Reuniao E2E', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test('visitante sem sessão cai na landing, não direto como convidado', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Chama a turma. Abre a sala.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Perfil de Convidado' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Continuar como convidado' }).click();
  await expect(page.getByRole('button', { name: 'Perfil de Convidado' })).toBeVisible();
});
