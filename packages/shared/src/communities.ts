import { z } from 'zod';
import { CHANNEL_NAME_MAX, CHAT_MESSAGE_MAX, COMMUNITY_NAME_MAX } from './limits.js';

export const communityRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export const channelKindSchema = z.enum(['TEXT', 'VOICE']);
export const communityNameSchema = z.string().trim().min(1).max(COMMUNITY_NAME_MAX);
export const channelNameSchema = z.string().trim().min(1).max(CHANNEL_NAME_MAX);
export const communityCreateSchema = z.object({ name: communityNameSchema });
export const communityUpdateSchema = communityCreateSchema;
export const channelCreateSchema = z.object({ name: channelNameSchema, kind: channelKindSchema });
/** Topico do canal (Fase 2): texto curto no cabecalho; vazio limpa (vira null). */
export const CHANNEL_TOPIC_MAX = 200;
export const channelTopicSchema = z.string().trim().max(CHANNEL_TOPIC_MAX);
export const channelUpdateSchema = z
  .object({ name: channelNameSchema.optional(), topic: channelTopicSchema.nullable().optional() })
  .refine((v) => v.name !== undefined || v.topic !== undefined, { message: 'Nada para alterar' });
export const communityMemberRoleSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });
export const MAX_CUSTOM_ROLES = 20;
export const communityPermissionsSchema = z.object({
  manageChannels: z.boolean(), manageInvites: z.boolean(), manageMessages: z.boolean(), kickMembers: z.boolean(),
});
export const customRoleInputSchema = z.object({
  name: z.string().trim().min(1).max(32),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  permissions: communityPermissionsSchema,
});
export const memberCustomRoleSchema = z.object({ customRoleId: z.string().uuid().nullable() });
export const communityInviteCreateSchema = z.object({
  expiresIn: z.enum(['1h', '24h', '7d']).default('7d'),
  maxUses: z.number().int().min(1).max(100).optional(),
});
export const communityInviteCodeSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
});
export const channelMessageSendSchema = z.object({
  content: z.string().trim().min(1).max(CHAT_MESSAGE_MAX),
});
export const communitySubscriptionSchema = z.object({ communityId: z.string().uuid() });
/** Membro conectado num canal de voz: mudo/deafen/tela vem de `peer:audio-state` e `peer:voice-flags`. */
export const communityVoiceMemberSchema = z.object({
  userId: z.string(),
  name: z.string(),
  muted: z.boolean().default(false),
  deafened: z.boolean().default(false),
  screenSharing: z.boolean().default(false),
});
export const communityVoiceStateSchema = z.object({
  channelId: z.string().uuid(),
  members: z.array(communityVoiceMemberSchema),
});
/** `community:voice-speaking`: transicao de "falando" (cliente limita a frequencia). */
export const communityVoiceSpeakingSchema = z.object({
  channelId: z.string().uuid(),
  userId: z.string(),
  speaking: z.boolean(),
});
/** `community:presence`: membro ficou online (1o socket logado) ou offline (ultimo saiu). */
export const communityPresenceSchema = z.object({
  communityId: z.string().uuid(),
  userId: z.string(),
  online: z.boolean(),
});
export const communitySubscriptionAckSchema = z.union([
  z.object({
    success: z.literal(true),
    voiceStates: z.array(communityVoiceStateSchema),
    onlineUserIds: z.array(z.string()).default([]),
  }),
  z.object({ error: z.string() }),
]);
export const channelMessageEditEventSchema = z.object({
  channelId: z.string().uuid(), messageId: z.string().uuid(), content: z.string(), editedAt: z.string(),
});
export const channelMessageDeleteEventSchema = z.object({
  channelId: z.string().uuid(), messageId: z.string().uuid(), deletedAt: z.string(),
});

export type CommunityPermissions = z.infer<typeof communityPermissionsSchema>;
export type CustomRoleInput = z.infer<typeof customRoleInputSchema>;
export type CommunityRole = z.infer<typeof communityRoleSchema>;
export type ChannelKind = z.infer<typeof channelKindSchema>;
export type CommunitySubscription = z.infer<typeof communitySubscriptionSchema>;
export type CommunityVoiceState = z.infer<typeof communityVoiceStateSchema>;
export type CommunityVoiceMember = z.infer<typeof communityVoiceMemberSchema>;
export type CommunityVoiceSpeaking = z.infer<typeof communityVoiceSpeakingSchema>;
export type CommunityPresence = z.infer<typeof communityPresenceSchema>;
export type CommunitySubscriptionAck = z.infer<typeof communitySubscriptionAckSchema>;
export type ChannelMessageEditEvent = z.infer<typeof channelMessageEditEventSchema>;
export type ChannelMessageDeleteEvent = z.infer<typeof channelMessageDeleteEventSchema>;

/** Aviso leve em `user:<id>`: houve mensagem nova num canal (sem conteudo). */
export const communityActivityEventSchema = z.object({
  communityId: z.string().uuid(), channelId: z.string().uuid(), authorId: z.string().nullable(),
});
export type CommunityActivityEvent = z.infer<typeof communityActivityEventSchema>;
/** Texto curto da contagem de nao lidas: ate 99, depois "99+". */
export const formatUnreadCount = (count: number): string => (count > 99 ? '99+' : String(count));
/** Categorias de canais (Fase 1): nome e posicao; canal sem categoria fica nos grupos de texto/voz. */
export const MAX_CHANNEL_CATEGORIES = 20;
export const CATEGORY_NAME_MAX = 40;
export const categoryNameSchema = z.string().trim().min(1).max(CATEGORY_NAME_MAX);
export const categoryInputSchema = z.object({ name: categoryNameSchema });
/**
 * Ordem completa da comunidade: categorias na ordem nova e TODOS os canais na
 * ordem nova, cada um com a categoria (ou null). Lista incompleta = 400.
 */
export const communityLayoutSchema = z.object({
  categories: z.array(z.string().uuid()).max(MAX_CHANNEL_CATEGORIES),
  channels: z.array(z.object({ id: z.string().uuid(), categoryId: z.string().uuid().nullable() })).max(200),
});
/** Imagens da comunidade: icone (bloco do rail) e banner (topo da lista de canais). */
export const communityImageKindSchema = z.enum(['icon', 'banner']);

export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type CommunityLayout = z.infer<typeof communityLayoutSchema>;
export type CommunityImageKind = z.infer<typeof communityImageKindSchema>;

/** `channel:typing` (cliente -> servidor): comecou/parou de digitar num canal de texto. */
export const channelTypingSendSchema = z.object({ channelId: z.string().uuid(), typing: z.boolean() });
/** `channel:typing` (servidor -> comunidade): repassado sem guardar; o remetente nao recebe. */
export const channelTypingEventSchema = z.object({
  communityId: z.string().uuid(), channelId: z.string().uuid(), userId: z.string(), name: z.string(), typing: z.boolean(),
});
export type ChannelTypingSend = z.infer<typeof channelTypingSendSchema>;
export type ChannelTypingEvent = z.infer<typeof channelTypingEventSchema>;
/** Texto do indicador: 1, 2 ou "varias pessoas"; lista vazia = null. */
export const formatTypingText = (names: string[]): string | null => {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} está digitando`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando`;
  return 'Várias pessoas estão digitando';
};
