import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { byteLimit, StreamLimitError, tryResourceLock } from '../lib/resourceLimits.js';
import { prisma } from '../lib/prisma.js';
import { sanitizeFilename, detectMagicBytes, prepareFilePath, readFileHead, getQuotaUsage, UPLOADS_ROOT } from '../lib/uploads.js';
import { ALLOWED_MIME_RE, CHAT_MESSAGE_MAX, MAX_FILES_PER_MESSAGE, ROOM_FILE_QUOTA_BYTES, parseGuestName } from '@scale/shared';
import { guardRoomParticipation } from '../lib/roomAccess.js';
import { toChannelMessage } from '../lib/communityAccess.js';
import { checkChannelPost, emitToChannel, viewableChannel } from '../lib/channelPermissions.js';
import { timedOutBody, timeoutOf } from '../lib/communityModeration.js';
import { addChatFilesBytes, incQuotaExceeded } from '../lib/metrics.js';
import { toPublicFile } from '../lib/publicDto.js';
import { emitChatMessage } from '../socket/handler.js';
import { emitCommunityActivity } from '../lib/unread.js';
import { isFileUploadRateLimited } from '../lib/rateLimit.js';
import { getClientIp } from '../lib/clientIp.js';

/**
 * Nome de exibicao do autor do upload.
 *
 * O upload de arquivo e HTTP, nao Socket.io: para convidado o nome vem do campo
 * multipart `guestName`, validado com o MESMO schema do handshake do socket
 * (parseGuestName: trim, 1..40, sem caracteres de controle; invalido -> 'Guest').
 * Usuario logado usa o nome do JWT.
 */

