import { z } from 'zod';

export const joinRoomSchema = z.object({
  roomId: z.string().uuid(),
  inviteToken: z.string().uuid().optional(),
  guestName: z.string().min(1).max(50).optional(),
  password: z.string().min(8).max(128).optional(),
});

export const leaveRoomSchema = z.object({
  roomId: z.string().uuid(),
});

export const offerSchema = z.object({
  roomId: z.string().uuid(),
  targetPeerId: z.string(),
  offer: z.object({
    type: z.literal('offer'),
    sdp: z.string(),
  }),
});

export const answerSchema = z.object({
  roomId: z.string().uuid(),
  targetPeerId: z.string(),
  answer: z.object({
    type: z.literal('answer'),
    sdp: z.string(),
  }),
});

export const iceCandidateSchema = z.object({
  roomId: z.string().uuid(),
  targetPeerId: z.string(),
  candidate: z.object({
    candidate: z.string(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().nullable().optional(),
    usernameFragment: z.string().optional(),
  }),
});

export type JoinRoomPayload = z.infer<typeof joinRoomSchema>;
export type LeaveRoomPayload = z.infer<typeof leaveRoomSchema>;
export type OfferPayload = z.infer<typeof offerSchema>;
export type AnswerPayload = z.infer<typeof answerSchema>;
export type IceCandidatePayload = z.infer<typeof iceCandidateSchema>;

export const screenShareStateSchema = z.object({
  roomId: z.string().uuid(),
  targetPeerId: z.string(),
  isScreenSharing: z.boolean(),
});

export type ScreenShareStatePayload = z.infer<typeof screenShareStateSchema>;

// --- Chat schemas (Opção A) — trim aplicado no handler (content.trim()) antes do safeParse ---

export const chatMessageSchema = z.object({
  roomId: z.string().uuid(),
  content: z.string().min(1).max(500), // server valida após trim via handler
  mentions: z.array(z.string().min(1).max(50)).max(8).optional(),
});

export const chatEditSchema = z.object({
  roomId: z.string().uuid(),
  messageId: z.string().uuid(),
  content: z.string().min(1).max(500),
});

export const chatDeleteSchema = z.object({
  roomId: z.string().uuid(),
  messageId: z.string().uuid(),
});

export const fileMetaSchema = z.object({
  roomId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
  filename: z.string().min(1).max(255),
  mime: z.string().min(3).max(127),
  size: z.number().int().min(1).max(15_000_000),
});

export type ChatMessagePayload = z.infer<typeof chatMessageSchema>;
export type ChatEditPayload = z.infer<typeof chatEditSchema>;
export type ChatDeletePayload = z.infer<typeof chatDeleteSchema>;
export type FileMetaPayload = z.infer<typeof fileMetaSchema>;
