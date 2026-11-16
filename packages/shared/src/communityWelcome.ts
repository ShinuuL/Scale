import { z } from 'zod';
import { MAX_PARTICIPANTS } from './limits.js';

/* ─── Fase 3: limite do canal de voz e canal de boas-vindas ─────────── */

/** Limite de pessoas num canal de voz: opcional, 2..teto do mesh. */
export const VOICE_USER_LIMIT_MIN = 2;
export const voiceUserLimitSchema = z.number().int().min(VOICE_USER_LIMIT_MIN).max(MAX_PARTICIPANTS);
/** `PUT /api/channels/:id/user-limit`: null remove o limite (vale o teto do mesh). */
export const channelUserLimitSchema = z.object({ userLimit: voiceUserLimitSchema.nullable() });
/** Capacidade efetiva: o limite do canal, nunca acima do teto do mesh. */
export const effectiveVoiceLimit = (userLimit: number | null | undefined): number =>
  Math.min(userLimit ?? MAX_PARTICIPANTS, MAX_PARTICIPANTS);
/** Texto "3/4" do canal com limite; sem limite = null. */
export const formatVoiceCount = (count: number, userLimit: number | null | undefined): string | null =>
  userLimit ? `${count}/${userLimit}` : null;
export const isVoiceChannelFull = (count: number, userLimit: number | null | undefined): boolean =>
  count >= effectiveVoiceLimit(userLimit);
/** Erro do ack do join-room quando o canal de voz da comunidade esta cheio. */
export const VOICE_CHANNEL_FULL_ERROR = 'Voice channel is full';

/** Mensagem de boas-vindas: modelo com `{nome}`. */
export const WELCOME_MESSAGE_MAX = 500;
export const WELCOME_NAME_TOKEN = '{nome}';
export const DEFAULT_WELCOME_MESSAGE = 'Boas-vindas, {nome}!';
export const welcomeMessageSchema = z.string().trim().min(1).max(WELCOME_MESSAGE_MAX);
/** `PUT /api/communities/:id/welcome`: channelId null desliga as boas-vindas. */
export const communityWelcomeSchema = z.object({
  channelId: z.string().uuid().nullable(),
  message: welcomeMessageSchema,
});
/** Troca todas as ocorrencias de `{nome}` pelo nome de quem entrou. */
export const renderWelcomeMessage = (template: string, name: string): string =>
  template.split(WELCOME_NAME_TOKEN).join(name);

export type ChannelUserLimit = z.infer<typeof channelUserLimitSchema>;
export type CommunityWelcome = z.infer<typeof communityWelcomeSchema>;
