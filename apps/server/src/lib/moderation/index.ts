import type { FastifyBaseLogger } from 'fastify';
import { getResolvedModerationSettings, isScreenModerationEnabled, onModerationSettingsInvalidated, type ResolvedModerationSettings } from './settings.js';
import { prisma } from '../prisma.js';
import { createClaudeProvider } from './claude.js';
import { heuristicProvider } from './heuristic.js';
import { NONE_VERDICT, PROVIDER_ERROR_VERDICT, type ModerationProvider, type ModerationVerdict } from './types.js';

export type { ModerationProvider, ModerationVerdict } from './types.js';
export { NONE_VERDICT, PROVIDER_ERROR_VERDICT } from './types.js';

type Log = Pick<FastifyBaseLogger, 'warn' | 'error'>;

const offProvider: ModerationProvider = {
  name: 'off',
  async classifyText() {
    return NONE_VERDICT;
  },
};

let cached: { settings: ResolvedModerationSettings; provider: ModerationProvider } | undefined;
let override: ModerationProvider | undefined;

onModerationSettingsInvalidated(() => {
  cached = undefined;
});

/**
 * Provedor conforme a configuracao EFETIVA (banco ?? .env): provedor, modelo e
 * chave. Cacheado por leitura dos settings — invalidar os settings (rotas de
 * admin) recria o provedor na proxima chamada.
 */
export async function getModerationProvider(log?: Log): Promise<ModerationProvider> {
  if (override) return override;
  const settings = await getResolvedModerationSettings(log);
  if (cached && cached.settings === settings) return cached.provider;
  let provider: ModerationProvider;
  switch (settings.effective.provider) {
    case 'off':
      provider = offProvider;
      break;
    case 'claude': {
      // Fora de producao a chave pode faltar (o env.ts so recusa em producao):
      // cai no fail-open em vez de derrubar o dev.
      provider = settings.apiKey
        ? createClaudeProvider({ apiKey: settings.apiKey, model: settings.effective.model })
        : offProvider;
      break;
    }
    default:
      provider = heuristicProvider;
  }
  cached = { settings, provider };
  return provider;
}

/** Testes: injeta um provedor (undefined = volta ao do ambiente). */
export function setModerationProviderForTests(provider: ModerationProvider | undefined): void {
  override = provider;
  cached = undefined;
}

export function resetModerationProvider(): void {
  cached = undefined;
}

/**
 * Classifica texto. Falha do provedor = fail-open com log (sem o texto): a
 * mensagem passa com `reason: 'provider_error'`.
 */
export async function moderateText(text: string, log?: Log): Promise<ModerationVerdict> {
  const provider = await getModerationProvider(log);
  if (provider.name === 'off') return NONE_VERDICT;
  try {
    return await provider.classifyText(text, { lang: 'pt' });
  } catch (err) {
    log?.warn({ provider: provider.name, err: errorSummary(err) }, 'moderation: text provider failed (fail-open)');
    return PROVIDER_ERROR_VERDICT;
  }
}

/**
 * Classifica uma amostra JPEG da tela. So com MODERATION_SCREEN efetivo e
 * provedor com imagem; senao devolve `none` sem chamar ninguem. O frame nunca
 * e gravado nem logado.
 */
export async function moderateImage(jpeg: Buffer, log?: Log): Promise<ModerationVerdict> {
  if (!(await isScreenModerationEnabled(log))) return NONE_VERDICT;
  const provider = await getModerationProvider(log);
  if (!provider.classifyImage) return NONE_VERDICT;
  try {
    return await provider.classifyImage(jpeg);
  } catch (err) {
    log?.warn({ provider: provider.name, err: errorSummary(err) }, 'moderation: image provider failed (fail-open)');
    return PROVIDER_ERROR_VERDICT;
  }
}

/** So nome/status do erro: nunca o corpo da requisicao nem a chave. */
function errorSummary(err: unknown): { name: string; status?: number } {
  const e = err as { name?: string; status?: number } | null;
  return { name: e?.name ?? 'Error', status: typeof e?.status === 'number' ? e.status : undefined };
}

export const EXCERPT_MAX = 120;

export interface ModerationEventInput {
  kind: 'text' | 'frame' | 'report';
  source: 'chat' | 'dm' | 'screen' | 'user';
  roomId?: string | null;
  userId?: string | null;
  guestId?: string | null;
  reporterId?: string | null;
  category: string;
  severity: string;
  action: 'blocked' | 'warned' | 'stopped-share' | 'reported' | 'none';
  /** Texto: truncado a 120 chars. Frame: SEMPRE omitido. */
  excerpt?: string | null;
}

/** Grava o evento (minimizado). Nunca derruba o caminho principal. */
export async function recordModerationEvent(input: ModerationEventInput, log?: Log): Promise<void> {
  const excerpt = input.kind === 'frame' ? null : (input.excerpt?.slice(0, EXCERPT_MAX) ?? null);
  try {
    await prisma.moderationEvent.create({
      data: {
        kind: input.kind,
        source: input.source,
        roomId: input.roomId ?? null,
        userId: input.userId ?? null,
        guestId: input.guestId ?? null,
        reporterId: input.reporterId ?? null,
        category: input.category,
        severity: input.severity,
        action: input.action,
        excerpt,
      },
    });
  } catch (err) {
    log?.error({ err: errorSummary(err) }, 'moderation: failed to record event');
  }
}

/**
 * Retencao (LGPD): apaga ModerationEvent mais antigos que a retencao EFETIVA
 * (override do admin ?? MODERATION_RETENTION_DAYS). Chamado pelo sweep de
 * salas (mesmo intervalo).
 */
export async function sweepModerationEvents(opts: { now?: Date; retentionDays?: number } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const days = opts.retentionDays ?? (await getResolvedModerationSettings()).effective.retentionDays;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const result = await prisma.moderationEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
