import { test, expect, Page } from '@playwright/test';
import { FRONTEND_URL } from './config';
import { registerAndCreateRoom } from './auth';

/**
 * Registra console + page errors para diagnóstico (RST de conexão, etc.).
 * Também captura respostas HTTP >= 400 com URL, para não confundir um 401
 * legítimo (anônimo em /api/auth/me) com um bug real.
 */
function attachDiagnostics(page: Page): {
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
} {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[console.error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(`[pageerror] ${err.message}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      badResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return { consoleErrors, pageErrors, badResponses };
}

test('sala conecta e mostra Conectado', async ({ page }) => {
  const diag = attachDiagnostics(page);

  // Cria a sala pelo proxy /api do Next (mesmo caminho que o browser usa), com
  // URL relativa: o baseURL do Playwright resolve a porta correta. Criar sala
  // agora EXIGE login — o helper registra um usuário e deixa o cookie HttpOnly
  // no context do `page` antes do POST /api/rooms.
  const roomId = await registerAndCreateRoom(page, { name: 'E2E', isPersistent: false });

  await page.goto(`/room?id=${roomId}`);

  // Aguarda badge Conectado (socket conectado via Socket.io handshake)
  await expect(page.getByText('Conectado')).toBeVisible({ timeout: 15000 });

  // Verifica Sair navega de volta ao início mesmo com mídia indisponível
  // Depois de entrar, Sair pede confirmação; antes do ingresso (mídia ainda
  // iniciando sob carga) sai direto. Os dois caminhos voltam ao início.
  await page.getByRole('button', { name: 'Sair da sala' }).click();
  const confirm = page.getByRole('dialog', { name: 'Sair da sala?' });
  await Promise.race([
    confirm.waitFor({ state: 'visible' }),
    page.waitForURL(`${FRONTEND_URL}/`),
  ]);
  if (await confirm.isVisible()) {
    await confirm.getByRole('button', { name: 'Sair da sala' }).click();
  }
  await expect(page).toHaveURL(`${FRONTEND_URL}/`, { timeout: 5000 });

  // O peer agora está autenticado (register), então /api/auth/me responde 200.
  // Mantemos o filtro por /api/auth/me por precaução: qualquer outra resposta
  // >= 400 continua sendo falha real.
  const unexpectedResponses = diag.badResponses.filter((r) => !r.includes('/api/auth/me'));
  expect(
    unexpectedResponses,
    `Respostas HTTP >= 400 inesperadas:\n${unexpectedResponses.join('\n')}\n` +
      `Todas as respostas >= 400:\n${diag.badResponses.join('\n')}`,
  ).toEqual([]);

  // O browser tambem loga "Failed to load resource ... 401" (sem URL) para
  // aquela chamada. Como ja garantimos acima que o unico >=400 e o auth/me
  // esperado, esse ruido e filtrado. Erro de console de outra origem falha.
  const unexpectedConsoleErrors = diag.consoleErrors.filter(
    (e) =>
      !e.includes('getUserMedia') &&
      !e.includes('mediaDevices') &&
      !(e.includes('Failed to load resource') && e.includes('401')),
  );
  expect(
    unexpectedConsoleErrors,
    `Console errors:\n${diag.consoleErrors.join('\n')}\nPage errors:\n${diag.pageErrors.join('\n')}\n` +
      `Respostas >= 400:\n${diag.badResponses.join('\n')}`,
  ).toEqual([]);
});