import { test, expect, type Browser, type Page } from '@playwright/test';
import { registerUser } from './auth';

/**
 * Redesign (PR #4): criação de sala em duas etapas, chat, primitivos
 * react-aria (menu, diálogos, seletor de áudio), tooltip e chamada persistente
 * ao navegar pelo app.
 *
 * Login: E2E_LOGIN/E2E_PASSWORD (conta existente) ou cadastro novo.
 */

async function login(page: Page): Promise<void> {
  const loginId = process.env.E2E_LOGIN;
  const password = process.env.E2E_PASSWORD;
  if (loginId && password) {
    const res = await page.request.post('/api/auth/login', {
      data: { email: loginId, password },
    });
    expect(res.ok(), `login falhou: ${res.status()}`).toBeTruthy();
    return;
  }
  await registerUser(page);
}

async function createRoom(page: Page, name: string): Promise<string> {
  const res = await page.request.post('/api/rooms', {
    data: { name, isPersistent: true },
  });
  expect(res.ok(), `criar sala falhou: ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as { room: { id: string } };
  return body.room.id;
}

async function deleteRoom(page: Page, roomId: string): Promise<void> {
  await page.request.delete(`/api/rooms/${roomId}`).catch(() => undefined);
}

function participantCount(page: Page) {
  return page.getByRole('navigation', { name: 'Participantes da sala' }).getByLabel(/de \d+ participantes/);
}

async function openGuest(browser: Browser, roomId: string) {
  const context = await browser.newContext({ permissions: ['microphone'] });
  const page = await context.newPage();
  await page.goto(`/room?id=${roomId}`);
  await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
  return { context, page };
}

test.describe('redesign da interface', () => {
  test('nova sala: opções só depois de Criar sala, com dica ao marcar', async ({ page }) => {
    await login(page);
    await page.goto('/');
    const form = page.locator('section[aria-labelledby="create-title"]');
    await expect(form.getByText('Sala persistente')).toHaveCount(0);

    await form.getByLabel('Nome da sala').fill('Sala E2E opcoes');
    await form.getByRole('button', { name: 'Criar sala' }).click();

    const persistent = form.getByRole('checkbox', { name: /Sala persistente/ });
    await expect(persistent).toBeVisible();
    await expect(form.getByRole('button', { name: 'Confirmar e criar sala' })).toBeVisible();
    await expect(form.getByText('Fica disponível até você encerrar.')).toHaveCount(0);
    await persistent.check();
    await expect(form.getByText('Fica disponível até você encerrar.')).toBeVisible();
  });

  test('chat, tooltip, menu de perfil, seletor de áudio e diálogo de saída', async ({ page }) => {
    await login(page);
    const roomId = await createRoom(page, 'Sala E2E componentes');
    try {
      await page.goto(`/room?id=${roomId}`);
      await expect(page.getByText('Conectado', { exact: true })).toBeVisible();

      // Chat: estado vazio, envio e balão próprio.
      await page.getByRole('button', { name: 'Abrir chat' }).click();
      const chat = page.getByTestId('chat-panel');
      await expect(chat.getByText('Nenhuma mensagem ainda')).toBeVisible();
      await chat.getByRole('combobox', { name: 'Mensagem' }).fill('Olá do Playwright');
      await chat.getByRole('button', { name: 'Enviar' }).click();
      await expect(chat.getByTestId('chat-message').filter({ hasText: 'Olá do Playwright' })).toBeVisible();
      await expect(chat.getByText('Nenhuma mensagem ainda')).toHaveCount(0);

      // Tooltip: aparece no hover, sem duplicar o nome acessível. (Botão
      // desabilitado não recebe eventos de ponteiro: o alvo é o Fechar chat.)
      await chat.getByRole('button', { name: 'Fechar chat' }).hover();
      const tip = page.locator('span[aria-hidden="true"]', { hasText: /^Fechar chat$/ });
      await expect(tip).toBeVisible();
      await page.mouse.move(0, 0);
      await expect(tip).toHaveCount(0);

      // Menu de perfil pelo teclado (react-aria).
      const trigger = page.getByRole('button', { name: /^Perfil de / });
      await trigger.focus();
      await page.keyboard.press('ArrowDown');
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      await expect(page.getByRole('menuitem').first()).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(trigger).toBeFocused();

      // Configurações > seletor de microfone: Esc fecha só a lista.
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Configurações' }).click();
      const settings = page.getByRole('dialog', { name: 'Configurações' });
      await expect(settings).toBeVisible();
      await settings.getByRole('button', { name: /Microfone/ }).click();
      const listbox = page.getByRole('listbox');
      await expect(listbox).toBeVisible();
      await expect(listbox.getByRole('option').first()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(listbox).toHaveCount(0);
      await expect(settings).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(settings).toHaveCount(0);

      // Sair da sala: confirmação, Esc cancela e mantém conectado.
      await page.getByRole('button', { name: 'Sair da sala' }).click();
      const leave = page.getByRole('dialog', { name: 'Sair da sala?' });
      await expect(leave).toBeVisible();
      await expect(leave.getByRole('button', { name: 'Continuar na sala' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(leave).toHaveCount(0);
      await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
    } finally {
      await deleteRoom(page, roomId);
    }
  });

  test('chamada continua ao navegar para Amigos e volta sem reconectar', async ({ page, browser }) => {
    await login(page);
    const roomId = await createRoom(page, 'Sala E2E persistente');
    const guest = await openGuest(browser, roomId);
    try {
      await page.goto(`/room?id=${roomId}`);
      await expect(page.getByText('Conectado', { exact: true })).toBeVisible();
      await expect(participantCount(page)).toHaveAttribute('aria-label', /^2 de/);
      await expect(participantCount(guest.page)).toHaveAttribute('aria-label', /^2 de/);

      // Navega pelo trilho lateral (client-side): a sala some, a chamada fica.
      await page.getByRole('navigation', { name: 'Áreas do Scale' }).getByRole('link', { name: 'Amigos' }).click();
      await expect(page).toHaveURL(/\/friends\/?$/);
      const bar = page.getByRole('region', { name: 'Chamada em andamento' });
      await expect(bar).toBeVisible();
      await expect(bar).toContainText('Sala E2E persistente');
      await expect(bar).toContainText('2 pessoas');
      await expect(page.getByRole('navigation', { name: 'Participantes da sala' })).toBeHidden();

      // O convidado não vê a saída do dono.
      await guest.page.waitForTimeout(2000);
      await expect(participantCount(guest.page)).toHaveAttribute('aria-label', /^2 de/);

      // Silenciar pela barra.
      await bar.getByRole('button', { name: 'Silenciar microfone' }).click();
      await expect(bar.getByRole('button', { name: 'Ativar microfone' })).toBeVisible();

      // Voltar restaura a sala com o mesmo estado (continua mudo, 2 pessoas).
      await bar.getByRole('link', { name: 'Voltar para a sala' }).click();
      await expect(page).toHaveURL(new RegExp(`/room\\?id=${roomId}`));
      await expect(bar).toHaveCount(0);
      await expect(participantCount(page)).toHaveAttribute('aria-label', /^2 de/);
      await expect(page.getByRole('button', { name: 'Ativar microfone' })).toBeVisible();

      // Sair pela barra encerra a chamada para o outro lado.
      await page.getByRole('navigation', { name: 'Áreas do Scale' }).getByRole('link', { name: 'Ajuda' }).click();
      await page.getByRole('region', { name: 'Chamada em andamento' }).getByRole('button', { name: 'Sair da chamada' }).click();
      await expect(page.getByRole('region', { name: 'Chamada em andamento' })).toHaveCount(0);
      await expect(participantCount(guest.page)).toHaveAttribute('aria-label', /^1 de/);
    } finally {
      await guest.context.close();
      await deleteRoom(page, roomId);
    }
  });
});
