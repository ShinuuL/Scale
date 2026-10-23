import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { sanitizeFilename, detectMagicBytes, getQuotaUsage } from '../lib/uploads.js';
import { prisma } from '../lib/prisma.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { authPlugin } from '../plugins/auth.js';
import { authRoutes } from '../routes/auth.js';
import { roomRoutes } from '../routes/rooms.js';
import fs from 'node:fs/promises';
import path from 'node:path';

/* ------------------------------------------------------------------ */
/*  uploads lib (Task 6)                                               */
/* ------------------------------------------------------------------ */

describe('uploads lib', () => {
  it('sanitize bloqueia path traversal', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('..');
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
  });

  it('detectMagicBytes identifica png/pdf/zip e rejeita mismatch', () => {
    expect(detectMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectMagicBytes(Buffer.from([0x25, 0x50, 0x44, 0x46]))).toBe('application/pdf');
    expect(detectMagicBytes(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe('application/zip');
    // mismatch: PNG magic bytes must not be accepted as application/pdf
    expect(detectMagicBytes(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).not.toBe('application/pdf');
    // unknown magic → null
    expect(detectMagicBytes(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });

  it('quota soma com grace 7d', async () => {
    const room = await prisma.room.create({
      data: { name: 'Quota Room', isPersistent: true },
    });
    const msg = await prisma.chatMessage.create({
      data: { roomId: room.id, content: 'files' },
    });
    try {
      // recentes (deletedAt null) contam para a quota
      await prisma.chatFile.create({
        data: { roomId: room.id, messageId: msg.id, filename: 'a.png', mime: 'image/png', size: 100, path: `uploads/${room.id}/a.png` },
      });
      await prisma.chatFile.create({
        data: { roomId: room.id, messageId: msg.id, filename: 'b.png', mime: 'image/png', size: 50, path: `uploads/${room.id}/b.png` },
      });
      // apagado há 8 dias (> 7d) NÃO conta
      await prisma.chatFile.create({
        data: {
          roomId: room.id,
          messageId: msg.id,
          filename: 'old.png',
          mime: 'image/png',
          size: 1000,
          path: `uploads/${room.id}/old.png`,
          deletedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
        },
      });
      expect(await getQuotaUsage(room.id)).toBe(150);
    } finally {
      await prisma.room.delete({ where: { id: room.id } }).catch(() => {});
    }
  });
});

/* ------------------------------------------------------------------ */
/*  REST helpers — Task 7                                               */
/* ------------------------------------------------------------------ */

/** Multipart body builder (zero-dep replacement for form-data). */
function multipartBody(
  files: Array<{ filename: string; contentType: string; content: Buffer }>,
  fields: Record<string, string> = {},
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----scale${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  const push = (s: string): void => {
    chunks.push(Buffer.from(s, 'utf8'));
  };
  for (const [name, value] of Object.entries(fields)) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
  }
  for (const f of files) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.filename}"\r\nContent-Type: ${f.contentType}\r\n\r\n`,
    );
    chunks.push(f.content);
    push('\r\n');
  }
  push(`--${boundary}--\r\n`);
  return {
    payload: Buffer.concat(chunks),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/** Build a minimal Fastify app that dynamically registers Task 7 routes. */
async function buildRestApp(): Promise<Fastify.FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authPlugin);
  await app.register(authRoutes);
  await app.register(roomRoutes);

  // Task 7 modules — dynamic imports so the file compiles even when
  // routes/messages.ts and routes/files.ts do not exist yet (Step 2).
  // Once implemented, the modules resolve and routes are registered.
  const multipartMod = await import('@fastify/multipart').catch(() => null);
  const messagesMod = await import('../routes/messages.js').catch(() => null);
  const filesMod = await import('../routes/files.js').catch(() => null);

  if (multipartMod) {
    await app.register(
      (multipartMod as { default?: unknown }).default as never,
      { limits: { fileSize: 15_000_000, files: 5 } } as never,
    );
  }
  if (messagesMod) {
    await app.register(
      (messagesMod as { messagesRoutes?: unknown }).messagesRoutes as never,
    );
  }
  if (filesMod) {
    await app.register(
      (filesMod as { filesRoutes?: unknown }).filesRoutes as never,
    );
  }
  return app;
}

// Magic-byte buffers for multipart test payloads
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
const MP3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00]);
const TXT = Buffer.from('ola mundo\n', 'utf8');

