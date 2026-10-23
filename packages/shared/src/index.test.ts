import { describe, expect, it } from 'vitest';
import {
  ALLOWED_MIME_RE,
  CHAT_MESSAGE_MAX,
  MAX_FILE_SIZE_BYTES,
  chatMessageSchema,
  createRoomSchema,
  fileMetaSchema,
  joinRoomSchema,
} from './index.js';

const roomId = '7d1f6a3e-2b4c-4d8e-9f10-112233445566';

describe('@scale/shared', () => {
  it('aceita os MIME da allowlist e recusa o resto', () => {
    for (const ok of ['image/png', 'application/pdf', 'text/plain', 'audio/mpeg', 'application/zip']) {
      expect(ALLOWED_MIME_RE.test(ok)).toBe(true);
    }
    for (const bad of ['text/html', 'application/x-msdownload', 'image', 'application/pdfx']) {
      expect(ALLOWED_MIME_RE.test(bad)).toBe(false);
    }
  });

  it('limita mensagem de chat a CHAT_MESSAGE_MAX', () => {
    expect(chatMessageSchema.safeParse({ roomId, content: 'a'.repeat(CHAT_MESSAGE_MAX) }).success).toBe(true);
    expect(chatMessageSchema.safeParse({ roomId, content: 'a'.repeat(CHAT_MESSAGE_MAX + 1) }).success).toBe(false);
  });

  it('limita arquivo a MAX_FILE_SIZE_BYTES', () => {
    const base = { roomId, filename: 'a.pdf', mime: 'application/pdf' };
    expect(fileMetaSchema.safeParse({ ...base, size: MAX_FILE_SIZE_BYTES }).success).toBe(true);
    expect(fileMetaSchema.safeParse({ ...base, size: MAX_FILE_SIZE_BYTES + 1 }).success).toBe(false);
  });

  it('exige UUID na sala ao entrar', () => {
    expect(joinRoomSchema.safeParse({ roomId: 'nope' }).success).toBe(false);
    expect(joinRoomSchema.safeParse({ roomId }).success).toBe(true);
  });

  it('aplica defaults e teto de participantes na criacao de sala', () => {
    expect(createRoomSchema.parse({ name: 'Sala' })).toMatchObject({ maxParticipants: 8, isPersistent: false });
    expect(createRoomSchema.safeParse({ name: 'Sala', maxParticipants: 9 }).success).toBe(false);
    expect(createRoomSchema.safeParse({ name: 'ab' }).success).toBe(false);
  });
});
