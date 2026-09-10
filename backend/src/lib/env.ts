import { z } from 'zod';

const envSchema = z.object({
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters'),
  DATABASE_URL: z.string().default('file:/app/data/data.db'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(4000),
  TAILSCALE_IP: z.string().optional(),
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

export function resetEnv(): void {
  _env = undefined;
}