/* ------------------------------------------------------------------ */
/*  REST messages (Task 7)                                              */
/* ------------------------------------------------------------------ */

describe('REST messages', () => {
  let app: Awaited<ReturnType<typeof buildRestApp>>;
  let persistRoomId: string;
  let tempRoomId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    app = await buildRestApp();
    const persist = await prisma.room.create({
      data: { name: 'REST Paginação', isPersistent: true },
    });
    persistRoomId = persist.id;
    const temp = await prisma.room.create({
      data: { name: 'REST Temp Msg', isPersistent: false },
    });
    tempRoomId = temp.id;
  });

  afterAll(async () => {
    await prisma.room
      .deleteMany({
        where: { name: { in: ['REST Paginação', 'REST Temp Msg'] } },
      })
      .catch(() => {});
    await app.close();
  });

  it('GET /rooms/:id/messages paginação 200→50 com nextCursor', async () => {
    const base = new Date('2026-01-01T00:00:00.000Z');
    await prisma.chatMessage.createMany({
      data: Array.from({ length: 60 }, (_, i) => ({
        roomId: persistRoomId,
        content: `msg-${i}`,
        createdAt: new Date(base.getTime() + i * 1000),
      })),
    });

    const first = await app.inject({
      method: 'GET',
      url: `/api/rooms/${persistRoomId}/messages?limit=50`,
    });
    expect(first.statusCode).toBe(200);
    const page1 = JSON.parse(first.payload);
    expect(page1.messages).toHaveLength(50);
    expect(page1.nextCursor).toBeTruthy();
    const times = page1.messages.map(
      (m: { createdAt: string }) => new Date(m.createdAt).getTime(),
    );
    expect(times).toEqual([...times].sort((a: number, b: number) => a - b));

    const second = await app.inject({
      method: 'GET',
      url: `/api/rooms/${persistRoomId}/messages?limit=50&cursor=${page1.nextCursor}`,
    });
    expect(second.statusCode).toBe(200);
    const page2 = JSON.parse(second.payload);
    expect(page2.messages).toHaveLength(10);
    expect(page2.nextCursor).toBeNull();
  });

  it('temporária retorna 400 history', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/rooms/${tempRoomId}/messages`,
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.payload).error).toMatch(/temporary/i);
  });
});

/* ------------------------------------------------------------------ */
/*  REST files (Task 7)                                                 */
/* ------------------------------------------------------------------ */

describe('REST files', () => {
  let app: Awaited<ReturnType<typeof buildRestApp>>;
  let persistRoomId: string;
  let tempRoomId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    app = await buildRestApp();
    const persist = await prisma.room.create({
      data: { name: 'REST Files', isPersistent: true },
    });
    persistRoomId = persist.id;
    const temp = await prisma.room.create({
      data: { name: 'REST Files Temp', isPersistent: false },
    });
    tempRoomId = temp.id;
  });

  afterAll(async () => {
    await prisma.room
      .deleteMany({
        where: { name: { in: ['REST Files', 'REST Files Temp'] } },
      })
      .catch(() => {});
    // cleanup physical uploads dirs created during tests
    for (const rid of [persistRoomId, tempRoomId].filter(Boolean)) {
      await fs
        .rm(path.resolve(process.cwd(), 'uploads', rid), {
          recursive: true,
          force: true,
        })
        .catch(() => {});
    }
    await app.close();
  });

  it('POST rejeita temporária, >15MB, >5 files, mime fora allowlist, magic mismatch, quota 200MB', async () => {
    // temporária
    const tempRes = await app.inject({
      method: 'POST',
      url: `/api/rooms/${tempRoomId}/files`,
      ...multipartBody([
        { filename: 'a.png', contentType: 'image/png', content: PNG },
      ]),
    });
    expect(tempRes.statusCode).toBe(400);

    // >15MB — @fastify/multipart throws RequestFileTooLargeError (413)
    const big = Buffer.concat([PNG, Buffer.alloc(15_000_001)]);
    const bigRes = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody([
        { filename: 'big.png', contentType: 'image/png', content: big },
      ]),
    });
    expect(bigRes.statusCode).toBe(413);

    // >5 files — @fastify/multipart FilesLimitError (413)
    const six = Array.from({ length: 6 }, (_, i) => ({
      filename: `f${i}.txt`,
      contentType: 'text/plain',
      content: Buffer.from(`file-${i}`),
    }));
    const sixRes = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody(six),
    });
    expect(sixRes.statusCode).toBe(413);

    // mime fora allowlist
    const badMime = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody([
        {
          filename: 'evil.exe',
          contentType: 'application/x-msdownload',
          content: Buffer.from('MZ'),
        },
      ]),
    });
    expect(badMime.statusCode).toBe(400);

    // magic mismatch: declared image/png, content ZIP
    const mismatch = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody([
        { filename: 'fake.png', contentType: 'image/png', content: ZIP },
      ]),
    });
    expect(mismatch.statusCode).toBe(400);

    // strict magic (critic): declared image/png, content PDF → 400. O branch
    // antigo de prefix-match (mime.includes) deixava este caso passar.
    const pdfContent = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody([
        { filename: 'evil.png', contentType: 'image/png', content: PDF },
      ]),
    });
    expect(pdfContent.statusCode).toBe(400);
    expect(JSON.parse(pdfContent.payload).error).toMatch(/Magic bytes mismatch/i);
    expect(JSON.parse(pdfContent.payload).detected).toBe('application/pdf');
    expect(JSON.parse(pdfContent.payload).declared).toBe('image/png');

    // quota 200MB
    const quotaRoom = await prisma.room.create({
      data: { name: 'REST Quota', isPersistent: true },
    });
    const quotaMsg = await prisma.chatMessage.create({
      data: { roomId: quotaRoom.id, content: 'quota' },
    });
    await prisma.chatFile.createMany({
      data: Array.from({ length: 199 }, (_, i) => ({
        roomId: quotaRoom.id,
        messageId: quotaMsg.id,
        filename: `q${i}.bin`,
        mime: 'application/zip',
        size: 1_048_576, // 1 MiB each → 199 MiB total
        path: `uploads/${quotaRoom.id}/q${i}.bin`,
      })),
    });
    // 199 MiB < 200 MiB; uploading 2 MiB → exceeds quota → 413
    const upload2mb = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    const quotaRes = await app.inject({
      method: 'POST',
      url: `/api/rooms/${quotaRoom.id}/files`,
      ...multipartBody([
        { filename: 'x.png', contentType: 'image/png', content: upload2mb },
      ]),
    });
    expect(quotaRes.statusCode).toBe(413);
    await prisma.room.delete({ where: { id: quotaRoom.id } }).catch(() => {});
  });

  it('POST aceita image/pdf/txt/audio/zip válidos e GET retorna stream', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody([
        { filename: 'photo.png', contentType: 'image/png', content: PNG },
        { filename: 'doc.pdf', contentType: 'application/pdf', content: PDF },
        { filename: 'readme.txt', contentType: 'text/plain', content: TXT },
        { filename: 'song.mp3', contentType: 'audio/mpeg', content: MP3 },
        { filename: 'archive.zip', contentType: 'application/zip', content: ZIP },
      ]),
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.files).toHaveLength(5);
    expect(body.messageId).toBeDefined();

    // GET the first uploaded file
    const fileId = body.files[0].id;
    const getRes = await app.inject({ method: 'GET', url: `/api/files/${fileId}` });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.headers['content-type']).toMatch(/image\/png/);
    expect(getRes.headers['content-disposition']).toContain('attachment');
    expect(getRes.headers['content-disposition']).toContain('photo.png');
    expect(getRes.headers['x-content-type-options']).toBe('nosniff');
  });

  it('grava o autor do upload (guestName) na mensagem do arquivo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody(
        [{ filename: 'com-autor.zip', contentType: 'application/zip', content: ZIP }],
        { guestName: 'Guest-ab12', content: 'segue o pacote' },
      ),
    });
    expect(res.statusCode).toBe(201);
    const messageId = (JSON.parse(res.payload) as { messageId: string }).messageId;
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    // sem isto a UI cai no fallback 'Anon' (ChatMessageItem.tsx:84)
    expect(msg?.guestName).toBe('Guest-ab12');
    expect(msg?.content).toBe('segue o pacote');
  });

  it('guestName em branco vira null em vez de string vazia', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody(
        [{ filename: 'sem-autor.zip', contentType: 'application/zip', content: ZIP }],
        { guestName: '   ' },
      ),
    });
    expect(res.statusCode).toBe(201);
    const messageId = (JSON.parse(res.payload) as { messageId: string }).messageId;
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    expect(msg?.guestName).toBeNull();
  });

  it('guestName fora do limite e rejeitado (nao grava lixo)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/rooms/${persistRoomId}/files`,
      ...multipartBody(
        [{ filename: 'longo.zip', contentType: 'application/zip', content: ZIP }],
        { guestName: 'x'.repeat(200) },
      ),
    });
    expect(res.statusCode).toBe(201);
    const messageId = (JSON.parse(res.payload) as { messageId: string }).messageId;
    const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
    // .max(40) falha a validacao -> fallback null
    expect(msg?.guestName).toBeNull();
  });

  it('GET 410 após GC (> 7d deletedAt)', async () => {
    const room = await prisma.room.create({
      data: { name: 'REST GC', isPersistent: true },
    });
    const msg = await prisma.chatMessage.create({
      data: { roomId: room.id, content: 'gc' },
    });
    const fileId = crypto.randomUUID();
    const relPath = `uploads/${room.id}/${fileId}-gone.txt`;
    // create physical file, then mark deleted > 7d
    const absDir = path.resolve(process.cwd(), 'uploads', room.id);
    await fs.mkdir(absDir, { recursive: true });
    await fs.writeFile(path.resolve(process.cwd(), relPath), 'gone');
    await prisma.chatFile.create({
      data: {
        id: fileId,
        roomId: room.id,
        messageId: msg.id,
        filename: 'gone.txt',
        mime: 'text/plain',
        size: 4,
        path: relPath,
        deletedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/${fileId}`,
    });
    expect(res.statusCode).toBe(410);
    await prisma.room.delete({ where: { id: room.id } }).catch(() => {});
    await fs.rm(absDir, { recursive: true, force: true }).catch(() => {});
  });

  it('GET 404 para arquivo inexistente', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/files/00000000-0000-0000-0000-000000000000',
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET rejeita path fora de uploads/ (sandbox)', async () => {
    const room = await prisma.room.create({
      data: { name: 'REST Sandbox', isPersistent: true },
    });
    const msg = await prisma.chatMessage.create({
      data: { roomId: room.id, content: 'sb' },
    });
    const fileId = crypto.randomUUID();
    await prisma.chatFile.create({
      data: {
        id: fileId,
        roomId: room.id,
        messageId: msg.id,
        filename: 'escape.txt',
        mime: 'text/plain',
        size: 4,
        path: 'package.json', // escapes uploads/
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/files/${fileId}`,
    });
    expect(res.statusCode).toBe(400);
    await prisma.room.delete({ where: { id: room.id } }).catch(() => {});
  });
});

