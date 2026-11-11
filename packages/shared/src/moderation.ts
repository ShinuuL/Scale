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
