#!/usr/bin/env node
/**
 * Sobe backend + frontend em paralelo para desenvolvimento no host.
 *
 * Por que existe: `npm run dev --workspaces` executa os workspaces em SERIE.
 * Como `next dev` nunca termina, o backend jamais era iniciado — o app subia
 * pela metade (so o frontend) e nada funcionava.
 *
 * Sem dependencias externas (nao usa concurrently/cross-env). Le o .env da
 * raiz, deriva a porta do browser a partir de PORT/BACKEND_PORT e encerra os
 * dois processos juntos.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Mesma semantica do Node --env-file: NAO sobrescreve variaveis ja definidas.
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const backendPort = process.env.PORT || '4100';
const browserPort = process.env.BACKEND_PORT || backendPort;
const backendUrl = `http://localhost:${browserPort}`;

const targets = [
  {
    name: 'backend',
    args: ['run', 'dev', '-w', 'scale-backend'],
    env: { PORT: String(backendPort) },
  },
  {
    name: 'frontend',
    args: ['run', 'dev', '-w', 'scale-frontend'],
    env: {
      // So existem em `next dev` (ver apps/web/next.config.js): alvo do rewrite
      // /api e URL do WebSocket direto no backend (o Next nao faz upgrade de
      // WebSocket). O build estatico de producao nao usa nenhuma das duas.
      BACKEND_URL: backendUrl,
      NEXT_PUBLIC_DEV_WS_URL: backendUrl,
    },
  },
];

const children = [];
let shuttingDown = false;

/**
 * No Windows `npm` roda via cmd.exe, entao matar o shell nao mata o node/neto.
 * taskkill /T derruba a arvore inteira.
 */
function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) killTree(child);
  setTimeout(() => process.exit(code), 400);
}

for (const target of targets) {
  // `npm` no Windows e um .cmd e exige shell:true. Porem passar um ARRAY de
  // args junto com shell:true dispara DEP0190 (os args nao seriam escapados),
  // entao montamos a linha de comando como string unica — os args sao fixos.
  const command = ['npm', ...target.args].join(' ');
  const child = spawn(command, {
    cwd: root,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...target.env },
  });
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.error(`\n[dev] "${target.name}" encerrou (code=${code ?? signal}). Parando tudo.`);
    shutdown(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`[dev] falha ao iniciar "${target.name}": ${err.message}`);
    shutdown(1);
  });
  children.push(child);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

console.log(`[dev] backend em :${backendPort} | browser -> ${backendUrl}`);
