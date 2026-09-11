import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../lib/prisma.js';
import { sanitizeFilename, detectMagicBytes, saveFile, getQuotaUsage, ALLOWED_MIME_RE } from '../lib/uploads.js';

export async function filesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post<{ Params: { id: string } }>('/api/rooms/:id/files', async (request, reply) => {
    const roomId = request.params.id;
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    if (!room.isPersistent) return reply.code(400).send({ error: 'Temporary rooms do not support files' });

    // membership stub — hardening Task 15 completa com checkTailscaleOrigin + token
    const files = await request.files(); // fastify-multipart
    const parts: Array<{ filename: string; mime: string; buffer: Buffer; fieldname: string }> = [];
    let totalNew = 0;
    for await (const part of files) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      if (buf.length > 15_000_000) return reply.code(413).send({ error: 'File too large. Max 15MB' });
      const mime = part.mimetype;
      if (!ALLOWED_MIME_RE.test(mime)) return reply.code(400).send({ error: 'Tipo não permitido', mime });
      const detected = detectMagicBytes(buf);
      // text/plain não tem magic — permite se mime é text/plain
      if (detected && !mime.includes(detected.split('/')[0]) && detected !== mime) {
        // permite image/png vs detected image/png exato; rejeita mismatch grosseiro ex: image/png com ZIP magic
        const isMismatch = (detected === 'application/zip' && !mime.includes('zip')) || (detected.startsWith('image/') && !mime.startsWith('image/'));
        if (isMismatch) return reply.code(400).send({ error: 'Magic bytes mismatch', detected, declared: mime });
      }
      parts.push({ filename: part.filename, mime, buffer: buf, fieldname: part.fieldname });
      totalNew += buf.length;
    }
    if (parts.length === 0) return reply.code(400).send({ error: 'Nenhum arquivo enviado' });
    if (parts.length > 5) return reply.code(400).send({ error: 'Máx. 5 arquivos por mensagem' });

    const quota = await getQuotaUsage(roomId);
    if (quota + totalNew > 200 * 1024 * 1024) return reply.code(413).send({ error: 'Quota exceeded' });

    // cria ChatMessage para agrupar arquivos (content pode vir de field 'content')
    const contentField = (request.body as Record<string, unknown>)?.content as string | undefined;
    const content = contentField?.trim().slice(0, 500) ?? '';
    const userId = (request as unknown as { userId?: string }).userId ?? null;
    const message = await prisma.chatMessage.create({ data: { roomId, content, authorId: userId } });

    const createdFiles = [];
    for (const p of parts) {
      const fileId = crypto.randomUUID();
      const relPath = await saveFile(roomId, fileId, p.filename, p.buffer);
      const cf = await prisma.chatFile.create({
        data: { id: fileId, roomId, messageId: message.id, filename: sanitizeFilename(p.filename), mime: p.mime, size: p.buffer.length, path: relPath, uploadedBy: userId },
      });
      createdFiles.push(cf);
    }

    // broadcast como chat:message
    const io = (fastify as unknown as { io?: import('socket.io').Server }).io;
    io?.to(roomId).emit('chat:message', { ...message, files: createdFiles });

    return reply.code(201).send({ files: createdFiles, messageId: message.id });
  });

  fastify.get<{ Params: { fileId: string } }>('/api/files/:fileId', async (request, reply) => {
    const { fileId } = request.params;
    const file = await prisma.chatFile.findUnique({ where: { id: fileId } });
    if (!file) return reply.code(404).send({ error: 'File not found' });
    if (file.deletedAt && Date.now() - new Date(file.deletedAt).getTime() > 7 * 24 * 60 * 60 * 1000) {
      return reply.code(410).send({ error: 'Gone' });
    }
    const abs = path.resolve(process.cwd(), file.path);
    const root = path.resolve(process.cwd(), 'uploads');
    if (!abs.startsWith(root)) return reply.code(400).send({ error: 'Invalid path' });
    // membership check stub
    reply.header('Content-Type', file.mime);
    reply.header('Content-Disposition', `attachment; filename="${file.filename}"`);
    reply.header('X-Content-Type-Options', 'nosniff');
    const stream = fs.createReadStream(abs);
    return reply.send(stream);
  });
}
