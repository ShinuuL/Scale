import { z } from 'zod';
import { CHANNEL_NAME_MAX, CHAT_MESSAGE_MAX, COMMUNITY_NAME_MAX } from './limits.js';

export const communityRoleSchema = z.enum(['OWNER', 'ADMIN', 'MEMBER']);
export const channelKindSchema = z.enum(['TEXT', 'VOICE']);
export const communityNameSchema = z.string().trim().min(1).max(COMMUNITY_NAME_MAX);
export const channelNameSchema = z.string().trim().min(1).max(CHANNEL_NAME_MAX);
export const communityCreateSchema = z.object({ name: communityNameSchema });
export const communityUpdateSchema = communityCreateSchema;
export const channelCreateSchema = z.object({ name: channelNameSchema, kind: channelKindSchema });
export const channelUpdateSchema = z.object({ name: channelNameSchema });
export const communityMemberRoleSchema = z.object({ role: z.enum(['ADMIN', 'MEMBER']) });
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
export const communityVoiceStateSchema = z.object({
  channelId: z.string().uuid(),
  members: z.array(z.object({ userId: z.string(), name: z.string() })),
});
export const communitySubscriptionAckSchema = z.union([
  z.object({ success: z.literal(true), voiceStates: z.array(communityVoiceStateSchema) }),
  z.object({ error: z.string() }),
]);
export const channelMessageEditEventSchema = z.object({
  channelId: z.string().uuid(), messageId: z.string().uuid(), content: z.string(), editedAt: z.string(),
});
export const channelMessageDeleteEventSchema = z.object({
  channelId: z.string().uuid(), messageId: z.string().uuid(), deletedAt: z.string(),
});

export type CommunityRole = z.infer<typeof communityRoleSchema>;
export type ChannelKind = z.infer<typeof channelKindSchema>;
export type CommunitySubscription = z.infer<typeof communitySubscriptionSchema>;
export type CommunityVoiceState = z.infer<typeof communityVoiceStateSchema>;
export type CommunitySubscriptionAck = z.infer<typeof communitySubscriptionAckSchema>;
export type ChannelMessageEditEvent = z.infer<typeof channelMessageEditEventSchema>;
export type ChannelMessageDeleteEvent = z.infer<typeof channelMessageDeleteEventSchema>;
