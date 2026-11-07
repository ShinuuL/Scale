import { defineConfig } from 'vitest/config';
import { TEST_DATABASE_URL } from './src/__tests__/testDatabase.js';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Banco proprio dos testes (prisma/test.db), separado do banco de dev
    // (prisma/data.db): as suites fazem deleteMany global e apagavam as
    // contas locais. O globalSetup cria/sincroniza o test.db a cada rodada.
    // Caminho absoluto: um "file:./x.db" relativo e resolvido a partir de
    // onde o cliente Prisma foi gerado, que pode nao ser esta pasta.
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
    },
    globalSetup: ['./src/__tests__/globalSetup.ts'],
    // Os arquivos de teste compartilham o mesmo SQLite local e vários fazem
    // deleteMany global (rooms/messages/files) no beforeAll. Em paralelo, esse
    // wipe cruza com salas criadas pela suíte socket/chat e gera flakiness
    // ("Room not found", "Not in room"). Rodar em worker único serializa os
    // arquivos e torna o gate determinístico.
    fileParallelism: false,
  },
});
