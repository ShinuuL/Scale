import { fileURLToPath } from 'node:url';

/** Arquivo SQLite exclusivo dos testes (o de dev e prisma/data.db). */
export const TEST_DATABASE_FILE = fileURLToPath(new URL('../../prisma/test.db', import.meta.url));

/** URL absoluta: nao depende de onde o cliente Prisma foi gerado. */
export const TEST_DATABASE_URL = `file:${TEST_DATABASE_FILE.replace(/\\/g, '/')}`;
