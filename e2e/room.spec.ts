import { test, expect, Page } from '@playwright/test';

/**
 * Registra console + page errors para diagnóstico ("Tailnet only", RST, etc.).
 * Console errors viram falha apenas no fim, via fixture com check explicito.
 */
function attachDiagnostics(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[console.error] ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(`[pageerror] ${err.message}`);
  });
  return { consoleErrors, pageErrors };
}

test('sala conecta e mostra Conectado', async ({ page }) => {
  const diag = attachDiagnostics(page);

  // Cria sala via API (diretamente no backend, como o cliente HTTP faria)
  const res = await page.request.post('http://localhost:4000/api/rooms', {
    data: { name: 'E2E', isPersistent: false },
  });
  expect(res.ok(), `POST /api/rooms falhou: ${res.status()}`).toBeTruthy();
  const { room } = await res.json();

  await page.goto(`http://localhost:3000/room/${room.id}`);

  // Aguarda badge Conectado (socket conectado via Socket.io handshake)
  await expect(page.getByText('Conectado')).toBeVisible({ timeout: 15000 });

  // Verifica Sair navega de volta ao início mesmo com mídia indisponível
  await page.getByRole('button', { name: 'Sair da sala' }).click();
  await expect(page).toHaveURL('http://localhost:3000/', { timeout: 5000 });

  // Diagnóstico: se houve erro de console/page, reporte (não mascara o resultado)
  expect(
    diag.consoleErrors.filter((e) => !e.includes('getUserMedia') && !e.includes('mediaDevices')),
    `Console errors:\n${diag.consoleErrors.join('\n')}\nPage errors:\n${diag.pageErrors.join('\n')}`,
  ).toEqual([]);
});