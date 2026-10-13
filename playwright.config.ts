import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E Scale — valida o fluxo real da sala: socket conecta (badge Conectado),
 * o botão Sair navega de volta ao início e o chat troca mensagens/arquivos
 * entre dois peers.
 */

// Le o .env da raiz para descobrir a porta do backend (PORT/BACKEND_PORT).
// Sem isto o config assumiria 4000, que nesta maquina esta ocupada por um
// PostgreSQL local.
const rootEnv = path.resolve(process.cwd(), '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const BACKEND_PORT = process.env.BACKEND_PORT || process.env.PORT || '4000';
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    permissions: ['microphone'],
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          // getUserMedia precisa de dispositivo falso no headless; sem isto o
          // useWebRTC falha e o socket nem chega a conectar.
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
          ],
        },
      },
    },
  ],
  // Sobe backend e frontend como servidores SEPARADOS para o Playwright
  // esperar os DOIS ficarem prontos. Esperar so a :3000 nao garante que a
  // API e o WebSocket ja respondem.
  webServer: [
    {
      command: 'npm run dev:backend',
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev:frontend',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
