const path = require('node:path');
const fs = require('node:fs');
const { PHASE_DEVELOPMENT_SERVER } = require('next/constants');

/**
 * Frontend 100% estatico (`output: 'export'`): `next build` gera `out/`, que o
 * Caddy do servico `proxy` serve junto com o roteamento `/api` e `/socket.io`
 * para o backend. Nao existe servidor Next em producao — logo nao ha rewrites,
 * nem SSR, nem env server-side. O browser fala SEMPRE com o mesmo origin.
 *
 * Desenvolvimento (`next dev`, fase PHASE_DEVELOPMENT_SERVER):
 *  - `/api/*` e reescrito para o backend no host (rewrites so existem aqui;
 *    com `output: 'export'` eles nao funcionam e nem sao declarados no build).
 *    Mantem a API same-origin (cookie HttpOnly SameSite=Strict de primeira
 *    parte) e o `page.request` dos testes E2E apontando para :3000.
 *  - O WebSocket do socket.io NAO passa por rewrites do Next (sem upgrade), entao
 *    em dev o cliente conecta direto no backend via `NEXT_PUBLIC_DEV_WS_URL`,
 *    definido SO nesta fase. No build de producao a variavel fica vazia e o
 *    socket usa o mesmo origin (Caddy encaminha `/socket.io`).
 */
module.exports = (phase) => {
  if (phase !== PHASE_DEVELOPMENT_SERVER) {
    // Versao do build: embutida no bundle E gravada em public/version.json (vai
    // para out/). A pagina compara as duas e pede reload quando muda. O id vai
    // para process.env na 1a carga: os workers do build herdam o MESMO valor.
    if (!process.env.SCALE_BUILD_ID) {
      process.env.SCALE_BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      fs.writeFileSync(path.join(__dirname, 'public', 'version.json'), JSON.stringify({ version: process.env.SCALE_BUILD_ID }));
    }
    /** @type {import('next').NextConfig} */
    const exportConfig = {
      output: 'export',
      images: { unoptimized: true },
      env: { NEXT_PUBLIC_DEV_WS_URL: '', NEXT_PUBLIC_BUILD_ID: process.env.SCALE_BUILD_ID },
    };
    return exportConfig;
  }

  // Dev no host: carrega o .env da RAIZ do monorepo (o Next so olharia
  // apps/web/.env). loadEnvFile NAO sobrescreve variaveis ja definidas, entao o
  // que vier de scripts/dev.mjs tem precedencia.
  const rootEnv = path.resolve(__dirname, '..', '..', '.env');
  if (fs.existsSync(rootEnv)) process.loadEnvFile(rootEnv);

  // Porta do backend no host (4100 no .env desta maquina; 4000 e de um
  // PostgreSQL local).
  const backendPort = process.env.BACKEND_PORT || process.env.PORT || '4000';
  const backendUrl = process.env.BACKEND_URL || `http://localhost:${backendPort}`;

  /** @type {import('next').NextConfig} */
  const devConfig = {
    env: { NEXT_PUBLIC_DEV_WS_URL: process.env.NEXT_PUBLIC_DEV_WS_URL || backendUrl },
    async rewrites() {
      return [{ source: '/api/:path*', destination: `${backendUrl}/api/:path*` }];
    },
  };
  return devConfig;
};
