// Helpers para gerar URLs de acesso via Tailscale (HTTP/HTTPS).
//
// O frontend conhece o host HTTPS apenas se NEXT_PUBLIC_TAILSCALE_HOST estiver
// definido no build (mapeado em next.config.js a partir de TAILSCALE_HOST).
// O IP HTTP vem do /api/tailscale/status; quando indisponível, usa o fallback
// do IP do servidor (mesmo valor documentado em .env.example / wizard).

const FALLBACK_TAILSCALE_IP = '100.119.215.105';
const TAILSCALE_HTTP_PORT = 3000;

export function getTailscaleHost(): string {
  return process.env.NEXT_PUBLIC_TAILSCALE_HOST || '';
}

export function getTailscaleHttpsPort(): string {
  return process.env.NEXT_PUBLIC_HTTPS_PORT || '3443';
}

/**
 * URL HTTPS via Caddy + cert Tailscale: `https://<host>.tailnet.ts.net:3443<path>`.
 * Retorna null quando TAILSCALE_HOST não está configurado no build.
 */
export function buildTailscaleHttpsUrl(path: string): string | null {
  const host = getTailscaleHost();
  if (!host) return null;
  return `https://${host}:${getTailscaleHttpsPort()}${path}`;
}

/**
 * URL HTTP na rede Tailscale: `http://<ip>:3000<path>`.
 * Usa o IP informado (do /api/tailscale/status) ou o fallback documentado.
 */
export function buildTailscaleHttpUrl(
  tailscaleIp: string | null | undefined,
  path: string,
): string {
  const ip = tailscaleIp || FALLBACK_TAILSCALE_IP;
  return `http://${ip}:${TAILSCALE_HTTP_PORT}${path}`;
}