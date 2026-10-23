// Build do app desktop: esbuild gera main (cjs), preloads (cjs, arquivo unico
// por exigencia do sandbox) e scripts dos renderers locais (iife). HTML/CSS e
// icone sao copiados. A checagem de tipos fica com `tsc --noEmit` (npm run typecheck).
import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

rmSync(dist, { recursive: true, force: true });

const common = { bundle: true, target: 'es2022', sourcemap: false, logLevel: 'warning', legalComments: 'none' };

try {
  await Promise.all([
    build({
      ...common,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      entryPoints: [join(src, 'main', 'main.ts')],
      outfile: join(dist, 'main', 'main.js'),
    }),
    build({
      ...common,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      entryPoints: {
        setup: join(src, 'preload', 'setup.ts'),
        picker: join(src, 'preload', 'picker.ts'),
      },
      outdir: join(dist, 'preload'),
    }),
    build({
      ...common,
      platform: 'browser',
      format: 'iife',
      entryPoints: {
        'setup/setup': join(src, 'renderer', 'setup', 'setup.ts'),
        'picker/picker': join(src, 'renderer', 'picker', 'picker.ts'),
      },
      outdir: join(dist, 'renderer'),
    }),
  ]);
} catch (err) {
  console.error('[desktop] build falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
}

for (const rel of ['common.css', 'setup/index.html', 'setup/setup.css', 'picker/index.html', 'picker/picker.css']) {
  const to = join(dist, 'renderer', rel);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(src, 'renderer', rel), to);
}
mkdirSync(join(dist, 'assets'), { recursive: true });
cpSync(join(root, 'build', 'icon.png'), join(dist, 'assets', 'icon.png'));

console.log('[desktop] build ok ->', dist);
