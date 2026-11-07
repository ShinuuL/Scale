#!/usr/bin/env node
/**
 * Gera a Content-Security-Policy do frontend estatico (pos `next build`).
 *
 * O export do App Router injeta scripts INLINE em cada HTML (o payload RSC em
 * `self.__next_f.push(...)`). Sem nonce (nao ha servidor) a unica forma de
 * libera-los sem 'unsafe-inline' e listar o sha256 de cada um. Este script le
 * todo `out/**\/*.html`, calcula os hashes e grava `.caddy/csp.caddy`, que o
 * Caddyfile importa no bloco dos estaticos. Os hashes mudam a cada build; o
 * arquivo e gerado junto com o `out/` (nunca editado a mao nem versionado).
 *
 * Uso: node scripts/csp.mjs   (roda automaticamente no `npm run build`)
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'out');
const target = path.join(root, '.caddy', 'csp.caddy');

function htmlFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) found.push(...htmlFiles(full));
    else if (name.endsWith('.html')) found.push(full);
  }
  return found;
}

// <script> sem src (inline). Atributos como nonce/type nao aparecem no export.
const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;

let files;
try {
  files = htmlFiles(outDir);
} catch (err) {
  console.error(`[csp] out/ nao encontrado em ${outDir}: rode \`next build\` antes.`, err);
  process.exit(1);
}

const hashes = new Set();
for (const file of files) {
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const body = match[1];
    if (!body) continue;
    hashes.add(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
}

const policy = [
  "default-src 'self'",
  `script-src 'self' ${[...hashes].sort().join(' ')}`.trim(),
  // Tailwind gera CSS em arquivo, mas o React/Next aplica atributos style="".
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  // 'self' cobre fetch /api e o WebSocket same-origin (ws/wss do proprio host).
  "connect-src 'self' wss:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(
  target,
  `# GERADO por apps/web/scripts/csp.mjs a cada build. NAO editar.\n` +
    `# ${files.length} paginas, ${hashes.size} scripts inline (sha256).\n` +
    `header Content-Security-Policy "${policy}"\n`,
);
console.log(`[csp] ${target} gerado: ${files.length} paginas, ${hashes.size} hashes de script inline.`);
