import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Fonte unica de portas para os testes E2E.
 *
 * Le o .env da raiz (mesmo comportamento de apps/web/next.config.js e
 * apps/server/package.json) para nao hardcodar 4000/4100 espalhado pelos specs.
 * Nesta maquina a 4000 esta ocupada por um PostgreSQL local, entao o backend
 * roda na 4100.
 */
const rootEnv = path.resolve(process.cwd(), '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const FRONTEND_PORT = process.env.FRONTEND_PORT || '3000';
const BACKEND_PORT = process.env.BACKEND_PORT || process.env.PORT || '4000';

/** Origin do frontend (onde o browser navega). Tambem serve de baseURL. */
export const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;

/** Origin do backend (WebSocket/API direto, quando o proxy nao e o alvo). */
export const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;
