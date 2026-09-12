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
export function normalizeIp(ip: string): string {
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

/** Ranges privados tratados como tráfego interno aceito pelo Tailnet barrier. */
const PRIVATE_CIDRS = [
  '127.0.0.0/8', // loopback (dev / healthcheck do Docker)
  '10.0.0.0/8', // LAN privada
  '172.16.0.0/12', // LAN privada + bridge do Docker (172.17.0.0/16 → 172.18.x)
  '192.168.0.0/16', // LAN privada
  '100.64.0.0/10', // CGNAT Tailscale
] as const;

/**
 * True para IPs de redes privadas/loopback/CGNAT. Cobre de uma vez localhost,
 * LAN, bridge do Docker (ex.: 172.18.0.5) e a tailnet — sem whitelist manual
 * de cada faixa.
 */
export function isPrivateIp(ip: string): boolean {
  return PRIVATE_CIDRS.some((cidr) => isInSubnet(ip, cidr));
}

/** Hosts internos do Docker Compose / rewrites do Next.js / healthchecks locais. */
const INTERNAL_HOSTS: readonly string[] = [
  'backend:4000',
  'frontend:3000',
  'localhost:3000',
  'localhost:4000',
  '127.0.0.1:4000',
];

/**
 * Decisão única do Tailnet barrier, compartilhada pelo hook onRequest do REST
 * (checkTailscaleOrigin) e pelo middleware io.use do Socket.io (handler.ts).
 * Permite quando:
 * 1. IP está em rede privada/loopback/CGNAT (isPrivateIp) — inclui LAN, bridge
 *    do Docker (rewrite interno do Next.js) e a tailnet;
 * 2. `Host` é um nome interno do compose/rewrite (backend:4000, localhost:3000…);
 * 3. `Host` contém `TAILSCALE_HOST` (MagicDNS);
 * 4. `Origin` está na allowlist `ALLOWED_ORIGINS`;
 * 5. NODE_ENV=test (bypass de testes).
 * IP público fora dessas condições → false (REST responde 403, Socket.io
 * responde connect_error "Tailnet only").
 */
export function isTailnetAllowed(input: {
  ip: string; // já normalizado: ::1 → 127.0.0.1, sem prefixo ::ffff:
  host: string;
  origin: string;
}): boolean {
  const env = getEnv();
  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const tailscaleHost = env.TAILSCALE_HOST;
  const host = input.host.trim().toLowerCase();

  if (isPrivateIp(input.ip)) return true;
  if (INTERNAL_HOSTS.includes(host)) return true;
  if (tailscaleHost && host.includes(tailscaleHost.toLowerCase())) return true;
  if (input.origin && allowed.includes(input.origin)) return true;
  if (process.env.NODE_ENV === 'test') return true;
  return false;
}

/**
 * Hook global (onRequest): rejeita 403 `Tailnet only` para clientes que não
 * chegam por rede privada/Tailscale. Com trustProxy, `request.ip` já resolve
 * X-Forwarded-For do proxy (Caddy/Next.js). A decisão vive em isTailnetAllowed.
 */
export function checkTailscaleOrigin(
  request: FastifyRequest,
  reply: FastifyReply,
  done: (err?: Error) => void,
): void {
  const rawIp =
    request.headers['x-forwarded-for'] ??
    (request as unknown as { ip?: string }).ip ??
    '';
  const ip = normalizeIp(String(rawIp).split(',')[0]);
  const host = request.headers.host ?? '';
  const origin = request.headers.origin ?? '';

  if (isTailnetAllowed({ ip, host, origin })) return done();
  reply.code(403).send({ error: 'Tailnet only' });
}
