import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveLocalAsset } from '../core/localAsset';
import { paths } from './paths';

/**
 * Telas locais (setup, seletor) sao servidas por um esquema proprio em vez de
 * file://. Assim o fuse GrantFileProtocolExtraPrivileges fica desligado e a
 * pagina local so enxerga os arquivos de dist/renderer.
 */
export const LOCAL_SCHEME = 'scale-app';
export const LOCAL_ORIGIN = `${LOCAL_SCHEME}://local`;

export const localUrls = {
  setup: `${LOCAL_ORIGIN}/setup/index.html`,
  picker: `${LOCAL_ORIGIN}/picker/index.html`,
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
};

/** Precisa rodar antes de app.ready. */
export function registerLocalScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: LOCAL_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

export function handleLocalScheme(): void {
  protocol.handle(LOCAL_SCHEME, async (request) => {
    const file = resolveLocalAsset(request.url, paths.rendererRoot);
    const type = file ? MIME[path.extname(file)] : undefined;
    if (!file || !type || request.method !== 'GET') return new Response('Not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(file).toString());
    if (!res.ok) return new Response('Not found', { status: 404 });
    return new Response(res.body, {
      status: 200,
      headers: {
        'content-type': type,
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      },
    });
  });
}
