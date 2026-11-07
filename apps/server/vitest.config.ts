import { defineConfig } from 'vitest/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Nunca usar data.db de desenvolvimento: cada execucao tem seu banco descartavel.
const testDirectory = mkdtempSync(path.join(tmpdir(), 'scale-server-test-'));
const testDatabaseUrl = `file:${path.join(testDirectory, 'data.db')}`;
process.env.SCALE_TEST_DIRECTORY = testDirectory;
process.env.SCALE_TEST_DATABASE_URL = testDatabaseUrl;

export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./src/__tests__/helpers/databaseSetup.ts'],
    environment: 'node',
    // Cada invocacao cria esquema novo em diretorio temporario; nunca usa
    // DATABASE_URL/data.db de desenvolvimento ou volumes Docker.
    env: {
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: 'test',
    },
    // Os arquivos de teste compartilham o mesmo SQLite local e vários fazem
    // deleteMany global (rooms/messages/files) no beforeAll. Em paralelo, esse
    // wipe cruza com salas criadas pela suíte socket/chat e gera flakiness
    // ("Room not found", "Not in room"). Rodar em worker único serializa os
    // arquivos e torna o gate determinístico.
    fileParallelism: false,
  },
});
