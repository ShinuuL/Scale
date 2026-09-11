import type { FastifyRequest, FastifyReply } from 'fastify';
import { getEnv } from '../lib/env.js';

function ipToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return null;
  }
  return (((parts[0] << 24) >>> 0) + ((parts[1] << 16) >>> 0) + ((parts[2] << 8) >>> 0) + parts[3]) >>> 0;
}

/** Normaliza formas comuns de IPv6: `::1` → `127.0.0.1` e remove prefixo IPv4-mapped. */
function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed === '::1') return '127.0.0.1';
  if (trimmed.startsWith('::ffff:')) return trimmed.slice(7);
  return trimmed;
}

/**
 * True se `ip` estiver dentro do CIDR (IPv4). Usado para a CGNAT da Tailscale
 * (`100.64.0.0/10`). IPv6 (ULA `fd7a:...`) não é coberto — nesse caso a
 * permissão deve vir de `TAILSCALE_HOST` ou `ALLOWED_ORIGINS`.
 */
export function isInSubnet(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/**
 * Hook global (onRequest): rejeita 403 `Tailnet only` para clientes que não
 * chegam por Tailscale. Permite quando:
 * 1. IP está na CGNAT Tailscale (100.64.0.0/10) — com trustProxy, request.ip
 *    já resolve X-Forwarded-For do proxy (Caddy/Next.js);
 * 2. `Host` contém `TAILSCALE_HOST` (MagicDNS);
 * 3. `Origin` está na allowlist `ALLOWED_ORIGINS`;
 * 4. localhost (dev / healthcheck do Docker) ou NODE_ENV=test.
 */
export function checkTailscaleOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  const env = getEnv();
  const rawIp =
    request.headers['x-forwarded-for'] ??
    (request as unknown as { ip?: string }).ip ??
    '';
  const ip = normalizeIp(String(rawIp).split(',')[0]);
  const host = request.headers.host ?? '';
  const origin = request.headers.origin ?? '';
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tailscaleHost = env.TAILSCALE_HOST;

  if (isInSubnet(ip, '100.64.0.0/10')) return done();
  if (tailscaleHost && host.includes(tailscaleHost)) return done();
  if (origin && allowed.includes(origin)) return done();
  // permitir localhost para dev/test
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.') || process.env.NODE_ENV === 'test') {
    return done();
  }
  reply.code(403).send({ error: 'Tailnet only' });
}