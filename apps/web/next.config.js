const path = require('node:path');
const fs = require('node:fs');

// Carrega o .env da RAIZ do monorepo. O Next so olha para frontend/.env, entao
// sem isto `next dev` roda com os defaults e aponta para o lugar errado.
//
// Seguranca:
//  - loadEnvFile NAO sobrescreve variaveis ja presentes no ambiente, entao o
//    que vier do docker-compose / script de dev tem precedencia.
//  - No build do Docker este arquivo nao existe (o Dockerfile copia apenas
//    frontend/ e package.json), portanto e ignorado sem erro.
const rootEnv = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

// Porta que o BROWSER usa para falar com o backend (WebSocket). Precisa bater
// com a porta exposta no host: 4100 por padrao, para nao colidir com um
// PostgreSQL local que costuma ocupar a 4000.
const browserPort =
  process.env.NEXT_PUBLIC_BACKEND_PORT || process.env.BACKEND_PORT || '4000';
const localBackend = `http://localhost:${browserPort}`;

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  env: {
    NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || localBackend,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || localBackend,
    NEXT_PUBLIC_BACKEND_PORT: browserPort,
  },
  async rewrites() {
    // BACKEND_URL e o alvo SERVER-SIDE do proxy /api (o browser chama /api no
    // mesmo origin e o Next encaminha).
    //  - Docker: http://backend:4000 (DNS do servico na rede interna).
    //  - Dev no host: http://localhost:<porta>, injetado por scripts/dev.mjs.
    // O fallback depende do NODE_ENV porque rewrites() e resolvido em BUILD
    // time: no `next build` (Docker) NODE_ENV=production, no `next dev` nao.
    const backendUrl = process.env.BACKEND_URL
      || (process.env.NODE_ENV === 'development' ? localBackend : 'http://backend:4000');
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
