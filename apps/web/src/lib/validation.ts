import { z } from 'zod';
import { ALLOWED_MIME_RE, CHAT_MESSAGE_MAX, MAX_FILE_SIZE_BYTES } from '@scale/shared';

// ─── Room schemas ───────────────────────────────────────────────
// Schema de criacao e limites do nome sao os MESMOS do server (@scale/shared).
export { ROOM_NAME_MIN, ROOM_NAME_MAX, createRoomSchema } from '@scale/shared';
export type { CreateRoomInput } from '@scale/shared';

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
  // ID de usuário é cuid do Prisma (ex.: `cmv9ruyob0000uv343dhsfa9s`), não UUID.
  // Exigir `.uuid()` quebrava o parse de /api/auth/{register,login} e fazia a UI
  // mostrar "Falha ao criar conta"/"Falha ao fazer login" mesmo com sucesso.
  id: z.string().min(1),
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
    // Contagens por sala SEM identificadores (o roomId da acesso a sala).
    perRoom: z.array(z.number()),
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
  .max(CHAT_MESSAGE_MAX, `Máx. ${CHAT_MESSAGE_MAX} caracteres`);

export const chatEditClientSchema = z
  .string()
  .trim()
  .min(1, 'Mensagem não pode estar vazia')
  .max(CHAT_MESSAGE_MAX, `Máx. ${CHAT_MESSAGE_MAX} caracteres`);

/** Mesma allowlist do server (@scale/shared); o server ainda confere magic bytes. */
export const ALLOWED_MIME_CLIENT_RE = ALLOWED_MIME_RE;

export const fileClientSchema = z
  .object({
    file: z.instanceof(File),
  })
  .refine((f) => f.file.size <= MAX_FILE_SIZE_BYTES, 'Máx. 15MB')
  .refine((f) => ALLOWED_MIME_CLIENT_RE.test(f.file.type), 'Tipo não permitido');
