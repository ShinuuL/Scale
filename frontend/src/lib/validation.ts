import { z } from 'zod';

// ─── Room schemas ───────────────────────────────────────────────
export const createRoomSchema = z.object({
  name: z.string().min(3, 'Room name must be at least 3 characters').max(50, 'Room name must be at most 50 characters'),
  isPersistent: z.boolean().default(false),
  isPrivate: z.boolean().default(false),
  maxParticipants: z.number().int().min(2).max(8).default(8),
  ttlMinutes: z.number().int().min(1).max(1440).optional(),
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;

// ─── Auth schemas ───────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  name: z.string().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
});

export type RegisterInput = z.infer<typeof registerSchema>;

// ─── Room response type ─────────────────────────────────────────
export const roomResponseSchema = z.object({
  room: z.object({
    id: z.string().uuid(),
    name: z.string(),
    isPersistent: z.boolean(),
    isPrivate: z.boolean(),
    maxParticipants: z.number(),
    expiresAt: z.string().nullable().optional(),
    createdAt: z.string(),
    status: z.string(),
    // Só presente na resposta do POST /api/rooms e para o dono no GET /api/rooms/:id
    inviteToken: z.string().optional(),
  }),
});

export type RoomResponse = z.infer<typeof roomResponseSchema>;

export const roomListItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isPersistent: z.boolean(),
  isPrivate: z.boolean(),
  maxParticipants: z.number(),
  createdAt: z.string(),
  // Só presente na listagem quando o requester é o dono da sala
  inviteToken: z.string().optional(),
});

export type RoomListItem = z.infer<typeof roomListItemSchema>;

// ─── Auth response types ────────────────────────────────────────
export const userResponseSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  createdAt: z.string(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;

export const authResponseSchema = z.object({
  user: userResponseSchema,
  token: z.string(),
});

export type AuthResponse = z.infer<typeof authResponseSchema>;

// ─── Tailscale status ──────────────────────────────────────────
export const tailscaleStatusSchema = z.object({
  tailscaleIp: z.string().nullable(),
  configured: z.boolean(),
  interfaceDetected: z.boolean(),
});

export type TailscaleStatus = z.infer<typeof tailscaleStatusSchema>;

// ─── Metrics ───────────────────────────────────────────────────
export const metricsSchema = z.object({
  uptimeSeconds: z.number(),
  rooms: z.object({
    total: z.number(),
    active: z.number(),
    withPeers: z.number(),
  }),
  peers: z.object({
    total: z.number(),
    byRoom: z.record(z.string(), z.number()),
  }),
  memory: z.object({
    rss: z.number(),
    heapTotal: z.number(),
    heapUsed: z.number(),
    external: z.number(),
  }),
  version: z.string(),
});

export type Metrics = z.infer<typeof metricsSchema>;

// ─── Chat (Opção A) — mirror do backend para UX; server valida de novo ───
export const chatMessageClientSchema = z
  .string()
  .trim()
  .min(1, 'Mensagem não pode estar vazia')
  .max(500, 'Máx. 500 caracteres');

export const chatEditClientSchema = z
  .string()
  .trim()
  .min(1, 'Mensagem não pode estar vazia')
  .max(500, 'Máx. 500 caracteres');

export const ALLOWED_MIME_CLIENT_RE =
  /^(image\/.*|application\/pdf|text\/plain|audio\/.*|application\/zip)$/;

export const fileClientSchema = z
  .object({
    file: z.instanceof(File),
  })
  .refine((f) => f.file.size <= 15_000_000, 'Máx. 15MB')
  .refine((f) => ALLOWED_MIME_CLIENT_RE.test(f.file.type), 'Tipo não permitido');
