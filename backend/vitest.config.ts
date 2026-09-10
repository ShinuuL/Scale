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
  },
});
