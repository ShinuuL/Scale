import { z } from 'zod';

/* ─── Fase 3: permissoes por canal, canal de avisos e modo lento ─────── */

/** Alvo da sobrescrita: todos os membros ou um cargo personalizado. */
export const CHANNEL_EVERYONE = 'everyone';
export const channelOverrideTargetSchema = z.union([z.literal(CHANNEL_EVERYONE), z.string().uuid()]);
/** true = permite, false = nega, null = herda. */
export const channelOverrideValueSchema = z.boolean().nullable();
export const channelOverrideSchema = z.object({
  target: channelOverrideTargetSchema,
  viewChannel: channelOverrideValueSchema,
  sendMessages: channelOverrideValueSchema,
});
/** Modo lento: valores predefinidos (segundos), de desligado ate 6 h. */
export const SLOW_MODE_PRESETS = [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600] as const;
export const SLOW_MODE_MAX_SECONDS = 21600;
export const slowModeSecondsSchema = z.number().int().refine(
  (v) => (SLOW_MODE_PRESETS as readonly number[]).includes(v), { message: 'Intervalo invalido' },
);
/** PUT /api/channels/:id/settings: substitui as sobrescritas inteiras. */
export const channelSettingsSchema = z.object({
  announcement: z.boolean(),
  slowModeSeconds: slowModeSecondsSchema,
  overrides: z.array(channelOverrideSchema).max(21),
}).refine((v) => new Set(v.overrides.map((o) => o.target)).size === v.overrides.length, { message: 'Alvo repetido' });

export type ChannelOverride = z.infer<typeof channelOverrideSchema>;
export type ChannelSettings = z.infer<typeof channelSettingsSchema>;
export interface ChannelAccess { view: boolean; send: boolean; manage: boolean }

/** Rotulo curto do intervalo: "Desligado", "30 s", "5 min", "1 h". */
export function formatSlowMode(seconds: number): string {
  if (seconds <= 0) return 'Desligado';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  return `${seconds / 3600} h`;
}
/** Contagem regressiva: "45 s", "4:05", "1:02:03". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/**
 * Permissao efetiva num canal. Quem gerencia (dono, ADMIN ou manageChannels)
 * sempre passa. Senao: tudo permitido, aplica a sobrescrita de "todos" e depois
 * a do cargo personalizado (que vence onde nao for null). Canal de avisos: so
 * quem gerencia envia. Sem ver o canal, nao envia.
 */
export function resolveChannelAccess(
  input: { manager: boolean; customRoleId: string | null; announcement: boolean },
  overrides: ReadonlyArray<Pick<ChannelOverride, 'target' | 'viewChannel' | 'sendMessages'>>,
): ChannelAccess {
  if (input.manager) return { view: true, send: true, manage: true };
  let view = true; let send = true;
  const apply = (target: string): void => {
    const o = overrides.find((x) => x.target === target);
    if (!o) return;
    if (o.viewChannel !== null) view = o.viewChannel;
    if (o.sendMessages !== null) send = o.sendMessages;
  };
  apply(CHANNEL_EVERYONE);
  if (input.customRoleId) apply(input.customRoleId);
  if (input.announcement) send = false;
  return { view, send: view && send, manage: false };
}
