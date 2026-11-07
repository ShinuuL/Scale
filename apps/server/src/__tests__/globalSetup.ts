import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { TEST_DATABASE_URL } from './testDatabase.js';

/**
 * Banco proprio dos testes, separado do banco de dev (prisma/data.db).
 *
 * Varias suites fazem deleteMany global (rooms.test.ts apaga ate os usuarios),
 * entao rodar contra o banco de dev apagava as contas locais. Aqui o
 * prisma/test.db e criado se faltar e sincronizado com o schema atual a cada
 * rodada (db push sem reset; a limpeza dos dados fica com as suites). Se uma
 * mudanca de schema exigir perda de dados, apague prisma/test.db e rode de novo.
 *
 * O CLI do Prisma e chamado pelo proprio Node (sem npx), para funcionar igual
 * no Windows e no Linux.
 */
export default function setup(): void {
  const require = createRequire(import.meta.url);
  const prismaCli = require.resolve('prisma/build/index.js');
  const schema = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));

  execFileSync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate', '--schema', schema], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
