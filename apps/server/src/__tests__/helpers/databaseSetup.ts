import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export default function setup() {
  const directory = process.env.SCALE_TEST_DIRECTORY;
  const url = process.env.SCALE_TEST_DATABASE_URL;
  if (!directory || !url || !path.basename(directory).startsWith('scale-server-test-')) throw new Error('Isolated test database required');
  // Prisma SQLite requer arquivo criado para alguns binarios do schema engine.
  writeFileSync(path.join(directory, 'data.db'), '');
  // CLI do Prisma pelo proprio Node: `npx` nao e executavel direto no Windows
  // (la e npx.cmd), e execFileSync sem shell falharia com ENOENT.
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--schema', 'prisma/schema.prisma', '--skip-generate'], {
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: url }, stdio: 'pipe',
  });
  return () => { rmSync(directory, { recursive: true, force: true }); };
}
