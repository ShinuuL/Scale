import { z } from 'zod';

export const joinRoomSchema = z.object({
  roomId: z.string().uuid(),
  inviteToken: z.string().uuid().optional(),
  guestName: z.string().min(1).max(50).optional(),
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
