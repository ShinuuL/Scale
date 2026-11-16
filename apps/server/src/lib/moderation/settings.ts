import {
  SCREEN_SHARE_CONSENT_VERSION,
  type AdminModerationState,
  type ModerationConfig,
  type ModerationEffective,
  type ModerationOverrides,
} from '@scale/shared';
import { getEnv } from '../env.js';
import { prisma } from '../prisma.js';
import { decryptSecret } from '../settingsCrypto.js';

/**
 * Configuracao EFETIVA da moderacao: `override do banco ?? .env`, campo a
 * campo. Chave de API: banco (cifrada) > ANTHROPIC_API_KEY > nenhuma.
 *
 * Cache em memoria (uma leitura do singleton `ModerationSettings`), invalidado
 * pelas rotas de admin apos gravar. O provedor (lib/moderation/index.ts) e
 * recriado junto, porque depende de modelo e chave.
 *
 * Spec: docs/superpowers/specs/2026-11-11-admin-moderacao-design.md
 */

type Log = { warn: (msg: string) => void };

export interface ResolvedModerationSettings extends AdminModerationState {
  /** Chave efetiva, em claro, SO para construir o provedor. Nunca sai daqui para DTO/log. */
  apiKey: string | null;
}

let cache: Promise<ResolvedModerationSettings> | undefined;
/** Env com que o cache foi montado: `resetEnv()` (testes) troca o objeto e invalida sozinho. */
let cacheEnv: ReturnType<typeof getEnv> | undefined;
let screenWarned = false;
const invalidationListeners = new Set<() => void>();

/** Registra quem precisa saber que a config mudou (ex.: cache do provedor). */
export function onModerationSettingsInvalidated(listener: () => void): void {
  invalidationListeners.add(listener);
}

/** Descarta o cache; a proxima leitura volta ao banco. Avisa os ouvintes. */
export function invalidateModerationSettings(): void {
  cache = undefined;
  cacheEnv = undefined;
  screenWarned = false;
  for (const listener of invalidationListeners) listener();
}

function envOverridesView(): ModerationOverrides & { hasApiKey: boolean } {
  const env = getEnv();
  return {
    provider: env.MODERATION_PROVIDER,
    model: env.MODERATION_MODEL,
    screenEnabled: env.MODERATION_SCREEN,
    frameIntervalSec: env.MODERATION_FRAME_INTERVAL_SEC,
    retentionDays: env.MODERATION_RETENTION_DAYS,
    minAge: env.SCREEN_SHARE_MIN_AGE,
    privacyContactEmail: env.PRIVACY_CONTACT_EMAIL || null,
    hasApiKey: Boolean(env.ANTHROPIC_API_KEY?.trim()),
  };
}

async function load(log?: Log): Promise<ResolvedModerationSettings> {
  const env = getEnv();
  const envDefaults = envOverridesView();
  const row = await prisma.moderationSettings.findUnique({ where: { id: 'default' } });

  const provider = (row?.provider ?? null) as ModerationOverrides['provider'];
  const overrides: ModerationOverrides = {
    provider,
    model: row?.model ?? null,
    screenEnabled: row?.screenEnabled ?? null,
    frameIntervalSec: row?.frameIntervalSec ?? null,
    retentionDays: row?.retentionDays ?? null,
    minAge: row?.minAge ?? null,
    privacyContactEmail: row?.privacyContactEmail ?? null,
  };

  const dbKey = row?.apiKeyCiphertext ? decryptSecret(row.apiKeyCiphertext, log) : null;
  const envKey = env.ANTHROPIC_API_KEY?.trim() || null;
  const apiKey = dbKey ?? envKey;
  const apiKeySource: ModerationEffective['apiKeySource'] = dbKey ? 'db' : envKey ? 'env' : 'none';

  const effProvider = overrides.provider ?? envDefaults.provider ?? 'heuristic';
  const screenEnabled = overrides.screenEnabled ?? envDefaults.screenEnabled ?? false;
  const effective: ModerationEffective = {
    provider: effProvider,
    screen: screenEnabled && effProvider === 'claude',
    minAge: overrides.minAge ?? envDefaults.minAge ?? 18,
    consentVersion: SCREEN_SHARE_CONSENT_VERSION,
    frameIntervalSec: overrides.frameIntervalSec ?? envDefaults.frameIntervalSec ?? 20,
    privacyContactEmail: overrides.privacyContactEmail ?? envDefaults.privacyContactEmail,
    model: overrides.model ?? envDefaults.model ?? 'claude-opus-5-5',
    retentionDays: overrides.retentionDays ?? envDefaults.retentionDays ?? 90,
    hasApiKey: apiKey !== null,
    apiKeySource,
  };

  let updatedBy: AdminModerationState['updatedBy'] = null;
  if (row?.updatedById) {
    const admin = await prisma.user.findUnique({ where: { id: row.updatedById }, select: { id: true, name: true } });
    updatedBy = admin ?? { id: row.updatedById, name: 'Conta removida' };
  }

  return {
    effective,
    overrides,
    envDefaults,
    updatedAt: row ? row.updatedAt.toISOString() : null,
    updatedBy,
    apiKey,
  };
}

/** Leitura completa (com a chave em claro): uso interno do provedor e das rotas de admin. */
export function getResolvedModerationSettings(log?: Log): Promise<ResolvedModerationSettings> {
  const env = getEnv();
  if (!cache || cacheEnv !== env) {
    cacheEnv = env;
    const pending = load(log).catch((err: unknown) => {
      // Falha no banco nao fica em cache: a proxima chamada tenta de novo.
      if (cache === pending) cache = undefined;
      throw err;
    });
    cache = pending;
  }
  return cache;
}

/** `AdminModerationState` (shared) — sem a chave. */
export async function getEffectiveModerationSettings(log?: Log): Promise<AdminModerationState> {
  const { apiKey: _apiKey, ...state } = await getResolvedModerationSettings(log);
  void _apiKey;
  return state;
}

/**
 * Amostragem de tela EFETIVA: `screenEnabled` so vale com o provedor `claude`
 * (o unico que classifica imagem). Com outro provedor fica false e avisa uma
 * vez no log — a rota de frame descarta sem chamar ninguem.
 */
export async function isScreenModerationEnabled(log?: Log): Promise<boolean> {
  const { effective, overrides, envDefaults } = await getResolvedModerationSettings(log);
  if (effective.screen) return true;
  const wanted = overrides.screenEnabled ?? envDefaults.screenEnabled ?? false;
  if (wanted && !screenWarned) {
    screenWarned = true;
    log?.warn('Analise de tela ligada exige provedor claude; amostragem de tela desligada');
  }
  return false;
}

/** DTO publico de `GET /api/moderation/config` (sem chave, sem modelo). */
export async function getModerationConfig(log?: Log): Promise<ModerationConfig> {
  const { effective } = await getResolvedModerationSettings(log);
  return {
    provider: effective.provider,
    screen: effective.screen,
    minAge: effective.minAge,
    consentVersion: effective.consentVersion,
    frameIntervalSec: effective.frameIntervalSec,
    privacyContactEmail: effective.privacyContactEmail,
  };
}

/** Idade minima efetiva para o gate de partilha de tela. */
export async function getEffectiveMinAge(): Promise<number> {
  return (await getResolvedModerationSettings()).effective.minAge;
}
