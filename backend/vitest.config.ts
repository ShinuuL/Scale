import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // The repo-root .env points DATABASE_URL at the Docker container path
    // (file:/app/data/data.db), which does not exist on a local machine.
    // Give tests a local SQLite file so they run anywhere.
    env: {
      DATABASE_URL: 'file:./data.db',
    },
    // Os arquivos de teste compartilham o mesmo SQLite local e vários fazem
    // deleteMany global (rooms/messages/files) no beforeAll. Em paralelo, esse
    // wipe cruza com salas criadas pela suíte socket/chat e gera flakiness
    // ("Room not found", "Not in room"). Rodar em worker único serializa os
    // arquivos e torna o gate determinístico.
    fileParallelism: false,
  },
});