/* ------------------------------------------------------------------ */
/*  Hardening Task 15 — membership (salas protegidas)                   */
/* ------------------------------------------------------------------ */

describe('REST membership hardening', () => {
  let app: Awaited<ReturnType<typeof buildRestApp>>;
  let privateRoomId: string;
  let privateToken: string;
  let passRoomId: string;

  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-for-unit-tests';
    process.env.NODE_ENV = 'test';
    app = await buildRestApp();
    const priv = await prisma.room.create({
      data: { name: 'REST Private Members', isPersistent: true, isPrivate: true },
    });
    privateRoomId = priv.id;
    privateToken = priv.inviteToken;
    await prisma.chatMessage.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        roomId: privateRoomId,
        content: `p-${i}`,
      })),
    });
    const pass = await prisma.room.create({
      data: {
        name: 'REST Pass Members',
        isPersistent: true,
        passwordHash: bcrypt.hashSync('segredo123', 10),
      },
    });
    passRoomId = pass.id;
  });

  afterAll(async () => {
    await prisma.room
      .deleteMany({
        where: { name: { in: ['REST Private Members', 'REST Pass Members'] } },
      })
      .catch(() => {});
    await fs
      .rm(path.resolve(process.cwd(), 'uploads', privateRoomId), {
        recursive: true,
        force: true,
      })
      .catch(() => {});
    await app.close();
  });

  it('messages: 403 sem creds; 200 com inviteToken ou password', async () => {
    const noCreds = await app.inject({
      method: 'GET',
      url: `/api/rooms/${privateRoomId}/messages`,
    });
    expect(noCreds.statusCode).toBe(403);

    const withToken = await app.inject({
      method: 'GET',
      url: `/api/rooms/${privateRoomId}/messages`,
      headers: { 'x-room-invite': privateToken },
    });
    expect(withToken.statusCode).toBe(200);
    expect(JSON.parse(withToken.payload).messages).toHaveLength(3);

    const withPass = await app.inject({
      method: 'GET',
      url: `/api/rooms/${passRoomId}/messages`,
      headers: { 'x-room-password': 'segredo123' },
    });
    expect(withPass.statusCode).toBe(200);
  });

  it('files POST: 403 sem creds; 201 com inviteToken field', async () => {
    const noCreds = await app.inject({
      method: 'POST',
      url: `/api/rooms/${privateRoomId}/files`,
      ...multipartBody([
        { filename: 'a.png', contentType: 'image/png', content: PNG },
      ]),
    });
    expect(noCreds.statusCode).toBe(403);

    const withToken = await app.inject({
      method: 'POST',
      url: `/api/rooms/${privateRoomId}/files`,
      ...multipartBody(
        [{ filename: 'b.png', contentType: 'image/png', content: PNG }],
        { inviteToken: privateToken },
      ),
    });
    expect(withToken.statusCode).toBe(201);
  });

  it('files POST: 403 sem creds; 201 com password field', async () => {
    const noCreds = await app.inject({
      method: 'POST',
      url: `/api/rooms/${passRoomId}/files`,
      ...multipartBody([
        { filename: 'a.png', contentType: 'image/png', content: PNG },
      ]),
    });
    expect(noCreds.statusCode).toBe(403);

    const withPass = await app.inject({
      method: 'POST',
      url: `/api/rooms/${passRoomId}/files`,
      ...multipartBody(
        [{ filename: 'b.png', contentType: 'image/png', content: PNG }],
        { password: 'segredo123' },
      ),
    });
    expect(withPass.statusCode).toBe(201);
  });

  it('magic bytes ESTRITO: pdf content com image/png declarado → 400 e vice-versa', async () => {
    // declared image/png, content PDF (mesmo com inviteToken válido → 400)
    const pngClaimed = await app.inject({
      method: 'POST',
      url: `/api/rooms/${privateRoomId}/files`,
      ...multipartBody(
        [{ filename: 'fake.png', contentType: 'image/png', content: PDF }],
        { inviteToken: privateToken },
      ),
    });
    expect(pngClaimed.statusCode).toBe(400);
    expect(JSON.parse(pngClaimed.payload).error).toMatch(/Magic bytes mismatch/i);

    // declared application/pdf, content PNG → 400 (mismatch simétrico)
    const pdfClaimed = await app.inject({
      method: 'POST',
      url: `/api/rooms/${privateRoomId}/files`,
      ...multipartBody(
        [{ filename: 'fake.pdf', contentType: 'application/pdf', content: PNG }],
        { inviteToken: privateToken },
      ),
    });
    expect(pdfClaimed.statusCode).toBe(400);
    expect(JSON.parse(pdfClaimed.payload).declared).toBe('application/pdf');
  });

  it('GET /files/:fileId: 403 sem creds ou token de outra sala; 200 com token da sala', async () => {
    const post = await app.inject({
      method: 'POST',
      url: `/api/rooms/${privateRoomId}/files`,
      ...multipartBody(
        [{ filename: 'guard.png', contentType: 'image/png', content: PNG }],
        { inviteToken: privateToken },
      ),
    });
    expect(post.statusCode).toBe(201);
    const fileId = (JSON.parse(post.payload) as { files: Array<{ id: string }> }).files[0].id;

    const noCreds = await app.inject({
      method: 'GET',
      url: `/api/files/${fileId}`,
    });
    expect(noCreds.statusCode).toBe(403);

    const other = await prisma.room.create({
      data: { name: 'REST Other', isPersistent: true },
    });
    try {
      const wrongToken = await app.inject({
        method: 'GET',
        url: `/api/files/${fileId}`,
        headers: { 'x-room-invite': other.inviteToken },
      });
      expect(wrongToken.statusCode).toBe(403);
    } finally {
      await prisma.room.delete({ where: { id: other.id } }).catch(() => {});
    }

    const withToken = await app.inject({
      method: 'GET',
      url: `/api/files/${fileId}`,
      headers: { 'x-room-invite': privateToken },
    });
    expect(withToken.statusCode).toBe(200);
    expect(withToken.headers['content-type']).toMatch(/image\/png/);
  });
});
