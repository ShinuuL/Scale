import { z } from 'zod';
import { MAX_PARTICIPANTS, ROOM_NAME_MAX, ROOM_NAME_MIN } from './limits.js';

/**
 * Campos de criacao de sala comuns ao formulario (web) e a rota POST /api/rooms
 * (server). O server estende com `password` (sala privada).
 */
export const createRoomSchema = z.object({
  name: z
    .string()
    .min(ROOM_NAME_MIN, `Room name must be at least ${ROOM_NAME_MIN} characters`)
    .max(ROOM_NAME_MAX, `Room name must be at most ${ROOM_NAME_MAX} characters`),
  isPersistent: z.boolean().default(false),
  isPrivate: z.boolean().default(false),
  maxParticipants: z.number().int().min(2).max(MAX_PARTICIPANTS).default(MAX_PARTICIPANTS),
  ttlMinutes: z.number().int().min(1).max(1440).optional(), // 1 min a 24 h
});

export type CreateRoomInput = z.infer<typeof createRoomSchema>;
