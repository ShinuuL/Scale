import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Server } from 'socket.io';
import { z } from 'zod';
import { MODERATION_FRAME_MAX_BYTES, type ModerationActionPayload, type ModerationNoticePayload, type ModerationWarningPayload } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { guardRoomParticipation } from '../lib/roomAccess.js';
import { isModerationFrameRateLimited } from '../lib/rateLimit.js';
import { moderateImage, recordModerationEvent } from '../lib/moderation/index.js';
import { getModerationConfig, isScreenModerationEnabled } from '../lib/moderation/settings.js';
import { findUserSocketInRoom, getRoomOwnerSocketIds } from '../socket/handler.js';

const roomParams = z.object({ roomId: z.string().uuid() });

/** JPEG comeca com FF D8 FF. */
export function isJpeg(buf: Buffer): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

/**
 * Le o unico arquivo do multipart em memoria (ate MODERATION_FRAME_MAX_BYTES).
 * 'none' = sem arquivo; null = estourou o limite.
 */
async function readFrame(request: FastifyRequest): Promise<Buffer | null | 'none'> {
  const part = await request.file({ limits: { fileSize: MODERATION_FRAME_MAX_BYTES, files: 1 } });
  if (!part) return 'none';
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of part.file as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MODERATION_FRAME_MAX_BYTES) {
      part.file.resume();
      return null;
    }
    chunks.push(chunk);
  }
  if (part.file.truncated) return null;
  return Buffer.concat(chunks);
}

export async function moderationRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/moderation/config — publico; sem chave nem modelo.
  fastify.get('/api/moderation/config', async (_request, reply) => {
    return reply.send(await getModerationConfig(fastify.log));
  });

  // POST /api/rooms/:roomId/moderation/frame — amostra JPEG (<= 200 KB) da
  // propria tela, enviada pelo sharer LOGADO com room ticket (ou dono). Responde
  // 204 sempre que aceitou: o veredito vai por socket, nunca na resposta (a rota
  // nao vira oraculo do classificador). O frame vive so em memoria.
  fastify.post<{ Params: { roomId: string } }>('/api/rooms/:roomId/moderation/frame', async (request, reply) => {
    const params = roomParams.safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: 'Room not found' });
    const userId = request.userId;
    // So usuario logado compartilha tela (gate): convidado nem chega aqui.
    if (!userId) return reply.code(401).send({ error: 'Authentication required' });

    const room = await prisma.room.findUnique({ where: { id: params.data.roomId } });
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    const participant = await guardRoomParticipation(request, reply, room);
    if (!participant) return reply;

    const limit = isModerationFrameRateLimited(`u:${userId}`);
    if (limit.limited) {
      return reply.header('Retry-After', String(limit.retryAfterSeconds)).code(429).send({ error: 'Too many frames. Slow down.' });
    }

    const frame = await readFrame(request);
    if (frame === 'none') return reply.code(400).send({ error: 'Nenhum frame enviado' });
    if (frame === null) return reply.code(413).send({ error: 'Frame too large. Max 200KB' });
    if (!isJpeg(frame)) return reply.code(400).send({ error: 'Frame must be JPEG' });

    // Amostragem desligada (ou provedor sem imagem): 204 e descarta.
    if (!(await isScreenModerationEnabled(fastify.log))) return reply.code(204).send();

    // Veredito fora do ciclo da resposta? Nao: a classificacao e curta (8 s) e
    // o cliente nao espera a resposta para continuar; mas respondemos 204 antes
    // de emitir para o socket nao ter o timing da resposta como oraculo.
    const verdict = await moderateImage(frame, fastify.log);
    void reply.code(204).send();

    if (verdict.severity !== 'high' && verdict.severity !== 'medium') return;
    const io = (fastify as unknown as { io?: Server }).io;
    const sharerSocketId = findUserSocketInRoom(room.id, userId);

    if (verdict.severity === 'high') {
      await recordModerationEvent({
        kind: 'frame', source: 'screen', roomId: room.id, userId, category: verdict.category,
        severity: verdict.severity, action: 'stopped-share',
      }, fastify.log);
      if (!io) return;
      if (sharerSocketId) {
        const action: ModerationActionPayload = { roomId: room.id, action: 'stop-screen-share', category: verdict.category, by: 'assistant' };
        io.to(sharerSocketId).emit('moderation:action', action);
      }
      if (room.ownerId && sharerSocketId) {
        const notice: ModerationNoticePayload = { roomId: room.id, peerId: sharerSocketId, kind: 'frame', category: verdict.category };
        for (const sid of getRoomOwnerSocketIds(room.id, room.ownerId)) io.to(sid).emit('moderation:notice', notice);
      }
      return;
    }

    await recordModerationEvent({
      kind: 'frame', source: 'screen', roomId: room.id, userId, category: verdict.category,
      severity: verdict.severity, action: 'warned',
    }, fastify.log);
    if (io && sharerSocketId) {
      const warning: ModerationWarningPayload = {
        roomId: room.id,
        category: verdict.category,
        text: 'O assistente de moderacao marcou o conteudo da sua tela. Verifique o que esta compartilhando.',
      };
      io.to(sharerSocketId).emit('moderation:warning', warning);
    }
  });
}
