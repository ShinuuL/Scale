import { defineConfig, devices } from '@playwright/test';

/**
 * E2E Scale — valida o fluxo real da sala: socket conecta (badge Conectado)
 * e o botão Sair navega de volta ao início.
 *
 * webServer com reuseExistingServer: o teste usa a stack já em execução
 * (Docker Compose em `npm run dev` no host), sem subir portas duplicadas.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});