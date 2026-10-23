import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import { sanitizeFilename, detectMagicBytes, saveFile, getQuotaUsage, UPLOADS_ROOT } from '../lib/uploads.js';
import { ALLOWED_MIME_RE, CHAT_MESSAGE_MAX, MAX_FILE_SIZE_BYTES, parseGuestName } from '@scale/shared';
import { extractAccessFromHeaders, guardRoomAccess } from '../lib/roomAccess.js';
import { addChatFilesBytes, incQuotaExceeded } from '../lib/metrics.js';
import { toPublicFile } from '../lib/publicDto.js';
import { emitChatMessage } from '../socket/handler.js';
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

    // Membership ANTES de bufferizar (DoS hardening — critic): request.parts()
    // yield fields E files; coletamos os fields (inviteToken/password) e só então,
    // ao PRIMEIRO file part, validamos hasRoomAccess com room — sem toBuffer().
    // Nosso client (useChat.uploadFiles) envia os fields de credencial ANTES dos
    // files, então a ordem do multipart garante que a checagem vê os campos.
    // Se o acesso falhar, retornamos 403 SEM consumir/bufferizar o stream.
    const files = await request.parts(); // fastify-multipart
    const parts: Array<{ filename: string; mime: string; buffer: Buffer; fieldname: string }> = [];
    const fields: Record<string, string> = {};
    let fileCount = 0;
    let totalNew = 0;
    let membershipChecked = false;
    for await (const part of files) {
      if (part.type === 'field') {
        fields[part.fieldname] = String(part.value ?? '');
        continue;
      }

      if (!membershipChecked) {
        const creds = { userId: request.userId, inviteToken: fields.inviteToken, password: fields.password };
        if (!(await guardRoomAccess(request, reply, room, creds))) {
          return reply;
        }
        membershipChecked = true;
      }

      const buf = await part.toBuffer();
      if (buf.length > MAX_FILE_SIZE_BYTES) return reply.code(413).send({ error: 'File too large. Max 15MB' });
      const mime = part.mimetype;
      if (!ALLOWED_MIME_RE.test(mime)) return reply.code(400).send({ error: 'Tipo não permitido', mime });
      // Magic bytes ESTRITO (critic): se detectMagicBytes devolve um mime canônico
      // e ele difere do declarado → 400. Isso bloqueia QUALQUER mismatch, incl.
      // application/pdf com image/png declarado (o branch antigo de prefix-match
      // deixava passar). text/plain não tem magic (detected null) → permitido pelo
      // mime declarado.
      const detected = detectMagicBytes(buf);
      if (detected !== null && detected !== mime) {
        return reply.code(400).send({ error: 'Magic bytes mismatch', detected, declared: mime });
      }
      parts.push({ filename: part.filename, mime, buffer: buf, fieldname: part.fieldname });
      fileCount += 1;
      totalNew += buf.length;
    }
    if (fileCount === 0) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });

    if (fileCount > 5) return reply.code(400).send({ error: 'Máx. 5 arquivos por mensagem' });

    const quota = await getQuotaUsage(roomId);
    if (quota + totalNew > 200 * 1024 * 1024) {
      incQuotaExceeded();
      return reply.code(413).send({ error: 'Quota exceeded' });
    }

    // cria ChatMessage para agrupar arquivos (content vem do campo multipart 'content')
    const contentField = fields.content ?? (request.body as Record<string, unknown>)?.content;
    const content = (typeof contentField === 'string' ? contentField : '').trim().slice(0, CHAT_MESSAGE_MAX) ?? '';
    const userId = (request as unknown as { userId?: string }).userId ?? null;
    // Autor do upload: sem guestName a mensagem cai no fallback 'Anon' de
    // ChatMessageItem.tsx:84 e o autor do arquivo se perde na UI.
    const guestName = request.userName ?? parseGuestName(fields.guestName);
    const message = await prisma.chatMessage.create({
      data: { roomId, content, authorId: userId, guestName },
    });

    const createdFiles = [];
    for (const p of parts) {
      const fileId = crypto.randomUUID();
      const relPath = await saveFile(roomId, fileId, p.filename, p.buffer);
      const cf = await prisma.chatFile.create({
        data: { id: fileId, roomId, messageId: message.id, filename: sanitizeFilename(p.filename), mime: p.mime, size: p.buffer.length, path: relPath, uploadedBy: userId },
      });
      createdFiles.push(cf);
    }
    addChatFilesBytes(totalNew);

    // broadcast como chat:message
    // DTO publico por destinatario: sem path/uploadedBy/authorId.
    const io = (fastify as unknown as { io?: import('socket.io').Server }).io;
    if (io) emitChatMessage(io, roomId, { ...message, files: createdFiles });

    return reply.code(201).send({ files: createdFiles.map(toPublicFile), messageId: message.id });
  });

  fastify.get<{ Params: { fileId: string } }>('/api/files/:fileId', async (request, reply) => {
    const { fileId } = request.params;
    const file = await prisma.chatFile.findUnique({ where: { id: fileId } });
    if (!file) return reply.code(404).send({ error: 'File not found' });

    // Membership: valida a sala do arquivo (e não um roomId arbitrário).
    const room = await prisma.room.findUnique({ where: { id: file.roomId } });
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    if (!(await guardRoomAccess(request, reply, room, extractAccessFromHeaders(request)))) {
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
