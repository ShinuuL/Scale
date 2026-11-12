import { z } from 'zod';

/**
 * Moderacao, gate de partilha de tela e LGPD.
 * Spec: docs/superpowers/specs/2026-11-11-moderacao-assistente-design.md
 */

/** Versao do termo de partilha de tela. Mudar o texto = mudar aqui = pedir de novo. */
export const SCREEN_SHARE_CONSENT_VERSION = '2026-11';

export const moderationCategorySchema = z.enum(['bullying', 'hate', 'sexual', 'violence', 'none']);
export const moderationSeveritySchema = z.enum(['low', 'medium', 'high']);
export type ModerationCategory = z.infer<typeof moderationCategorySchema>;
export type ModerationSeverity = z.infer<typeof moderationSeveritySchema>;

export const moderationVerdictSchema = z.object({
  flagged: z.boolean(),
  category: moderationCategorySchema,
  severity: moderationSeveritySchema,
  /** Curto; nunca copia o conteudo analisado. */
  reason: z.string().max(200),
});
export type ModerationVerdict = z.infer<typeof moderationVerdictSchema>;

/** `GET /api/moderation/config` (publico). */
export const moderationConfigSchema = z.object({
  provider: z.enum(['off', 'heuristic', 'claude']),
  /** Amostragem de tela ligada (exige provedor com imagem). */
  screen: z.boolean(),
  minAge: z.number().int(),
  consentVersion: z.string(),
  frameIntervalSec: z.number().int(),
  privacyContactEmail: z.string().nullable(),
});
export type ModerationConfig = z.infer<typeof moderationConfigSchema>;

/** Estado do gate no DTO do proprio usuario (`/api/auth/me`). Sem birthDate. */
export const screenShareGateSchema = z.object({
  ageVerified: z.boolean(),
  isAdult: z.boolean(),
  consentVersion: z.string().nullable(),
  allowed: z.boolean(),
  reason: z.enum(['guest', 'age', 'consent', 'ok']),
});
export type ScreenShareGate = z.infer<typeof screenShareGateSchema>;

/** `PUT /api/me/age` */
export const setBirthDateSchema = z.object({
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD'),
});
/** `PUT /api/me/screen-share-consent` */
export const screenShareConsentSchema = z.object({
  version: z.literal(SCREEN_SHARE_CONSENT_VERSION),
});

export const MODERATION_REPORT_DETAILS_MAX = 300;
export const moderationReportReasonSchema = z.enum(['bullying', 'hate', 'sexual', 'violence', 'other']);
/** `moderation:report` (socket, dentro da sala). */
export const moderationReportSchema = z.object({
  roomId: z.string().uuid(),
  targetPeerId: z.string().min(1),
  reason: moderationReportReasonSchema,
  details: z.string().trim().max(MODERATION_REPORT_DETAILS_MAX).optional(),
});
export type ModerationReportPayload = z.infer<typeof moderationReportSchema>;

/** `moderation:stop-share` (socket, so o dono da sala). */
export const moderationStopShareSchema = z.object({
  roomId: z.string().uuid(),
  targetPeerId: z.string().min(1),
});

/** `moderation:action` (servidor -> cliente alvo). */
export const moderationActionSchema = z.object({
  roomId: z.string().uuid(),
  action: z.enum(['stop-screen-share']),
  category: moderationCategorySchema,
  /** 'assistant' = veredito automatico; 'owner' = dono da sala. */
  by: z.enum(['assistant', 'owner']),
});
export type ModerationActionPayload = z.infer<typeof moderationActionSchema>;

/** `moderation:warning` (servidor -> autor). */
export const moderationWarningSchema = z.object({
  roomId: z.string().uuid().optional(),
  category: moderationCategorySchema,
  text: z.string(),
});
export type ModerationWarningPayload = z.infer<typeof moderationWarningSchema>;

/** `moderation:notice` (servidor -> dono da sala). */
export const moderationNoticeSchema = z.object({
  roomId: z.string().uuid(),
  peerId: z.string(),
  kind: z.enum(['frame', 'report', 'text']),
  category: moderationCategorySchema,
});
export type ModerationNoticePayload = z.infer<typeof moderationNoticeSchema>;

/** Limites da amostra de tela enviada pelo sharer. */
export const MODERATION_FRAME_MAX_BYTES = 200 * 1024;
export const MODERATION_FRAME_MAX_WIDTH = 480;

// ---------------------------------------------------------------------------
// Painel de administracao da moderacao (PR 2). Spec:
// docs/superpowers/specs/2026-11-11-admin-moderacao-design.md
// Overrides gravados no banco por admin do sistema; `null` = volta ao .env.
// A chave de API NUNCA volta ao cliente: so `hasApiKey` e `apiKeySource`.
// ---------------------------------------------------------------------------

export const moderationProviderSchema = z.enum(['off', 'heuristic', 'claude']);

/** `PUT /api/admin/moderation` — parcial; campo ausente = nao mexe; null = usa o .env. */
export const adminModerationUpdateSchema = z
  .object({
    provider: moderationProviderSchema.nullable(),
    model: z.string().trim().min(1).max(80).nullable(),
    screenEnabled: z.boolean().nullable(),
    frameIntervalSec: z.number().int().min(10).max(120).nullable(),
    retentionDays: z.number().int().min(1).max(365).nullable(),
    minAge: z.number().int().min(13).max(21).nullable(),
    privacyContactEmail: z.string().trim().email().max(120).nullable(),
    /** Nova chave (gravada cifrada). Para remover: `DELETE /api/admin/moderation/api-key`. */
    apiKey: z.string().trim().min(10).max(400),
  })
  .partial()
  .strict();
export type AdminModerationUpdate = z.infer<typeof adminModerationUpdateSchema>;

export const moderationOverridesSchema = z.object({
  provider: moderationProviderSchema.nullable(),
  model: z.string().nullable(),
  screenEnabled: z.boolean().nullable(),
  frameIntervalSec: z.number().int().nullable(),
  retentionDays: z.number().int().nullable(),
  minAge: z.number().int().nullable(),
  privacyContactEmail: z.string().nullable(),
});
export type ModerationOverrides = z.infer<typeof moderationOverridesSchema>;

export const moderationEffectiveSchema = moderationConfigSchema.extend({
  model: z.string(),
  retentionDays: z.number().int(),
  hasApiKey: z.boolean(),
  apiKeySource: z.enum(['db', 'env', 'none']),
});
export type ModerationEffective = z.infer<typeof moderationEffectiveSchema>;

/** `GET|PUT /api/admin/moderation` */
export const adminModerationStateSchema = z.object({
  effective: moderationEffectiveSchema,
  overrides: moderationOverridesSchema,
  envDefaults: moderationOverridesSchema.extend({ hasApiKey: z.boolean() }),
  updatedAt: z.string().nullable(),
  updatedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type AdminModerationState = z.infer<typeof adminModerationStateSchema>;

/** `POST /api/admin/moderation/test` */
export const adminModerationTestSchema = z.object({ text: z.string().trim().min(1).max(2000) });

export const moderationAuditEntrySchema = z.object({
  id: z.string(),
  admin: z.object({ id: z.string(), name: z.string() }),
  /** `{ campo: { from, to } }`; `apiKey` aparece so como `'set' | 'cleared'`. */
  changes: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })),
  createdAt: z.string(),
});
export type ModerationAuditEntry = z.infer<typeof moderationAuditEntrySchema>;
