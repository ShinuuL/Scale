import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra um stack Docker já de pé (proxy Caddy + backend), sem subir os
 * servidores de dev. Alvo: `PREVIEW_URL` (padrão http://localhost:8080).
 *
 *   PREVIEW_URL=http://localhost:8090 E2E_LOGIN=teste E2E_PASSWORD=... \
 *     npx playwright test --config playwright.preview.config.ts redesign
 *
 * Em produção o cadastro tem limite por IP: prefira E2E_LOGIN/E2E_PASSWORD de
 * uma conta existente em vez de registrar uma por teste.
 */
const PREVIEW_URL = process.env.PREVIEW_URL || 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: PREVIEW_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
        },
      },
    },
  ],
});
