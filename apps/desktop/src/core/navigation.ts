import { originOf } from './serverUrl';

export type NavigationDecision = 'allow' | 'external' | 'block';

/**
 * Regra unica para will-navigate, will-redirect e window.open:
 *  - mesma origin do servidor configurado => permitido dentro do app;
 *  - outra origin https: => bloqueado no app e aberto no navegador do sistema;
 *  - todo o resto (http:, file:, javascript:, data:, mailto:, ...) => bloqueado.
 */
export function decideNavigation(targetUrl: string, allowedOrigin: string | null): NavigationDecision {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    return 'block';
  }
  if (allowedOrigin !== null && originOf(targetUrl) === allowedOrigin) return 'allow';
  if (url.protocol === 'https:' && url.username === '' && url.password === '') return 'external';
  return 'block';
}

/** shell.openExternal so para https: sem credenciais embutidas. */
export function canOpenExternally(targetUrl: string): boolean {
  return decideNavigation(targetUrl, null) === 'external';
}
