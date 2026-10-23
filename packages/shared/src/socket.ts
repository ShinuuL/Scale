import { z } from 'zod';
import { CHAT_MESSAGE_MAX, MAX_FILE_SIZE_BYTES } from './limits.js';

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
  content: z.string().min(1).max(CHAT_MESSAGE_MAX), // server valida após trim via handler
  mentions: z.array(z.string().min(1).max(50)).max(8).optional(),
});

export const chatEditSchema = z.object({
  roomId: z.string().uuid(),
  messageId: z.string().uuid(),
  content: z.string().min(1).max(CHAT_MESSAGE_MAX),
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
  size: z.number().int().min(1).max(MAX_FILE_SIZE_BYTES),
});

export type ChatMessagePayload = z.infer<typeof chatMessageSchema>;
export type ChatEditPayload = z.infer<typeof chatEditSchema>;
export type ChatDeletePayload = z.infer<typeof chatDeleteSchema>;
export type FileMetaPayload = z.infer<typeof fileMetaSchema>;

// --- Eventos servidor -> cliente (shape do wire) ---

/** Peer na sala, como trafega em `join-room` (ack) e `room:peer-joined`. */
export interface PeerInfo {
  peerId: string;
  /** true quando o peer esta logado. O id do usuario nunca trafega. */
  isRegistered: boolean;
  name: string;
  guestName?: string;
}

/** Payload de `room:peer-left`. */
export interface PeerLeftEvent {
  peerId: string;
}

/**
 * Payload de `room:deleted`: a sala foi apagada (dono ou admin). O servidor
 * emite antes de tirar todos os sockets da sala; o cliente encerra a chamada.
 */
export const roomDeletedEventSchema = z.object({ roomId: z.string().uuid() });
export type RoomDeletedEvent = z.infer<typeof roomDeletedEventSchema>;

/** Payload de `signal:screen-share-state` recebido pelo peer alvo. */
export interface ScreenShareStateEvent {
  fromPeerId: string;
  isScreenSharing: boolean;
}

/** Ack generico dos eventos de signaling/chat. */
export interface SocketAck {
  success?: boolean;
  error?: string;
}

// --- Nome de convidado ---

/** Nome exibido quando o convidado nao informa um nome valido. */
export const GUEST_NAME_FALLBACK = 'Guest';

/** Caracteres de controle/formatacao (inclui bidi override e zero-width). */
const CONTROL_CHARS_RE = /[\p{Cc}\p{Cf}]/u;

/**
 * Nome de convidado: trim, 1..40, sem caracteres de controle. Usado no
 * handshake do Socket.io (`auth.guestName`) e no campo `guestName` do upload.
 */
export const guestNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .refine((v) => !CONTROL_CHARS_RE.test(v), 'guestName contem caracteres de controle');

/** Valida o nome; qualquer valor invalido (ou ausente) vira GUEST_NAME_FALLBACK. */
export function parseGuestName(raw: unknown): string {
  const parsed = guestNameSchema.safeParse(raw);
  return parsed.success ? parsed.data : GUEST_NAME_FALLBACK;
}
