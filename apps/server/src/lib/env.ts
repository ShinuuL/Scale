import { z } from 'zod';

/**
 * Minimo do JWT_SECRET em producao. Quem conhece este segredo forja sessao de
 * qualquer usuario, vira admin (o e-mail vem do token) e emite room tickets
 * (derivados dele). O valor de exemplo do .env.example fica abaixo do minimo, de
 * proposito: copiar o arquivo sem trocar o segredo derruba o start.
 */
export const JWT_SECRET_MIN_LENGTH_PRODUCTION = 32;

const baseEnvSchema = z.object({
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

const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (env.JWT_SECRET.trim().length >= JWT_SECRET_MIN_LENGTH_PRODUCTION) return;
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['JWT_SECRET'],
    message: `JWT_SECRET curto ou de exemplo (minimo ${JWT_SECRET_MIN_LENGTH_PRODUCTION} caracteres) — obrigatorio em producao`,
  });
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

const adminAuthSchema = z.object({
  // CSV de emails (normalizados) dos administradores do sistema. Vazio = ninguem.
  ADMIN_EMAILS: z.string().default(''),
  // Sinonimo LEGADO de ADMIN_EMAILS (nome antigo, da epoca em que so o
  // /api/metrics tinha admin). Continua aceito; os dois sao unidos.
  METRICS_ADMIN_EMAILS: z.string().default(''),
});

function parseEmailCsv(csv: string): string[] {
  return csv
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Emails dos administradores do sistema: ADMIN_EMAILS ∪ METRICS_ADMIN_EMAILS
 * (legado). Lido do ambiente a cada chamada (barato; os testes trocam a lista
 * sem reiniciar o cache do getEnv). Fonte UNICA para toda checagem de admin.
 */
export function getAdminEmails(): Set<string> {
  const parsed = adminAuthSchema.parse(process.env);
  return new Set([
    ...parseEmailCsv(parsed.ADMIN_EMAILS),
    ...parseEmailCsv(parsed.METRICS_ADMIN_EMAILS),
  ]);
}

/** true quando o email (do JWT) pertence a um administrador do sistema. */
export function isSystemAdmin(email: string | null | undefined): boolean {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return false;
  return getAdminEmails().has(normalized);
}

export interface MetricsAuthConfig {
  adminEmails: Set<string>;
}

/**
 * Config de acesso a /api/metrics (= admins do sistema), lida do ambiente a cada chamada (barato e
 * permite que os testes troquem a allowlist sem reiniciar o cache do getEnv).
 */
export function getMetricsAuthConfig(): MetricsAuthConfig {
  return { adminEmails: getAdminEmails() };
}
