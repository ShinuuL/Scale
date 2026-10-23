import { z } from 'zod';

const envSchema = z.object({
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  DATABASE_URL: z.string().default('file:/app/data/data.db'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(4000),
  // Semantica do trustProxy do Fastify: false (default) | true | lista de
  // CIDRs/IPs (ex.: "127.0.0.1/8,::1/128" ou "loopback").
  // O default e FAIL-CLOSED (`false`): a chave dos rate limits por IP passa a ser
  // o IP do socket e nenhum header (X-Forwarded-For/cf-connecting-ip) e aceito —
  // do contrario qualquer cliente forja o header a cada request e fura TODOS os
  // baldes por IP. So confie em headers configurando explicitamente o CIDR do
  // proxy/tunel (ex.: "loopback" quando o tunel roda na mesma maquina).
  // Numeros (hops) sao rejeitados — ver lib/clientIp.ts resolveTrustProxy.
  TRUST_PROXY: z.string().default('false'),
  ENABLE_TURN: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}

/**
 * Whitelist de origens em lista, a partir de ALLOWED_ORIGINS (CSV).
 *
 * Fonte ÚNICA para o CORS do HTTP (plugins/cors.ts) e o CORS do Socket.io
 * (socket/handler.ts): se um dia divergirem, o browser pode conectar o WS e ter
 * as chamadas REST bloqueadas (ou o inverso).
 */
export function getAllowedOrigins(): string[] {
  return getEnv()
    .ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function resetEnv(): void {
  _env = undefined;
}

const metricsAuthSchema = z.object({
  // CSV de emails (normalizados) que podem ler /api/metrics. Vazio = ninguem.
  METRICS_ADMIN_EMAILS: z.string().default(''),
  // Token de servico (MCP) para /api/metrics. Vazio = desligado; < 32
  // caracteres e ignorado (fail-closed).
  METRICS_SERVICE_TOKEN: z.string().default(''),
});

export interface MetricsAuthConfig {
  adminEmails: Set<string>;
  serviceToken: string | null;
}

/** Minimo de caracteres de um token de servico aceito. */
export const SERVICE_TOKEN_MIN_LENGTH = 32;

/**
 * Config de acesso a /api/metrics, lida do ambiente a cada chamada (barato e
 * permite que os testes troquem a allowlist sem reiniciar o cache do getEnv).
 */
export function getMetricsAuthConfig(): MetricsAuthConfig {
  const parsed = metricsAuthSchema.parse(process.env);
  const adminEmails = new Set(
    parsed.METRICS_ADMIN_EMAILS.split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
  const token = parsed.METRICS_SERVICE_TOKEN.trim();
  return {
    adminEmails,
    serviceToken: token.length >= SERVICE_TOKEN_MIN_LENGTH ? token : null,
  };
}
