import { z } from 'zod';
import { SCREEN_SHARE_CONSENT_VERSION, type ModerationConfig } from '@scale/shared';

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

  // --- Assistente de moderacao, gate de partilha de tela e LGPD (secao 7 da
  // spec docs/superpowers/specs/2026-11-11-moderacao-assistente-design.md).
  MODERATION_PROVIDER: z.enum(['off', 'heuristic', 'claude']).default('heuristic'),
  MODERATION_MODEL: z.string().trim().min(1).default('claude-opus-5-5'),
  // Nunca logada, nunca devolvida em DTO. Obrigatoria com `claude` em producao.
  ANTHROPIC_API_KEY: z.string().optional(),
  MODERATION_SCREEN: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default('false'),
  MODERATION_FRAME_INTERVAL_SEC: z.coerce.number().int().min(10).max(120).default(20),
  MODERATION_RETENTION_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  SCREEN_SHARE_MIN_AGE: z.coerce.number().int().min(13).max(21).default(18),
  PRIVACY_CONTACT_EMAIL: z.string().trim().default(''),
});

const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  if (env.JWT_SECRET.trim().length < JWT_SECRET_MIN_LENGTH_PRODUCTION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: `JWT_SECRET curto ou de exemplo (minimo ${JWT_SECRET_MIN_LENGTH_PRODUCTION} caracteres) — obrigatorio em producao`,
    });
  }
  // Provedor `claude` sem chave em producao: recusa subir (fail-fast) em vez
  // de rodar fail-open silencioso para sempre.
  if (env.MODERATION_PROVIDER === 'claude' && !env.ANTHROPIC_API_KEY?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['ANTHROPIC_API_KEY'],
      message: 'ANTHROPIC_API_KEY e obrigatoria com MODERATION_PROVIDER=claude em producao',
    });
  }
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
  screenWarned = false;
}

let screenWarned = false;

/**
 * Amostragem de tela EFETIVA: MODERATION_SCREEN=true so vale com o provedor
 * `claude` (o unico que classifica imagem). Com outro provedor fica false e
 * avisa uma vez no log — a rota de frame descarta sem chamar ninguem.
 */
export function isScreenModerationEnabled(log?: { warn: (msg: string) => void }): boolean {
  const env = getEnv();
  if (!env.MODERATION_SCREEN) return false;
  if (env.MODERATION_PROVIDER === 'claude') return true;
  if (!screenWarned) {
    screenWarned = true;
    log?.warn('MODERATION_SCREEN=true exige MODERATION_PROVIDER=claude; amostragem de tela desligada');
  }
  return false;
}

/** DTO publico de `GET /api/moderation/config` (sem chave, sem modelo). */
export function getModerationConfig(): ModerationConfig {
  const env = getEnv();
  return {
    provider: env.MODERATION_PROVIDER,
    screen: isScreenModerationEnabled(),
    minAge: env.SCREEN_SHARE_MIN_AGE,
    consentVersion: SCREEN_SHARE_CONSENT_VERSION,
    frameIntervalSec: env.MODERATION_FRAME_INTERVAL_SEC,
    privacyContactEmail: env.PRIVACY_CONTACT_EMAIL || null,
  };
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
