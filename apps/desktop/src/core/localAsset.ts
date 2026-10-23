import path from 'node:path';

/**
 * Mapeia scale-app://local/<caminho> para um arquivo dentro de `root`.
 * Retorna null para host errado, query/hash, ou tentativa de sair da pasta.
 */
export function resolveLocalAsset(requestUrl: string, root: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'scale-app:' || url.host !== 'local') return null;
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, `.${rel}`);
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}