export async function filesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { id: string } }>('/api/rooms/:id/files', async (request, reply) => {
    // Rate limit ANTES de bufferizar o multipart: cada upload grava bytes no
    // disco e linhas no SQLite, entao o flood de multipart e o custo caro. O IP
    // vem de lib/clientIp.ts (valido atras do proxy /api do Next e do tunel).
    const uploadLimit = isFileUploadRateLimited(getClientIp(request));
    if (uploadLimit.limited) {
      return reply
        .header('Retry-After', String(uploadLimit.retryAfterSeconds))
        .code(429)
        .send({ error: 'Too many uploads. Try again later.' });
    }

    const roomId = request.params.id;
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    if (!room.isPersistent) return reply.code(400).send({ error: 'Temporary rooms do not support files' });
    // Sala encerrada ou expirada nao aceita arquivo (mesma regra do chat:message).
    if (room.status !== 'ACTIVE') return reply.code(409).send({ error: 'Room is no longer active' });
    if (room.expiresAt && room.expiresAt.getTime() < Date.now()) {
      return reply.code(410).send({ error: 'Room has expired' });
    }

    // Participacao efetiva ANTES de ler o multipart (DoS hardening): room
    // ticket do join-room no header X-Room-Ticket, ou dono por JWT. Negado ->
    // 403 sem consumir o stream.
    const participant = await guardRoomParticipation(request, reply, room);
    if (!participant) return reply;
    // Fase 3: canal de comunidade aplica permissao de envio, aviso e modo lento.
    if (room.communityId && participant.userId) {
      const found = await viewableChannel(room.id, participant.userId);
      if (!found) return reply.code(404).send({ error: 'Room not found' });
      const timedOut = await timeoutOf(room.communityId, participant.userId);
      if (timedOut) return reply.code(403).send(timedOutBody(timedOut));
      const post = await checkChannelPost(found.room, found.access, participant.userId);
      if (!post.ok) { if (post.body.retryAfterSeconds) void reply.header('Retry-After', String(post.body.retryAfterSeconds)); return reply.code(post.status).send(post.body); }
    }
    const release = tryResourceLock(`room:${roomId}`);
    if (!release) return reply.header('Retry-After', '1').code(429).send({ error: 'Upload or deletion in progress. Try again.' });
    try {
      const fresh = await prisma.room.findUnique({ where: { id: roomId } });
      if (!fresh || fresh.status !== 'ACTIVE' || (fresh.expiresAt && fresh.expiresAt.getTime() < Date.now())) {
        return reply.code(409).send({ error: 'Room is no longer active' });
      }


      // Arquivos de ate 250 MB: cada parte vai por STREAM direto ao disco (nunca
      // inteira na memoria). Qualquer recusa apaga o que ja foi gravado nesta
      // requisicao — nada fica orfao no disco nem conta na cota.
      const quotaBefore = await getQuotaUsage(roomId);
      let remaining = Math.max(0, ROOM_FILE_QUOTA_BYTES - quotaBefore);
      const saved: Array<{ id: string; filename: string; mime: string; size: number; abs: string; rel: string }> = [];
      const fields: Record<string, string> = {};
      const discard = async (): Promise<void> => {
        await Promise.all(saved.map((f) => fsp.unlink(f.abs).catch(() => {})));
      };
      const reject = async (code: number, body: Record<string, unknown>) => {
        await discard();
        return reply.code(code).send(body);
      };

      try {
        for await (const part of request.parts()) {
          if (part.type === 'field') {
            fields[part.fieldname] = String(part.value ?? '');
            continue;
          }

          const mime = part.mimetype;
          // Canal de texto de comunidade: so imagens (o resto da allowlist e das salas).
          if (!ALLOWED_MIME_RE.test(mime) || (room.communityId && !mime.startsWith('image/'))) {
            part.file.resume();
            return await reject(400, { error: 'Tipo não permitido', mime });
          }

          const id = crypto.randomUUID();
          const { abs, rel } = await prepareFilePath(roomId, id, part.filename);
          const entry = { id, filename: part.filename, mime, size: 0, abs, rel };
          saved.push(entry);
          await pipeline(part.file, byteLimit(remaining, (bytes) => { entry.size += bytes; remaining -= bytes; }), fs.createWriteStream(abs, { mode: 0o600, flags: 'wx' }));
          // Limite do busboy (MAX_FILE_SIZE_BYTES no server.ts): estourou -> truncado.
          if (part.file.truncated) return await reject(413, { error: 'File too large. Max 250MB' });
          entry.size = (await fsp.stat(abs)).size;

          // Magic bytes ESTRITO: se detectMagicBytes devolve um mime canonico e
          // ele difere do declarado -> 400 (bloqueia QUALQUER mismatch, incl.
          // application/pdf declarado image/png). text/plain nao tem magic
          // (detected null) -> permitido pelo mime declarado.
          const detected = detectMagicBytes(await readFileHead(abs));
          if (detected !== null && detected !== mime) {
            return await reject(400, { error: 'Magic bytes mismatch', detected, declared: mime });
          }

          const totalNew = saved.reduce((sum, f) => sum + f.size, 0);
          if (quotaBefore + totalNew > ROOM_FILE_QUOTA_BYTES) {
            incQuotaExceeded();
            return await reject(413, { error: 'Quota exceeded' });
          }
        }
      } catch (err) {
        // Limites do multipart (FilesLimitError, RequestFileTooLargeError) e
        // cliente que caiu no meio do envio.
        await discard();
        if (err instanceof StreamLimitError) {
          incQuotaExceeded();
          return reply.code(413).send({ error: 'Quota exceeded' });
        }
        throw err;
      }

      const fileCount = saved.length;
      const totalNew = saved.reduce((sum, f) => sum + f.size, 0);
      if (fileCount === 0) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });
      if (fileCount > MAX_FILES_PER_MESSAGE) return reject(400, { error: 'Máx. 5 arquivos por mensagem' });

      // cria ChatMessage para agrupar arquivos (content vem do campo multipart 'content')
      const contentField = fields.content ?? (request.body as Record<string, unknown>)?.content;
      const content = (typeof contentField === 'string' ? contentField : '').trim().slice(0, CHAT_MESSAGE_MAX) ?? '';
      const userId = (request as unknown as { userId?: string }).userId ?? null;
      // Autor do upload: sem guestName a mensagem cai no fallback 'Anon' de
      // ChatMessageItem.tsx:84 e o autor do arquivo se perde na UI.
      const guestName = request.userName ?? parseGuestName(fields.guestName);
      // Autoria de convidado = guestId do room ticket (o mesmo do socket que
      // entrou na sala). O nome nao concede nada.
      const guestId = userId ? null : participant.guestId;
      let result;
      try {
        result = await prisma.$transaction(async (tx) => {
          const message = await tx.chatMessage.create({
            data: { roomId, content, authorId: userId, guestName, guestId },
          });
          const createdFiles = [];
          for (const f of saved) {
            createdFiles.push(await tx.chatFile.create({
              data: { id: f.id, roomId, messageId: message.id, filename: sanitizeFilename(f.filename), mime: f.mime, size: f.size, path: f.rel, uploadedBy: userId, guestId },
            }));
          }
          return { message, createdFiles };
        });
      } catch (err) {
        await discard();
        throw err;
      }
      const { message, createdFiles } = result;
      addChatFilesBytes(totalNew);

      // broadcast como chat:message
      // DTO publico por destinatario: sem path/uploadedBy/authorId.
      const io = (fastify as unknown as { io?: import('socket.io').Server }).io;
      if (room.communityId) {
        // Canal de comunidade fala o protocolo channel:* (a pagina da comunidade nao entra na sala).
        const author = userId ? await prisma.user.findUnique({ where: { id: userId }, include: { username: true } }) : null;
        const channelMessage = toChannelMessage({ ...message, files: createdFiles }, { id: userId, name: author?.name ?? guestName, username: author?.username?.name ?? null });
        await emitToChannel(io, room.communityId, room.id, 'channel:message', channelMessage);
        await emitCommunityActivity(io, room.communityId, room.id, userId ?? null);
        return reply.code(201).send({ files: createdFiles.map(toPublicFile), messageId: message.id, message: channelMessage });
      }
      if (io) emitChatMessage(io, roomId, { ...message, files: createdFiles });

      return reply.code(201).send({ files: createdFiles.map(toPublicFile), messageId: message.id });
    } finally { release(); }
  });

  fastify.get<{ Params: { fileId: string } }>('/api/files/:fileId', async (request, reply) => {
    const { fileId } = request.params;
    const file = await prisma.chatFile.findUnique({ where: { id: fileId } });
    if (!file) return reply.code(404).send({ error: 'File not found' });

    // Participacao na sala DO ARQUIVO (e não num roomId arbitrário).
    const room = await prisma.room.findUnique({ where: { id: file.roomId } });
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    if (!(await guardRoomParticipation(request, reply, room))) {
      return reply;
    }

    // Arquivo apagado (soft delete) some na hora: os 7 dias de carencia valem
    // so para GC/quota (lib/uploads.ts), nunca para download.
    if (file.deletedAt != null) {
      return reply.code(410).send({ error: 'Gone' });
    }
    const abs = path.resolve(process.cwd(), file.path);
    // sandbox restrito à pasta da sala: uploads/<roomId>/...
    const roomRoot = path.resolve(UPLOADS_ROOT, file.roomId);
    if (!abs.startsWith(roomRoot + path.sep)) return reply.code(400).send({ error: 'Invalid path' });
    reply.header('Content-Type', file.mime);
    reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    const stream = fs.createReadStream(abs);
    return reply.send(stream);
  });
}
