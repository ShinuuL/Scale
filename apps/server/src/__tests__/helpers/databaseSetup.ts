import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export default function setup() {
  const directory = process.env.SCALE_TEST_DIRECTORY;
  const url = process.env.SCALE_TEST_DATABASE_URL;
  if (!directory || !url || !path.basename(directory).startsWith('scale-server-test-')) throw new Error('Isolated test database required');
  // Prisma SQLite requer arquivo criado para alguns binarios do schema engine.
  writeFileSync(path.join(directory, 'data.db'), '');
  execFileSync('npx', ['prisma', 'db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url }, stdio: 'pipe',
  });
  return () => { rmSync(directory, { recursive: true, force: true }); };
}
