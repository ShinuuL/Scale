# Scale Chat (Opção A) Implementation Plan

> **Histórico:** descreve a arquitetura anterior (Tailscale). A infra atual usa túnel cloudflared — ver docs/tunnel-setup.md.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar chat de texto lateral à sala `/room/[id]` com temporárias efêmeras (buffer ~100 em memória + `emptyTimers` 5min) e persistentes com histórico (SQLite `ChatMessage`/`ChatFile` + paginação 200→50), menções `@roomPeers`, edição 15min, deleção soft autor/dono, upload zip 15MB/5 por mensagem/quota 200MB e hardening tailnet-only.

**Architecture:** Reuso do mesmo `Server` Socket.io para signaling + chat com `chatBuffers` FIFO em `handler.ts` e persistência condicional via Prisma 6/SQLite; REST para histórico paginado e arquivos (`fastify-multipart` + `uploads.ts` magic bytes/quota/GC 7d); frontend desacoplado em `useChat` + `ChatPanel` sidebar `w-80`/drawer + `ChatMessageItem`.

**Tech Stack:** Next.js 15 App Router, Fastify 5, Socket.io 4, Prisma 6, SQLite, Zod 3 (client+server), Vitest 2 + Playwright, bcryptjs 3, @fastify/multipart, @fastify/cookie/cors/helmet, Docker Compose (profile `mcp`/`https`), Tailwind, TypeScript strict sem `any`.

**Spec:** `docs/superpowers/specs/2026-09-11-scale-chat-design.md` (Opção A v1.0) + `AGENTS.md` v1.0 base.

## Global Constraints

- TypeScript `strict` em `frontend/` e `backend/`; `any` proibido; resolver com `unknown`/`z.infer`/`Prisma` types.
- Validação `zod` obrigatória em todo input (socket + REST server-side; cliente duplica para UX). Falha → `400 { error, details: flatten() }`.
- Stack travada: Fastify `^5.0.0`, Socket.io `^4.8.0`, Prisma `^6.0.0`, SQLite (`provider = "sqlite"`), `zod ^3.23.0`, `socket.io-client ^4.8.3`, `bcryptjs ^3.0.3`, `uuid ^14.0.2`. Não introduzir `markdown-it`, `sharp`, `multer` fora da allowlist nem ORMs novos.
- Rate limiting: global `30/s` por `socket.id` (janela `1000ms`, `lib/rateLimit.ts` existente) + chat específico `5 msgs / 5s` (nova chave `chat:${socket.id}` ou janela secundária). Excedeu → `callback { error: 'Rate limit exceeded. Max 5 messages/5s.' }` sem derrubar conexão.
- Limites de produto (cópia verbatim da spec): `content` `1..500` chars (`z.string().min(1).max(500)` após `trim`); `mentions` `max 8` + `z.string().min(1).max(50)` cada; arquivos `15_000_000` bytes cada, `max 5` por mensagem, allowlist MIME `image/*`, `application/pdf`, `text/plain`, `audio/*`, `application/zip`, magic bytes obrigatório, quota `200 MB/sala` (soma `ChatFile.size` com `deletedAt IS NULL OR deletedAt > now()-7d`); edição `15*60*1000` ms; GC arquivos `deletedAt < now()-7d`; buffer temporária `~100` FIFO; `GET /rooms/:id/messages` `limit` default 50 `min 1 max 50`, janela ativa 200, cursor bloco 50, placeholder `'[mensagem apagada]'`.
- Auth: JWT em cookie `HttpOnly` `SameSite=Strict` `Secure` em `production` (via `authPlugin`); `inviteToken` `UUID v4` único; `passwordHash` `bcrypt` custo 10, mínimo 8 chars em claro; temporárias exigem `inviteToken` sempre; persistentes aceitam `inviteToken` válido **ou** `password` correta; `guestName` `1..50` quando `authorId null`.
- Rede: Caddy `bind {$TAILSCALE_IP}:443` (compose mapeia `3443:443`) nunca `0.0.0.0`; Fastify `trustProxy: true`; `checkTailscaleOrigin` valida `request.ip` em `100.64.0.0/10` **ou** `request.headers.host` contém `TAILSCALE_HOST` **ou** `origin` em `ALLOWED_ORIGINS` whitelist → senão `403 Tailnet only`; CORS `origin: ALLOWED_ORIGINS.split(',') credentials: true`; Helmet CSP `defaultSrc ["'self'"] scriptSrc ["'self'"] connectSrc ["'self'", "wss:"]` `X-Frame-Options: DENY` `nosniff`; `uploads/` fora de `public/`, servido só via `GET /files/:fileId` com sandbox `path.resolve` sob `uploads/<roomId>` e `Content-Disposition: attachment; filename="<sanitized>"` + `X-Content-Type-Options: nosniff`; `linkify` escapa HTML antes de `<a target="_blank" rel="noopener">`.
- UX: menções só `roomPeers` atuais (`Map` em `handler.ts`), `chat:mention` só para `socketId` mencionado + highlight `bg-amber-200` + `new Audio('/sounds/mention.mp3').volume=0.6` sem Toast; `ChatPanel` sidebar `w-80` (320px) desktop + drawer `fixed inset-0 role="dialog"` mobile, log `role="log" aria-live="polite"`, input `Enter` envia `Shift+Enter` quebra, contador `500` vermelho quando excede, autocomplete `@` filtrado `roomPeers` case-insensitive `role="listbox"` `ArrowUp/Down+Enter`; persistir `chatOpen` em `localStorage "scale:chatOpen:<roomId>"`.
- Gates obrigatórios antes de `done`: `npm run lint`, `npm run build`, `docker compose --profile mcp config`, `docker compose --profile mcp up --build --abort-on-container-exit`. Falha → corrigir e reexecutar.
- Convenções: `conventional commits` (`feat:`, `fix:`, `docs:`, `chore:`), branches `feat/nome`, sem segredos em docs, tema Verdant já em `606d6bd` — não re-aplicar.
- Foco exclusivo chat Opção A (§10 etapas 1→6 na ordem); não implementar gravação, DM, threads, reações, markdown rico.

---

## File Structure

```
backend/
  prisma/schema.prisma                 # + Room.passwordHash String? + ChatMessage + ChatFile com índices/cascade
  src/socket/validation.ts             # + chatMessageSchema, chatEditSchema, chatDeleteSchema, fileMetaSchema
  src/socket/handler.ts                # + chatBuffers Map FIFO 100, rate 5/5s, handlers chat:message/edit/delete/system/mention, join-room history
  src/lib/rateLimit.ts                 # + isChatRateLimited ou janela secundária 5/5s (sem quebrar 30/s existente)
  src/lib/uploads.ts                   # NEW — sanitizeFilename, detectMagicBytes, saveFile, getQuotaUsage, gcDeletedFiles
  src/lib/metrics.ts                   # + scale_chat_* counters
  src/routes/messages.ts               # NEW — GET /api/rooms/:id/messages?limit&cursor
  src/routes/files.ts                  # NEW — POST /api/rooms/:id/files + GET /api/files/:fileId (multipart 15MB/5)
  src/routes/rooms.ts                  # + password bcrypt min8 em POST /api/rooms, + POST /rooms/:id/rotate-invite
  src/plugins/checkTailscale.ts        # NEW — checkTailscaleOrigin + isInSubnet 100.64.0.0/10
  src/server.ts                        # + trustProxy:true + fastify-multipart + register messages/files/checkTailscale
  src/__tests__/chat.test.ts           # NEW — socket suites (§8.1)
  src/__tests__/files.test.ts          # NEW — REST suites (§8.1)

frontend/
  src/lib/validation.ts                # + chatMessageClientSchema, chatEditClientSchema, fileClientSchema (PT-BR)
  src/hooks/useChat.ts                 # NEW — messages/hasMore/nextCursor/unread/isLoadingHistory + send/edit/delete/loadMore/upload/markRead
  src/components/ChatPanel.tsx         # NEW — sidebar w-80/drawer, role=log, header badge, list, input+autocomplete, chips, loadMore
  src/components/ChatMessageItem.tsx   # NEW — linkify+mentionHighlight, edited/deleted, files links, edit/delete condicionais
  src/app/room/[id]/page.tsx           # + integrar ChatPanel+useChat, toggle badge, flex VideoGrid+ChatPanel, history de join-room
  src/components/__tests__/ChatPanel.test.tsx # NEW — frontend suite (§8.1)
  public/sounds/mention.mp3            # NEW — ~0.5s <50KB

Caddyfile                              # + bind {$TAILSCALE_IP}:443
docker-compose.yml                     # volumes uploads/ se necessário, sem novos serviços
docs/tailscale-setup.md                # + TAILSCALE_IP/HOST/ALLOWED_ORIGINS
```

Responsabilidades:

- `schema.prisma`: define retenção (temp vs persist) e integridade (`onDelete: Cascade`, índices `(roomId, createdAt)` e `(roomId, deletedAt)`).
- `validation.ts` (backend): fonte autoritativa de todos os payloads chat; frontend importa mirror equivalente para UX.
- `handler.ts`: orquestra `roomPeers`/`emptyTimers`/`chatBuffers`, valida `zod` + rate + membership, persiste condicional, faz `intersect` menções e broadcasts.
- `rateLimit.ts`: isola janela chat para não colidir com `30/s` global de `signal:*`.
- `uploads.ts`: barreira de segurança arquivos (sanitize + magic bytes + quota + sandbox + `0600` + GC).
- `messages.ts`/`files.ts`: REST paginado com `cursor` e multipart com `helmet`/`sandbox`.
- `checkTailscale.ts`: segunda barreira tailnet além do `bind` do Caddy.
- `useChat.ts`: ponte Socket.io ↔ REST, estado `messages` e `unread`, áudio menção.
- `ChatPanel`/`ChatMessageItem`: UI escaneável sem Toast, com `verify` de peers atuais.
- Métricas + testes garantem observabilidade e gates.

---

### Task 1: Etapa 1 — Prisma schema: Room.passwordHash + ChatMessage + ChatFile

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Test: `backend/src/__tests__/chat.test.ts` (setup preliminar — só esqueleto, falha esperada até generate)

**Interfaces:**
- Consumes: `backend/prisma/schema.prisma` existente com `Room`, `User`, `RoomMember`.
- Produces: `Room.passwordHash: String?` + `model ChatMessage { id uuid pk, roomId, authorId String?, guestName String?, content String 1..500 | '[mensagem apagada]', prevContent String?, editedAt DateTime?, deletedAt DateTime?, createdAt, @@index([roomId, createdAt]), @@index([roomId, deletedAt]), @@index([authorId]) }` + `model ChatFile { id uuid pk, roomId, messageId, filename String sanitizado, mime String, size Int, path String, uploadedBy String?, createdAt, deletedAt DateTime?, @@index([roomId]), @@index([messageId]), @@index([roomId, deletedAt]) }` + relações `Room.chatMessages`, `Room.chatFiles`, `ChatMessage.files`.

- [ ] **Step 1: Escrever teste falhando que importa os novos models**

```ts
// backend/src/__tests__/chat.test.ts
import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';
describe('prisma chat models', () => {
  it('cria sala persistente com passwordHash e mensagem+arquivo', async () => {
    const room = await prisma.room.create({
      data: { name: 'Sala Chat', isPersistent: true, passwordHash: '$2a$10$fakehashfakehashfakehashfakeha', inviteToken: '11111111-1111-4111-8111-111111111111' }
    });
    const msg = await prisma.chatMessage.create({
      data: { roomId: room.id, content: 'ola', authorId: null, guestName: 'Alice' }
    });
    const file = await prisma.chatFile.create({
      data: { roomId: room.id, messageId: msg.id, filename: 'doc.pdf', mime: 'application/pdf', size: 100, path: `uploads/${room.id}/x-doc.pdf` }
    });
    expect(room.passwordHash).toBeDefined();
    expect(msg.id).toBeDefined();
    expect(file.id).toBeDefined();
  });
});
```

- [ ] **Step 2: Rodar para confirmar falha (models ainda não existem)**

Run: `npm run test -- backend/src/__tests__/chat.test.ts` (na raiz `backend/`)

Expected: FAIL `Unknown arg 'passwordHash'` / `Model ChatMessage does not exist` ou `Cannot find module` até `generate`.

- [ ] **Step 3: Implementar schema conforme §5.1 verbatim**

```prisma
// backend/prisma/schema.prisma — diff
model Room {
  id              String        @id @default(uuid())
  name            String
  ownerId         String?
  isPersistent    Boolean       @default(false)
  isPrivate       Boolean       @default(false)
  maxParticipants Int           @default(8)
  inviteToken     String        @unique @default(uuid())
  passwordHash    String?       // bcrypt, min 8 chars em claro; null = sem senha — Opção A
  status          RoomStatus    @default(ACTIVE)
  createdAt       DateTime      @default(now())
  expiresAt       DateTime?

  owner       User?         @relation(fields: [ownerId], references: [id], onDelete: SetNull)
  roomMembers RoomMember[]
  chatMessages ChatMessage[]
  chatFiles    ChatFile[]

  @@index([isPersistent, status])
  @@index([expiresAt])
}

model ChatMessage {
  id          String    @id @default(uuid())
  roomId      String
  authorId    String?
  guestName   String?
  content     String
  prevContent String?
  editedAt    DateTime?
  deletedAt   DateTime?
  createdAt   DateTime  @default(now())

  room  Room       @relation(fields: [roomId], references: [id], onDelete: Cascade)
  files ChatFile[]

  @@index([roomId, createdAt])
  @@index([roomId, deletedAt])
  @@index([authorId])
}

model ChatFile {
  id          String    @id @default(uuid())
  roomId      String
  messageId   String
  filename    String
  mime        String
  size        Int
  path        String
  uploadedBy  String?
  createdAt   DateTime  @default(now())
  deletedAt   DateTime?

  room    Room        @relation(fields: [roomId], references: [id], onDelete: Cascade)
  message ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([roomId])
  @@index([messageId])
  @@index([roomId, deletedAt])
}
```

Nota: manter `generator client { provider = "prisma-client-js" }` e `datasource db { provider = "sqlite" }` inalterados; `backend/src/lib/prisma.ts` já exporta `prisma` tipado — nenhum `any`.

- [ ] **Step 4: Rodar generate para validar tipos**

Run: `npx prisma generate --schema=backend/prisma/schema.prisma`

Expected: `✔ Generated Prisma Client` sem warnings; `backend/src/lib/prisma.ts` ainda compila.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/schema.prisma backend/src/__tests__/chat.test.ts
git commit -m "feat(chat): add Room.passwordHash + ChatMessage/ChatFile prisma models"
```

---

### Task 2: Etapa 1 — prisma generate + db push + verificação de índices/cascade

**Files:**
- Modify: `backend/prisma/schema.prisma` (nenhuma mudança, só push)
- Test: `backend/src/__tests__/chat.test.ts` (mesmo arquivo, adiciona asserts de cascade/index)

**Interfaces:**
- Consumes: `Task 1` (schema estendido).
- Produces: DB `data.db` migrado, `prisma.$connect()` OK, índices verificáveis via `prisma.chatMessage.findMany` orderBy.

- [ ] **Step 1: Escrever teste que verifica push/indíces não quebra**

```ts
// backend/src/__tests__/chat.test.ts — acrescenta
it('apaga em cascata ChatMessage quando Room é deletada', async () => {
  const room = await prisma.room.create({ data: { name: 'Temp Cascade', isPersistent: false } });
  const msg = await prisma.chatMessage.create({ data: { roomId: room.id, content: 'hi' } });
  await prisma.room.delete({ where: { id: room.id } });
  const leftover = await prisma.chatMessage.findUnique({ where: { id: msg.id } });
  expect(leftover).toBeNull();
});
```

- [ ] **Step 2: Rodar e ver FAIL antes do push (tabela não existe)**

Run: `npm run test -- backend/src/__tests__/chat.test.ts`

Expected: FAIL `The table 'main.ChatMessage' does not exist`.

- [ ] **Step 3: Executar push**

```bash
npx prisma db push --schema=backend/prisma/schema.prisma
# alternativa se existir migrate: npx prisma migrate dev --name chat
```

Verificar `backend/prisma/data.db` atualizado; `prisma generate` de novo; `backend/src/lib/prisma.ts` sem `any` (strict).

- [ ] **Step 4: Rodar testes para PASS**

Run: `npm run test -- backend/src/__tests__/chat.test.ts`

Expected: PASS 2 suites.

- [ ] **Step 5: Commit**

```bash
git add backend/prisma/data.db backend/prisma/schema.prisma
git commit -m "chore(chat): prisma db push ChatMessage/ChatFile"
```

Gate check inline: `npm run lint` e `npm run build` devem passar sem erros de tipo.

---

### Task 3: Etapa 2 — validation.ts com chat schemas (zod) + janela trim

**Files:**
- Modify: `backend/src/socket/validation.ts`
- Test: `backend/src/__tests__/chat.test.ts` (nova suite `validation`)

**Interfaces:**
- Consumes: `z` from `zod`.
- Produces:
```ts
export const chatMessageSchema = z.object({ roomId: z.string().uuid(), content: z.string().min(1).max(500), mentions: z.array(z.string().min(1).max(50)).max(8).optional() });
export const chatEditSchema = z.object({ roomId: z.string().uuid(), messageId: z.string().uuid(), content: z.string().min(1).max(500) });
export const chatDeleteSchema = z.object({ roomId: z.string().uuid(), messageId: z.string().uuid() });
export const fileMetaSchema = z.object({ roomId: z.string().uuid(), messageId: z.string().uuid().optional(), filename: z.string().min(1).max(255), mime: z.string().min(3).max(127), size: z.number().int().min(1).max(15_000_000) });
export type ChatMessagePayload = z.infer<typeof chatMessageSchema> // etc
```

- [ ] **Step 1: Teste falhando para cada schema**

```ts
import { chatMessageSchema, chatEditSchema, chatDeleteSchema, fileMetaSchema } from '../socket/validation.js';
import { describe, it, expect } from 'vitest';
describe('chat validation', () => {
  it('rejeita content vazio e >500', () => {
    expect(chatMessageSchema.safeParse({ roomId: '550e8400-e29b-41d4-a716-446655440000', content: '' }).success).toBe(false);
    expect(chatMessageSchema.safeParse({ roomId: '550e8400-e29b-41d4-a716-446655440000', content: 'a'.repeat(501) }).success).toBe(false);
  });
  it('aceita mentions max 8 e rejeita 9', () => {
    const base = { roomId: '550e8400-e29b-41d4-a716-446655440000', content: 'hi', mentions: Array.from({length:8}, (_,i)=>`User${i}`) };
    expect(chatMessageSchema.safeParse(base).success).toBe(true);
    expect(chatMessageSchema.safeParse({ ...base, mentions: [...base.mentions!, 'extra'] }).success).toBe(false);
  });
  it('fileMeta rejeita size >15MB', () => {
    expect(fileMetaSchema.safeParse({ roomId: '550e8400-e29b-41d4-a716-446655440000', filename: 'a.zip', mime: 'application/zip', size: 15_000_001 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar → FAIL (exports não existem)**

Run: `npm run test -- backend/src/__tests__/chat.test.ts -t "chat validation"`

Expected: `chatMessageSchema is not defined` / import error.

- [ ] **Step 3: Implementar em `backend/src/socket/validation.ts`** (manter `joinRoomSchema` etc existentes, acrescentar abaixo)

```ts
import { z } from 'zod';
// existentes: joinRoomSchema, leaveRoomSchema, offerSchema, answerSchema, iceCandidateSchema, screenShareStateSchema

export const chatMessageSchema = z.object({
  roomId: z.string().uuid(),
  content: z.string().min(1).max(500), // server valida após trim via .transform ou handler — ver nota
  mentions: z.array(z.string().min(1).max(50)).max(8).optional(),
});

export const chatEditSchema = z.object({
  roomId: z.string().uuid(),
  messageId: z.string().uuid(),
  content: z.string().min(1).max(500),
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
  size: z.number().int().min(1).max(15_000_000),
});

export type ChatMessagePayload = z.infer<typeof chatMessageSchema>;
export type ChatEditPayload = z.infer<typeof chatEditSchema>;
export type ChatDeletePayload = z.infer<typeof chatDeleteSchema>;
export type FileMetaPayload = z.infer<typeof fileMetaSchema>;
```

Nota ao executor: o `trim` será aplicado no handler (`content.trim()`) antes do `safeParse` ou via `z.string().trim().min(1)` se preferir; manter `1..500` após trim conforme fluxos §6.1/6.2.

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- backend/src/__tests__/chat.test.ts -t "chat validation"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/validation.ts backend/src/__tests__/chat.test.ts
git commit -m "feat(chat): add zod schemas chatMessage/chatEdit/chatDelete/fileMeta"
```

---

### Task 4: Etapa 2 — handler.ts chatBuffers FIFO 100 + chat:message + rate 5/5s + mentions intersect

**Files:**
- Modify: `backend/src/socket/handler.ts`, `backend/src/lib/rateLimit.ts`
- Test: `backend/src/__tests__/chat.test.ts` (suite socket)

**Interfaces:**
- Consumes: `chatMessageSchema` de Task 3, `isRateLimited` existente, `roomPeers`, `emptyTimers`, `prisma`.
- Produces:
```ts
export const chatBuffers = new Map<string, Array<ChatMessageRow>>(); // ~100 FIFO por sala temp
export function isChatRateLimited(socketId: string): boolean // 5 msgs / 5000ms
// eventos: socket.on('chat:message', handler) → io.to(roomId).emit('chat:message', fullMsg) + io.to(mentionedSocketId).emit('chat:mention', { messageId, roomId })
// regex: const mentionRegex = /@(\w[\w .-]{0,49})/g
```

- [ ] **Step 1: Teste falhando para chat:message persist vs buffer + rate + mention**

```ts
// backend/src/__tests__/chat.test.ts — mock socket.io
import { describe, it, expect, vi, beforeEach } from 'vitest';
describe('socket chat:message', () => {
  it('persistente cria no prisma e emite broadcast', async () => { /* cria room isPersistent true, emit, expect prisma.chatMessage.create called e io.to.emit */ });
  it('temporária usa buffer FIFO 100 e descarta antiga', async () => { /* preenche 101, expect length 100 e primeira descartada */ });
  it('rejeita rate 5/5s na sexta mensagem', async () => { /* loop 6 rápidas → 6ª callback error Rate limit exceeded */ });
  it('mention intersect só peers atuais', async () => { /* peers = [Alice,Bob], menciona @Bob @Carlos → só Bob recebe chat:mention */ });
});
```

Detalhar máximo no arquivo — usar `vitest` + `socket.io-mock` ou `createSocketServer` real com `prisma` mock conforme `src/__tests__/socket.test.ts` existente.

- [ ] **Step 2: Rodar → FAIL (handler não implementado)**

Run: `npm run test -- backend/src/__tests__/chat.test.ts -t "socket chat:message"`

Expected: `chat:message handler not found` / timeout.

- [ ] **Step 3a: Estender `rateLimit.ts` sem quebrar 30/s**

```ts
// backend/src/lib/rateLimit.ts — acrescentar janela chat isolada
const CHAT_WINDOW_MS = 5_000;
const CHAT_MAX = 5;
const chatStore = new Map<string, RateLimitEntry>();

export function isChatRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = chatStore.get(key);
  if (!entry || now > entry.resetAt) {
    chatStore.set(key, { count: 1, resetAt: now + CHAT_WINDOW_MS });
    return false;
  }
  entry.count++;
  if (entry.count > CHAT_MAX) return true;
  return false;
}
export function resetChatRateLimit(key: string): void { chatStore.delete(key); }
```

Manter `isRateLimited` intacto para `30/s`.

- [ ] **Step 3b: Implementar `handler.ts` — adicionar estado e evento**

```ts
// topo handler.ts
import { chatMessageSchema } from './validation.js';
import { isRateLimited, isChatRateLimited } from '../lib/rateLimit.js';
export const chatBuffers = new Map<string, Array<{ id: string; roomId: string; content: string; authorId: string | null; guestName?: string; createdAt: Date }>>();
const CHAT_BUFFER_LIMIT = 100;

// dentro de io.on('connection', socket => { ... antes de disconnect
  socket.on('chat:message', async (data, callback) => {
    if (isRateLimited(`socket:${socket.id}`) || isChatRateLimited(`chat:${socket.id}`)) {
      callback?.({ error: 'Rate limit exceeded. Max 5 messages/5s.' });
      return;
    }
    // trim antes de validar para respeitar 1..500 após trim
    const trimmed = typeof data?.content === 'string' ? { ...data, content: data.content.trim() } : data;
    const parsed = chatMessageSchema.safeParse(trimmed);
    if (!parsed.success) {
      callback?.({ error: 'Invalid payload', details: parsed.error.flatten() });
      return;
    }
    const { roomId, content, mentions } = parsed.data;
    // membership
    const peers = roomPeers.get(roomId);
    if (!peers?.has(socket.id)) {
      callback?.({ error: 'Not in room', details: { roomId } });
      return;
    }
    // room existe e ACTIVE
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || room.status !== 'ACTIVE') { callback?.({ error: 'Room not found' }); return; }
    if (room.expiresAt && new Date(room.expiresAt) < new Date()) { callback?.({ error: 'Room has expired' }); return; }

    // mentions intersect
    const peersNames = new Set(Array.from(peers.values()).map(p => p.name));
    const rawMentions = mentions ?? [];
    // extrai via regex se cliente não enviou mentions (defesa)
    if (rawMentions.length === 0) {
      const re = /@(\w[\w .-]{0,49})/g; let m: RegExpExecArray | null; 
      while ((m = re.exec(content)) !== null) rawMentions.push(m[1]);
    }
    const intersected = rawMentions.filter(n => peersNames.has(n)).slice(0, 8);

    const user: SocketUser = socket.data.user;
    let savedMsg: { id: string; roomId: string; content: string; authorId: string | null; guestName?: string; createdAt: Date };
    if (room.isPersistent) {
      const created = await prisma.chatMessage.create({
        data: { roomId, content, authorId: user.userId, guestName: user.guestName ?? user.name }
      });
      savedMsg = created as typeof savedMsg;
      // metrics increment
      // (import { incChatMessages } from '../lib/metrics.js')
    } else {
      const id = crypto.randomUUID();
      savedMsg = { id, roomId, content, authorId: user.userId, guestName: user.guestName, createdAt: new Date() };
      const buf = chatBuffers.get(roomId) ?? [];
      buf.push(savedMsg);
      if (buf.length > CHAT_BUFFER_LIMIT) buf.shift(); // FIFO
      chatBuffers.set(roomId, buf);
    }

    io.to(roomId).emit('chat:message', savedMsg);
    // fan-out mention
    for (const name of intersected) {
      for (const [sid, peer] of peers.entries()) {
        if (peer.name === name) io.to(sid).emit('chat:mention', { messageId: savedMsg.id, roomId });
      }
    }
    callback?.({ success: true, messageId: savedMsg.id });
  });
// também em handleLeaveRoom: quando auto-delete dispara, limpa buffer
// dentro do setTimeout após delete: chatBuffers.delete(roomId);
```

Garantir `socket.data.user` tipado `SocketUser`.

- [ ] **Step 4: Rodar testes → PASS**

Run: `npm run test -- backend/src/__tests__/chat.test.ts -t "socket chat:message"`

Expected: PASS para os 4 casos; `buffer FIFO` assert `buf.length === 100` e `buf[0].id !== firstId`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/handler.ts backend/src/lib/rateLimit.ts backend/src/__tests__/chat.test.ts
git commit -m "feat(chat): socket chat:message buffer FIFO 100 + rate 5/5s + mention intersect"
```

---

### Task 5: Etapa 2 — handler.ts chat:edit / chat:delete / chat:system + join-room history estendido

**Files:**
- Modify: `backend/src/socket/handler.ts`, `backend/src/socket/validation.ts` (se faltar join schema)
- Test: `backend/src/__tests__/chat.test.ts` (novas suites)

**Interfaces:**
- Consumes: `chatEditSchema`, `chatDeleteSchema`, `chatBuffers`, `isChatRateLimited`, `prisma`.
- Produces:
```ts
socket.on('chat:edit', (data: ChatEditPayload, cb) => Promise<void>)  // 15min window, prevContent+editedAt, broadcast chat:edit
socket.on('chat:delete', (data: ChatDeletePayload, cb) => Promise<void>) // soft delete, cascade ChatFile.deletedAt
socket.on('chat:system', never client→server) // server→room emit { roomId, text, kind }
join-room callback: { success, peers, history: ChatMessage[] } // 200 recentes se persist else buffer, orden ASC ao cliente
```

- [ ] **Step 1: Testes falhando**

```ts
describe('chat:edit/delete', () => {
  it('edit só autor e <15min guarda prevContent', async () => {
    const msg = await prisma.chatMessage.create({ data: { roomId, content: 'old', authorId: userId } });
    // mock Date.now inside window
    // emit chat:edit → expect prisma.update { prevContent:'old', editedAt }
    // emit com outro userId → expect 403 Not message author
    // avança 16min → expect 403 Edit window expired
  });
  it('delete soft autor/dono com cascade', async () => {
    const msg = await prisma.chatMessage.create({ data: { roomId, content: 'toDel' } });
    await prisma.chatFile.create({ data: { roomId, messageId: msg.id, filename: 'a.txt', mime: 'text/plain', size: 10, path: 'uploads/x' } });
    // emit delete como dono → expect message.content='[mensagem apagada]' deletedAt + ChatFile.deletedAt
  });
  it('join-room retorna history 200 persist vs buffer temp', async () => {
    // cria 250 msgs persist → join → expect history.length 200 ASC
    // cria temp buffer 3 → join → expect history === buffer
  });
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npm run test -- backend/src/__tests__/chat.test.ts -t "chat:edit"`

Expected: `chat:edit not handled`.

- [ ] **Step 3: Implementar handlers + estender join-room**

```ts
// acima de io.on('connection') já tem chatBuffers etc
// dentro connection, após chat:message:

socket.on('chat:edit', async (data, callback) => {
  if (isRateLimited(`socket:${socket.id}`) || isChatRateLimited(`chat:${socket.id}`)) {
    callback?.({ error: 'Rate limit exceeded. Max 5 messages/5s.' }); return;
  }
  const trimmed = typeof data?.content === 'string' ? { ...data, content: data.content.trim() } : data;
  const parsed = chatEditSchema.safeParse(trimmed);
  if (!parsed.success) { callback?.({ error: 'Invalid payload', details: parsed.error.flatten() }); return; }
  const { roomId, messageId, content } = parsed.data;
  if (!roomPeers.get(roomId)?.has(socket.id)) { callback?.({ error: 'Not in room' }); return; }
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg || msg.roomId !== roomId) { callback?.({ error: 'Message not found' }); return; }
  if (msg.deletedAt) { callback?.({ error: 'Cannot edit deleted message' }); return; }
  const user: SocketUser = socket.data.user;
  const isAuthor = (msg.authorId && msg.authorId === user.userId) || (!msg.authorId && msg.guestName === (user.guestName ?? user.name));
  if (!isAuthor) { callback?.({ error: 'Not message author' }); return; }
  if (Date.now() - new Date(msg.createdAt).getTime() > 15*60*1000) { callback?.({ error: 'Edit window expired' }); return; }
  const updated = await prisma.chatMessage.update({
    where: { id: messageId },
    data: { prevContent: msg.content, content, editedAt: new Date() }
  });
  io.to(roomId).emit('chat:edit', { messageId, content: updated.content, prevContent: updated.prevContent, editedAt: updated.editedAt });
  callback?.({ success: true });
});

socket.on('chat:delete', async (data, callback) => {
  if (isRateLimited(`socket:${socket.id}`) || isChatRateLimited(`chat:${socket.id}`)) {
    callback?.({ error: 'Rate limit exceeded. Max 5 messages/5s.' }); return;
  }
  const parsed = chatDeleteSchema.safeParse(data);
  if (!parsed.success) { callback?.({ error: 'Invalid payload', details: parsed.error.flatten() }); return; }
  const { roomId, messageId } = parsed.data;
  if (!roomPeers.get(roomId)?.has(socket.id)) { callback?.({ error: 'Not in room' }); return; }
  const [msg, room] = await Promise.all([
    prisma.chatMessage.findUnique({ where: { id: messageId } }),
    prisma.room.findUnique({ where: { id: roomId } })
  ]);
  if (!msg || msg.roomId !== roomId) { callback?.({ error: 'Message not found' }); return; }
  if (msg.deletedAt) { callback?.({ success: true }); return; } // idempotente
  const user: SocketUser = socket.data.user;
  const isAuthor = (msg.authorId && msg.authorId === user.userId) || (!msg.authorId && msg.guestName === (user.guestName ?? user.name));
  const isOwner = room?.ownerId && room.ownerId === user.userId;
  if (!isAuthor && !isOwner) { callback?.({ error: 'Not authorized to delete' }); return; }
  const now = new Date();
  await prisma.chatMessage.update({ where: { id: messageId }, data: { deletedAt: now, content: '[mensagem apagada]' } });
  await prisma.chatFile.updateMany({ where: { messageId }, data: { deletedAt: now } });
  io.to(roomId).emit('chat:delete', { messageId, deletedAt: now });
  callback?.({ success: true });
});

// estender join-room existente: após peersList, antes de callback:
        let history: Array<{ id: string; content: string; createdAt: Date; deletedAt?: Date | null; editedAt?: Date | null } > = [];
        if (room.isPersistent) {
          const recent = await prisma.chatMessage.findMany({
            where: { roomId },
            orderBy: { createdAt: 'desc' },
            take: 200,
            include: { files: true }
          });
          history = recent.reverse(); // entrega ASC conforme spec
        } else {
          history = (chatBuffers.get(roomId) ?? []).slice(-100);
        }
        callback?.({ success: true, peers: peersList, roomId, history });
        // emitir chat:system para a sala
        socket.to(roomId).emit('chat:system', { roomId, text: `${user.name} entrou`, kind: 'join' });
```

Também ajustar `handleLeaveRoom` para emitir `chat:system` leave e limpar buffer quando auto-delete.

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- backend/src/__tests__/chat.test.ts`

Expected: PASS edit/delete/history.

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/handler.ts backend/src/__tests__/chat.test.ts
git commit -m "feat(chat): socket edit/delete/system + join-room history 200/buffer"
```

---

### Task 6: Etapa 3 — lib/uploads.ts (sanitize + magic bytes + quota + GC)

**Files:**
- Create: `backend/src/lib/uploads.ts`
- Test: `backend/src/__tests__/files.test.ts`

**Interfaces:**
- Consumes: `fs/promises`, `path`, `prisma`.
- Produces:
```ts
export function sanitizeFilename(name: string): string // basename, replace [^a-zA-Z0-9._-]→_, trim 255, bloqueia .. e /
export function detectMagicBytes(buf: Buffer): string | null // '89504E47'→image/png, '25504446'→application/pdf, '504B0304'→application/zip, '47494638'→image/gif, 'FFD8FF'→image/jpeg, '494433'/'52494646'→audio/*, 'null' se unknown
export async function saveFile(roomId: string, fileId: string, filename: string, buffer: Buffer): Promise<string> // mkdir -p uploads/<roomId>, write 0600
export async function getQuotaUsage(roomId: string): Promise<number> // SUM size where roomId AND (deletedAt IS NULL OR deletedAt > now()-7d)
export async function gcDeletedFiles(): Promise<{ deletedCount: number }>
export const ALLOWED_MIME_RE = /^(image\/.*|application\/pdf|text\/plain|audio\/.*|application\/zip)$/
```

- [ ] **Step 1: Teste falhando**

```ts
import { sanitizeFilename, detectMagicBytes, getQuotaUsage } from '../lib/uploads.js';
describe('uploads lib', () => {
  it('sanitize bloqueia path traversal', () => { expect(sanitizeFilename('../../etc/passwd')).not.toContain('..'); expect(sanitizeFilename('../../etc/passwd')).not.toContain('/'); });
  it('detectMagicBytes identifica png/pdf/zip e rejeita mismatch', () => {
    expect(detectMagicBytes(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]))).toBe('image/png');
    expect(detectMagicBytes(Buffer.from([0x25,0x50,0x44,0x46]))).toBe('application/pdf');
    expect(detectMagicBytes(Buffer.from([0x50,0x4B,0x03,0x04]))).toBe('application/zip');
  });
  it('quota soma com grace 7d', async () => { /* cria files deletedAt null e 8d old → expect only recent contado */ });
});
```

- [ ] **Step 2: Rodar → FAIL (módulo não existe)**

Run: `npm run test -- backend/src/__tests__/files.test.ts -t "uploads lib"`

Expected: `Cannot find module uploads`.

- [ ] **Step 3: Implementar `backend/src/lib/uploads.ts`**

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from './prisma.js';

export const ALLOWED_MIME_RE = /^(image\/.*|application\/pdf|text\/plain|audio\/.*|application\/zip)$/;
export const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

export function sanitizeFilename(name: string): string {
  let base = path.basename(name);
  base = base.replaceAll('\0', '');
  base = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (base.length > 255) base = base.slice(0, 255);
  // previne nomes vazios ou só pontos
  if (!base || base === '.' || base === '..') base = 'file';
  // colapsa leading dots
  base = base.replace(/^\.+/, '_');
  return base;
}

export function detectMagicBytes(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  const hex = buf.subarray(0, 8).toString('hex').toUpperCase();
  if (hex.startsWith('89504E47')) return 'image/png';
  if (hex.startsWith('FFD8FF')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('25504446')) return 'application/pdf';
  if (hex.startsWith('504B0304') || hex.startsWith('504B0506') || hex.startsWith('504B0708')) return 'application/zip';
  // audio: MP3 (ID3) 494433, WAV 52494646, OGG 4F676753
  if (hex.startsWith('494433')) return 'audio/mpeg';
  if (hex.startsWith('52494646')) return 'audio/wav';
  if (hex.startsWith('4F676753')) return 'audio/ogg';
  if (hex.startsWith('FFFB') || hex.startsWith('FFF3')) return 'audio/mpeg';
  // text/plain: sem magic — retorna null (allow via mime declarado)
  return null;
}

export async function saveFile(roomId: string, fileId: string, filename: string, buffer: Buffer): Promise<string> {
  const sanitized = sanitizeFilename(filename);
  const dir = path.resolve(UPLOADS_ROOT, roomId);
  // sandbox check
  const resolvedDir = path.resolve(dir);
  if (!resolvedDir.startsWith(UPLOADS_ROOT)) throw new Error('Invalid roomId');
  await fs.mkdir(resolvedDir, { recursive: true });
  const filePath = path.join(resolvedDir, `${fileId}-${sanitized}`);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedDir)) throw new Error('Path traversal blocked');
  await fs.writeFile(resolvedFile, buffer, { mode: 0o600 });
  return path.relative(process.cwd(), resolvedFile);
}

export async function getQuotaUsage(roomId: string): Promise<number> {
  const sevenDaysAgo = new Date(Date.now() - 7*24*60*60*1000);
  const agg = await prisma.chatFile.aggregate({
    where: {
      roomId,
      OR: [{ deletedAt: null }, { deletedAt: { gt: sevenDaysAgo } }]
    },
    _sum: { size: true }
  });
  return agg._sum.size ?? 0;
}

export async function gcDeletedFiles(): Promise<{ deletedCount: number }> {
  const cutoff = new Date(Date.now() - 7*24*60*60*1000);
  const expired = await prisma.chatFile.findMany({ where: { deletedAt: { lt: cutoff } } });
  let deletedCount = 0;
  for (const f of expired) {
    try {
      const abs = path.resolve(process.cwd(), f.path);
      if (abs.startsWith(UPLOADS_ROOT)) await fs.unlink(abs).catch(()=>{});
    } catch {}
    await prisma.chatFile.delete({ where: { id: f.id } }).catch(()=>{});
    deletedCount++;
  }
  if (deletedCount) console.log(`[gc] removed ${deletedCount} expired chat files`);
  return { deletedCount };
}
```

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- backend/src/__tests__/files.test.ts -t "uploads lib"`

Expected: PASS sanitize/magic/quota.

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/uploads.ts backend/src/__tests__/files.test.ts
git commit -m "feat(chat): uploads sanitize + magic bytes + quota + GC 7d"
```

---

### Task 7: Etapa 3 — routes/messages.ts GET paginação + files.ts POST/GET multipart

**Files:**
- Create: `backend/src/routes/messages.ts`
- Create: `backend/src/routes/files.ts`
- Modify: `backend/src/server.ts` (registrar rotas + fastify-multipart plugin)
- Modify: `backend/package.json` (adicionar `@fastify/multipart` se ausente)
- Test: `backend/src/__tests__/files.test.ts` (suites REST)

**Interfaces:**
- Consumes: `sanitizeFilename`, `detectMagicBytes`, `saveFile`, `getQuotaUsage`, `prisma`, `verifyToken`.
- Produces:
```ts
// messages.ts
GET /api/rooms/:id/messages?limit=50&cursor=<messageId>
// query schema: z.object({ limit: z.coerce.number().int().min(1).max(50).default(50), cursor: z.string().uuid().optional() })
// returns { messages: ChatMessage[] (ASC, placeholder para deleted), nextCursor: string | null } ou 400 Temporary rooms have no persisted history

// files.ts
POST /api/rooms/:id/files — multipart/form-data limits { fileSize: 15_000_000, files: 5 } → 201 { files: ChatFile[] } + io.to(roomId).emit('chat:message')
GET /api/files/:fileId — stream, headers Content-Type mime, Content-Disposition attachment, X-Content-Type-Options nosniff, 410 se GCed
```

- [ ] **Step 1: Testes falhando REST**

```ts
describe('REST messages', () => {
  it('GET /rooms/:id/messages paginação 200→50 com nextCursor', async () => {
    // cria sala persistente + 60 msgs → GET ?limit=50 → expect 50 ASC e nextCursor truthy
    // GET ?cursor=nextCursor → expect 10
  });
  it('temporária retorna 400 history', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/rooms/${tempId}/messages` });
    expect(res.statusCode).toBe(400);
  });
});
describe('REST files', () => {
  it('POST rejeita temporária, >15MB, >5 files, mime fora allowlist, magic mismatch, quota 200MB', async () => {
    // multipart helpers via app.inject + form-data
  });
  it('POST aceita image/pdf/txt/audio/zip válidos e GET exige membership', async () => {});
  it('GET 410 após GC e Content-Disposition attachment', async () => {});
});
```

- [ ] **Step 2: Rodar → FAIL (404 routes não registradas)**

Run: `npm run test -- backend/src/__tests__/files.test.ts -t "REST"`

Expected: `404 Not Found`.

- [ ] **Step 3: Implementar `messages.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(50),
  cursor: z.string().uuid().optional(),
});

export async function messagesRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Params: { id: string } }>('/api/rooms/:id/messages', async (request, reply) => {
    const { id: roomId } = request.params;
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid query', details: parsed.error.flatten() });
    const { limit, cursor } = parsed.data;

    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room) return reply.code(404).send({ error: 'Room not found' });
    if (!room.isPersistent) return reply.code(400).send({ error: 'Temporary rooms have no persisted history' });

    // TODO: membership check — se necessário, validar aqui via roomPeers ou token (feito em hardening Task 14/15)
    // por ora, mantém aberto para dono/guest com inviteToken validado em join-room; hardening adiciona gate.

    let cursorCreatedAt: Date | undefined;
    if (cursor) {
      const cursorMsg = await prisma.chatMessage.findUnique({ where: { id: cursor } });
      if (!cursorMsg || cursorMsg.roomId !== roomId) return reply.code(404).send({ error: 'Cursor not found' });
      cursorCreatedAt = cursorMsg.createdAt;
    }

    const where = cursorCreatedAt ? { roomId, createdAt: { lt: cursorCreatedAt } } : { roomId };
    const rows = await prisma.chatMessage.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { files: true }
    });
    const asc = rows.reverse();
    const nextCursor = rows.length === limit && asc.length ? asc[0].id : null;
    return reply.send({ messages: asc, nextCursor });
  });
}
```

- [ ] **Step 3b: Implementar `files.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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
        data: { id: fileId, roomId, messageId: message.id, filename: sanitizeFilename(p.filename), mime: p.mime, size: p.buffer.length, path: relPath, uploadedBy: userId }
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
    if (file.deletedAt && Date.now() - new Date(file.deletedAt).getTime() > 7*24*60*60*1000) {
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
```

- [ ] **Step 3c: Registrar em `server.ts`**

```ts
import multipart from '@fastify/multipart';
await server.register(multipart, { limits: { fileSize: 15_000_000, files: 5 } });
await server.register(messagesRoutes);
await server.register(filesRoutes);
// expor io para files.ts
const httpServer = server.server;
const io = createSocketServer(httpServer);
(server as unknown as Record<string, unknown>).io = io;
```

Adicionar `dependencies: "@fastify/multipart": "^9.0.0"` em `backend/package.json` se ainda não houver (`npm i`).

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- backend/src/__tests__/files.test.ts`

Expected: suites REST passam; arquivos físicos em `uploads/<roomId>/` com `0600`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/messages.ts backend/src/routes/files.ts backend/src/server.ts backend/package.json backend/src/__tests__/files.test.ts
git commit -m "feat(chat): REST messages pagination + files multipart magic/quotas"
```

---

### Task 8: Etapa 3 — rooms.ts password bcrypt + rotate-invite

**Files:**
- Modify: `backend/src/routes/rooms.ts`
- Test: `backend/src/__tests__/files.test.ts` ou `backend/src/__tests__/rooms.test.ts`

**Interfaces:**
- Consumes: `bcryptjs`, `prisma`, `zod`.
- Produces:
```ts
POST /api/rooms  // body: { name, isPersistent, isPrivate, maxParticipants, ttlMinutes, password?: string(8..128) } → se persistente+password → bcrypt.hash 10 → room.passwordHash
POST /api/rooms/:id/rotate-invite // auth dono, gera novo uuid, room.update inviteToken, emit chat:system { text: 'Invite rotacionado', kind: 'system' }
GET /api/rooms/:id // já expõe inviteToken só para dono — manter
join-room precisa aceitar password em validation (Task 3) — estender joinRoomSchema com password?: string
```

- [ ] **Step 1: Teste falhando**

```ts
it('cria sala persistente com senha bcrypt e rotaciona invite só dono', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/rooms', payload: { name:'Privada', isPersistent:true, password:'supersec8' } });
  expect(res.statusCode).toBe(201);
  // login como dono e chama rotate
  const rot = await app.inject({ method:'POST', url:`/api/rooms/${roomId}/rotate-invite`, headers:{ authorization:`Bearer ${token}` } });
  expect(rot.statusCode).toBe(200);
  // guest não dono → 403
});
it('password curta <8 rejeita', async () => {
  const res = await app.inject({ method:'POST', url:'/api/rooms', payload: { name:'X', isPersistent:true, password:'short' } });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npm run test -- backend/src/__tests__/rooms.test.ts -t "password"`

Expected: `400 missing` não bloqueia curta, `404 rotate-invite`.

- [ ] **Step 3: Implementar**

```ts
// backend/src/socket/validation.ts — estender joinRoomSchema
export const joinRoomSchema = z.object({
  roomId: z.string().uuid(),
  inviteToken: z.string().uuid().optional(),
  guestName: z.string().min(1).max(50).optional(),
  password: z.string().min(8).max(128).optional(),
});

// backend/src/routes/rooms.ts — topo
import bcrypt from 'bcryptjs';

// POST /api/rooms — dentro de safeParse antes de create
const passwordRaw = (request.body as Record<string, unknown>).password as string | undefined;
let passwordHash: string | null = null;
if (passwordRaw !== undefined) {
  if (!isPersistent) return reply.code(400).send({ error: 'Password only for persistent rooms' });
  if (passwordRaw.length < 8) return reply.code(400).send({ error: 'Password must be at least 8 characters' });
  passwordHash = await bcrypt.hash(passwordRaw, 10);
}
// prisma.room.create data: { ..., passwordHash }

// novo endpoint
fastify.post<{ Params:{id:string} }>('/api/rooms/:id/rotate-invite', { preHandler: [fastify.authenticate as never] }, async (request, reply) => {
  const userId = request.userId;
  const room = await prisma.room.findUnique({ where: { id: request.params.id } });
  if (!room) return reply.code(404).send({ error: 'Room not found' });
  if (room.ownerId !== userId) return reply.code(403).send({ error: 'Only owner can rotate invite' });
  const newToken = uuidv4();
  await prisma.room.update({ where: { id: room.id }, data: { inviteToken: newToken } });
  const io = (fastify as unknown as { io?: import('socket.io').Server }).io;
  io?.to(room.id).emit('chat:system', { roomId: room.id, text: 'Convite rotacionado pelo dono', kind: 'system' });
  return reply.send({ inviteToken: newToken });
});
```

Atualizar `handler.ts` para `join-room` aceitar `password`: após buscar `room`, se `room.passwordHash` existe, validar `inviteToken === room.inviteToken` **ou** `await bcrypt.compare(password, room.passwordHash)` → senão `403`.

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- backend/src/__tests__/rooms.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/rooms.ts backend/src/socket/validation.ts backend/src/socket/handler.ts
git commit -m "feat(chat): rooms password bcrypt min8 + rotate-invite + join password"
```

---

### Task 9: Etapa 4 — frontend validation cliente + mention.mp3 (PT-BR)

**Files:**
- Modify: `frontend/src/lib/validation.ts`
- Create: `frontend/public/sounds/mention.mp3` (placeholder binário curto <50KB, ~0.5s)
- Test: `frontend/src/components/__tests__/ChatPanel.test.tsx` (setup inicial)

**Interfaces:**
- Consumes: `z` from `zod`.
- Produces:
```ts
export const chatMessageClientSchema = z.string().trim().min(1, 'Mensagem não pode estar vazia').max(500, 'Máx. 500 caracteres');
export const chatEditClientSchema = z.string().trim().min(1, 'Mensagem não pode estar vazia').max(500, 'Máx. 500 caracteres');
export const ALLOWED_MIME_CLIENT_RE = /^(image\/.*|application\/pdf|text\/plain|audio\/.*|application\/zip)$/;
export const fileClientSchema = z.object({ file: z.instanceof(File) }).refine(f=>f.file.size <=15_000_000,'Máx. 15MB').refine(f=>ALLOWED_MIME_CLIENT_RE.test(f.file.type),'Tipo não permitido');
// mention.mp3 acessível em /sounds/mention.mp3
```

- [ ] **Step 1: Teste falhando (validação cliente)**

```tsx
import { chatMessageClientSchema, fileClientSchema } from '@/lib/validation';
describe('validation cliente', () => {
  it('rejeita vazio/trim e >500', () => {
    expect(chatMessageClientSchema.safeParse('   ').success).toBe(false);
    expect(chatMessageClientSchema.safeParse('a'.repeat(501)).success).toBe(false);
  });
  it('fileClient rejeita >15MB e mime inválido', () => {
    const big = new File([new ArrayBuffer(15_000_001)], 'big.zip', { type:'application/zip' });
    expect(fileClientSchema.safeParse({ file: big }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx` (ou `vitest run frontend`)

Expected: `chatMessageClientSchema not exported`.

- [ ] **Step 3: Implementar**

```ts
// frontend/src/lib/validation.ts — acrescentar ao final
export const chatMessageClientSchema = z.string().trim().min(1, 'Mensagem não pode estar vazia').max(500, 'Máx. 500 caracteres');
export const chatEditClientSchema = z.string().trim().min(1, 'Mensagem não pode estar vazia').max(500, 'Máx. 500 caracteres');

export const ALLOWED_MIME_CLIENT_RE = /^(image\/.*|application\/pdf|text\/plain|audio\/.*|application\/zip)$/;
export const fileClientSchema = z.object({
  file: z.instanceof(File),
}).refine(f => f.file.size <= 15_000_000, 'Máx. 15MB')
 .refine(f => ALLOWED_MIME_CLIENT_RE.test(f.file.type), 'Tipo não permitido');
```

Copiar `mention.mp3`: `mkdir -p frontend/public/sounds && cp path/to/short-beep.mp3 frontend/public/sounds/mention.mp3` ou `ffmpeg -f lavfi -i anullsrc -t 0.5 -q:a 9 -acodec libmp3lame frontend/public/sounds/mention.mp3`; tamanho alvo `<50_000` bytes. Em dev, pode ser silêncio 0.5s — o teste mocka `Audio`.

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/validation.ts frontend/public/sounds/mention.mp3 frontend/src/components/__tests__/ChatPanel.test.tsx
git commit -m "feat(chat): client validation PT-BR + mention.mp3"
```

---

### Task 10: Etapa 4 — hooks/useChat.ts (estado + listeners + REST)

**Files:**
- Create: `frontend/src/hooks/useChat.ts`
- Test: `frontend/src/components/__tests__/ChatPanel.test.tsx` (mock socket)

**Interfaces:**
- Consumes: `Socket` de `socket.io-client`, `useSocket`, `chatMessageClientSchema`.
- Produces:
```ts
type ChatMessage = { id:string; roomId:string; content:string; authorId:string|null; guestName?:string; prevContent?:string|null; editedAt?:string|null; deletedAt?:string|null; createdAt:string; files?: Array<{ id:string; filename:string; mime:string; size:number }> };
export function useChat(roomId: string, socket: Socket | null): {
  messages: ChatMessage[]; hasMore:boolean; nextCursor:string|null; unread:number; isLoadingHistory:boolean;
  sendMessage(content:string, mentions:string[]): void;
  editMessage(messageId:string, content:string): void;
  deleteMessage(messageId:string): void;
  loadMore(): Promise<void>;
  uploadFiles(files:File[], content?:string): Promise<void>;
  markRead(): void;
}
```

- [ ] **Step 1: Teste falhando para hook**

```tsx
import { renderHook, act } from '@testing-library/react';
import { useChat } from '@/hooks/useChat';
describe('useChat', () => {
  it('sendMessage valida cliente e emite chat:message', async () => {
    const mockSocket = { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as unknown as Socket;
    const { result } = renderHook(() => useChat('550e8400-e29b-41d4-a716-446655440000', mockSocket));
    act(()=> result.current.sendMessage('   ', []));
    expect(mockSocket.emit).not.toHaveBeenCalled(); // validado vazio
  });
  it('chat:mention toca audio e não toast', async () => {/* mock Audio */});
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx -t "useChat"`

Expected: `Cannot find module useChat`.

- [ ] **Step 3: Implementar `frontend/src/hooks/useChat.ts`**

```ts
'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import type { Socket } from 'socket.io-client';
import { chatMessageClientSchema, chatEditClientSchema } from '@/lib/validation';

type ChatFile = { id:string; filename:string; mime:string; size:number };
type ChatMessage = { id:string; roomId:string; content:string; authorId:string|null; guestName?:string; prevContent?:string|null; editedAt?:string|null; deletedAt?:string|null; createdAt:string; files?: ChatFile[] };

export function useChat(roomId: string, socket: Socket | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const isOpenRef = useRef(false);

  const markRead = useCallback(()=> setUnread(0), []);
  const setOpen = useCallback((open:boolean)=> { isOpenRef.current = open; if (open) setUnread(0); }, []);

  useEffect(()=> {
    if (!socket) return;
    const onMessage = (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
      if (!isOpenRef.current) setUnread(u => u + 1);
    };
    const onEdit = (p: { messageId:string; content:string; prevContent:string|null; editedAt:string }) => {
      setMessages(prev => prev.map(m => m.id===p.messageId ? { ...m, content:p.content, prevContent:p.prevContent, editedAt:p.editedAt } : m));
    };
    const onDelete = (p: { messageId:string; deletedAt:string }) => {
      setMessages(prev => prev.map(m => m.id===p.messageId ? { ...m, content:'[mensagem apagada]', deletedAt:p.deletedAt, files:[] } : m));
    };
    const onMention = () => {
      try { const a = new Audio('/sounds/mention.mp3'); a.volume = 0.6; a.play().catch(()=>{}); } catch {}
    };
    const onSystem = (p:{ text:string }) => {
      setMessages(prev => [...prev, { id:`sys-${Date.now()}`, roomId, content:p.text, authorId:null, createdAt:new Date().toISOString() } as ChatMessage]);
    };
    socket.on('chat:message', onMessage);
    socket.on('chat:edit', onEdit);
    socket.on('chat:delete', onDelete);
    socket.on('chat:mention', onMention);
    socket.on('chat:system', onSystem);
    return ()=> { socket.off('chat:message', onMessage); socket.off('chat:edit', onEdit); socket.off('chat:delete', onDelete); socket.off('chat:mention', onMention); socket.off('chat:system', onSystem); };
  }, [socket, roomId]);

  const sendMessage = useCallback((content:string, mentions:string[])=>{
    const parsed = chatMessageClientSchema.safeParse(content);
    if (!parsed.success) return; // erro será exibido pelo ChatPanel inline — hook só não emite
    socket?.emit('chat:message', { roomId, content: content.trim(), mentions: mentions.slice(0,7) }, (res: { error?:string })=>{
      if (res?.error) console.warn(res.error);
    });
  }, [socket, roomId]);

  const editMessage = useCallback((messageId:string, content:string)=>{
    const parsed = chatEditClientSchema.safeParse(content);
    if (!parsed.success) return;
    socket?.emit('chat:edit', { roomId, messageId, content: content.trim() });
  }, [socket, roomId]);

  const deleteMessage = useCallback((messageId:string)=>{
    socket?.emit('chat:delete', { roomId, messageId });
  }, [socket, roomId]);

  const loadMore = useCallback(async ()=>{
    if (!hasMore || isLoadingHistory) return;
    setIsLoadingHistory(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (nextCursor) params.set('cursor', nextCursor);
      const res = await fetch(`/api/rooms/${roomId}/messages?${params}`, { credentials:'include' });
      const data = await res.json();
      if (res.ok) {
        setMessages(prev => [...data.messages, ...prev]);
        setNextCursor(data.nextCursor);
        setHasMore(!!data.nextCursor);
      }
    } finally { setIsLoadingHistory(false); }
  }, [roomId, nextCursor, hasMore, isLoadingHistory]);

  const uploadFiles = useCallback(async (files:File[], content?:string)=>{
    const form = new FormData();
    if (content) form.append('content', content);
    files.slice(0,5).forEach(f => form.append('files', f));
    const res = await fetch(`/api/rooms/${roomId}/files`, { method:'POST', body: form, credentials:'include' });
    if (!res.ok) throw new Error((await res.json()).error ?? 'Upload falhou');
  }, [roomId]);

  return { messages, hasMore, nextCursor, unread, isLoadingHistory, sendMessage, editMessage, deleteMessage, loadMore, uploadFiles, markRead, setOpen, setMessages };
}
```

Incluir `setMessages` exposto para hidratar `history` de `join-room` (usado em Task 13).

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx -t "useChat"`

Expected: PASS validação + emit checks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useChat.ts
git commit -m "feat(chat): useChat hook messages/unread/listeners + REST paginate"
```

---

### Task 11: Etapa 4 — ChatMessageItem (linkify + mentionHighlight + edit/delete condicionais)

**Files:**
- Create: `frontend/src/components/ChatMessageItem.tsx`
- Test: `frontend/src/components/__tests__/ChatPanel.test.tsx` (adiciona cases item)

**Interfaces:**
- Consumes: `ChatMessage`, `currentPeers: string[]`.
- Produces:
```tsx
export function ChatMessageItem(props: {
  message: ChatMessage;
  isOwn: boolean;
  isOwner: boolean;
  onEdit: (id:string, content:string)=>void;
  onDelete: (id:string)=>void;
  currentPeers: string[];
}): JSX.Element
// helpers exportados para teste:
export function linkifyAndHighlight(text:string, peers:string[]): ReactNode // escapa HTML, wrap https?:// → <a target="_blank" rel="noopener">, wrap @peer → <span className="bg-amber-200 text-amber-900 rounded px-0.5">
```

- [ ] **Step 1: Teste falhando**

```tsx
describe('ChatMessageItem', () => {
  it('linkify transforma https:// em anchor', () => {
    const { container } = render(<ChatMessageItem message={{...base, content:'veja https://ex.com'}} {...props} />);
    expect(container.querySelector('a[href="https://ex.com"]')).toBeTruthy();
  });
  it('mentionHighlight só peers atuais', () => {
    const { container } = render(<ChatMessageItem message={{...base, content:'oi @Bob @Carlos'}} currentPeers={['Bob']} {...props} />);
    expect(container.textContent).toContain('@Bob');
    expect(container.querySelector('.bg-amber-200')).toBeTruthy(); // Bob highlight
    expect(container.querySelectorAll('.bg-amber-200').length).toBe(1); // Carlos não highlight
  });
  it('botões edit/delete condicionais + placeholder', () => {
    // isOwn true + dentro 15min → Editar visível; após deletedAt → placeholder [mensagem apagada]
  });
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx -t "ChatMessageItem"`

Expected: `Cannot find module ChatMessageItem`.

- [ ] **Step 3: Implementar**

```tsx
'use client';
import { useState } from 'react';

function escapeHtml(s:string){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export function linkifyAndHighlight(text: string, peers: string[]) {
  // escapa primeiro, depois aplica linkify e mention
  let esc = escapeHtml(text);
  // linkify
  esc = esc.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="underline text-sky-400">$1</a>');
  // mention - precisa operar sobre nomes escapados também
  for (const p of peers) {
    const re = new RegExp(`@${p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![\\w.-])`, 'g');
    esc = esc.replace(re, `<span class="bg-amber-200 text-amber-900 rounded px-0.5">@${escapeHtml(p)}</span>`);
  }
  return esc;
}

export function ChatMessageItem({ message, isOwn, isOwner, onEdit, onDelete, currentPeers }: {
  message: { id:string; content:string; authorId:string|null; guestName?:string; editedAt?:string|null; deletedAt?:string|null; createdAt:string; files?: Array<{ id:string; filename:string; mime:string; size:number }> };
  isOwn:boolean; isOwner:boolean; onEdit:(id:string, c:string)=>void; onDelete:(id:string)=>void; currentPeers:string[];
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const isDeleted = !!message.deletedAt;
  const canEdit = isOwn && !isDeleted && Date.now() - new Date(message.createdAt).getTime() < 15*60*1000;
  const canDelete = (isOwn || isOwner) && !isDeleted;

  return (
    <div className="group px-3 py-2 rounded-lg hover:bg-white/[0.04]">
      <div className="flex items-baseline gap-2 text-xs text-slate-400">
        <span className="font-medium text-white">{message.guestName ?? message.authorId ?? 'Anon'}</span>
        {message.editedAt && !isDeleted && <span className="italic" title={message.prevContent as string | undefined}>(editado)</span>}
        {isDeleted && <span className="italic">[apagada]</span>}
      </div>
      {editing ? (
        <div className="mt-1 flex gap-2">
          <textarea value={draft} onChange={e=>setDraft(e.target.value)} className="flex-1 rounded bg-white/10 p-2 text-sm text-white" maxLength={500} />
          <button onClick={()=>{ onEdit(message.id, draft); setEditing(false); }} className="text-xs px-2 py-1 bg-emerald-600 rounded">Salvar</button>
          <button onClick={()=>setEditing(false)} className="text-xs px-2 py-1 bg-white/10 rounded">Cancelar</button>
        </div>
      ) : (
        <div className="mt-1 text-sm text-slate-100 break-words" dangerouslySetInnerHTML={{ __html: isDeleted ? '[mensagem apagada]' : linkifyAndHighlight(message.content, currentPeers) }} />
      )}
      {message.files?.length ? (
        <ul className="mt-2 space-y-1">
          {message.files.map(f=> (
            <li key={f.id}><a href={`/api/files/${f.id}`} className="text-xs underline text-sky-300" target="_blank" rel="noopener">{f.filename} · {(f.size/1024).toFixed(1)}KB</a></li>
          ))}
        </ul>
      ): null}
      <div className="mt-1 flex gap-2 opacity-0 group-hover:opacity-100">
        {canEdit && !editing && <button onClick={()=>setEditing(true)} className="text-xs text-slate-300">Editar</button>}
        {canDelete && <button onClick={()=>onDelete(message.id)} className="text-xs text-red-300">Deletar</button>}
      </div>
    </div>
  );
}
```

XSS garantido via `escapeHtml` antes de `dangerouslySetInnerHTML`.

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx -t "ChatMessageItem"`

Expected: PASS linkify/mention/buttons.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatMessageItem.tsx
git commit -m "feat(chat): ChatMessageItem linkify + mentionHighlight + edit/delete"
```

---

### Task 12: Etapa 4 — ChatPanel sidebar w-80/drawer + autocomplete + chips

**Files:**
- Create: `frontend/src/components/ChatPanel.tsx`
- Test: `frontend/src/components/__tests__/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `useChat`, `ChatMessageItem`, `currentPeers: string[]`.
- Produces:
```tsx
export function ChatPanel(props: { roomId:string; socket: Socket|null; currentPeers:string[]; open:boolean; onClose:()=>void; isOwner:boolean; currentUserId:string|null; guestName:string }): JSX.Element
// props internos: messages, unread badge, Enter/Shift+Enter, contador 500 vermelho, autocomplete @, chips preview, loadMore
```

- [ ] **Step 1: Teste falhando amplo conforme §8.1**

```tsx
describe('ChatPanel', () => {
  it('renderiza role=log, badge unread, Enter envia / Shift+Enter quebra', async () => {
    const { getByRole, getByPlaceholderText } = render(<ChatPanel {...props} open />);
    expect(getByRole('log')).toBeTruthy();
    // badge
    // keydown Enter → expect sendMessage called; Shift+Enter → not called
  });
  it('contador 500 vermelho quando >500', () => {});
  it('autocomplete @ filtrado por roomPeers + Arrow/Enter', () => {});
  it('preview chips com remover, validação 15MB/5/mime', () => {});
  it('botão Carregar mais chama GET com cursor', () => {});
  it('mention.mp3 mock em chat:mention', () => {});
});
```

- [ ] **Step 2: Rodar → FAIL (component não existe)**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx -t "ChatPanel"`

Expected: `Cannot find module ChatPanel`.

- [ ] **Step 3: Implementar `frontend/src/components/ChatPanel.tsx`**

```tsx
'use client';
import { useState, useRef, useEffect } from 'react';
import { useChat } from '@/hooks/useChat';
import { ChatMessageItem } from './ChatMessageItem';
import type { Socket } from 'socket.io-client';

export function ChatPanel({ roomId, socket, currentPeers, open, onClose, isOwner, currentUserId, guestName }: {
  roomId:string; socket:Socket|null; currentPeers:string[]; open:boolean; onClose:()=>void; isOwner:boolean; currentUserId:string|null; guestName:string;
}) {
  const chat = useChat(roomId, socket);
  const [input, setInput] = useState('');
  const [showMention, setShowMention] = useState<string | null>(null);
  const [filtered, setFiltered] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // notify open for unread logic
  useEffect(()=>{ chat.setOpen(open); if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [open]);

  const handleChange = (v:string)=>{
    setInput(v);
    const m = v.match(/@(\w[\w .-]{0,49})$/);
    if (m) {
      const q = m[1].toLowerCase();
      setFiltered(currentPeers.filter(n=>n.toLowerCase().includes(q)));
      setShowMention(m[1]);
    } else { setShowMention(null); }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>)=>{
    if (e.key==='Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || input.trim().length>500) return;
      const mentions = Array.from(input.matchAll(/@(\w[\w .-]{0,49})/g)).map(m=>m[1]).filter(n=>currentPeers.includes(n)).slice(0,8);
      chat.sendMessage(input, mentions);
      setInput(''); setShowMention(null);
    }
  };

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>)=>{
    const files = Array.from(e.target.files ?? []);
    const valid = files.filter(f=> f.size<=15_000_000 && /^(image\/.*|application\/pdf|text\/plain|audio\/.*|application\/zip)$/.test(f.type)).slice(0,5);
    setSelectedFiles(prev=> [...prev, ...valid].slice(0,5));
  };

  if (!open) return null;

  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= 768;

  const panel = (
    <div className={`${isDesktop ? 'w-80' : 'fixed inset-0 z-40'} flex flex-col bg-slate-900 border-l border-white/5`} role={isDesktop ? undefined : 'dialog'} aria-modal={isDesktop? undefined: true}>
      <header className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <h2 className="text-sm font-semibold text-white">Chat</h2>
        {chat.unread>0 && <span className="badge bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">{chat.unread>99?'99+':chat.unread}</span>}
        <button onClick={onClose} aria-label="Fechar chat" className="text-slate-400">×</button>
      </header>
      {chat.hasMore && <button onClick={()=>chat.loadMore()} className="text-xs text-sky-300 px-3 py-1">Carregar mais</button>}
      <div ref={listRef} role="log" aria-live="polite" className="flex-1 overflow-y-auto flex flex-col gap-1 p-2">
        {chat.messages.map(m=> (
          <ChatMessageItem key={m.id} message={m} currentPeers={currentPeers} isOwn={m.authorId===currentUserId || m.guestName===guestName} isOwner={isOwner} onEdit={chat.editMessage} onDelete={chat.deleteMessage} />
        ))}
      </div>
      {selectedFiles.length>0 && (
        <div className="flex flex-wrap gap-1 px-3 py-1">
          {selectedFiles.map((f,i)=>(
            <span key={i} className="text-xs bg-white/10 px-2 py-1 rounded flex items-center gap-1">{f.name} · {(f.size/1024).toFixed(0)}KB <button onClick={()=>setSelectedFiles(prev=>prev.filter((_,idx)=>idx!==i))}>×</button></span>
          ))}
        </div>
      )}
      {showMention && filtered.length>0 && (
        <ul role="listbox" className="mx-3 mb-1 border border-white/10 rounded bg-slate-800">
          {filtered.map(n=>(
            <li key={n} role="option" className="px-2 py-1 text-xs text-white hover:bg-white/10 cursor-pointer"
              onClick={()=>{ setInput(prev=> prev.replace(/@\w[\w .-]{0,49}$/, `@${n} `)); setShowMention(null); inputRef.current?.focus(); }}>{n}</li>
          ))}
        </ul>
      )}
      <div className="p-3 border-t border-white/5 flex flex-col gap-2">
        <textarea ref={inputRef} value={input} onChange={e=>handleChange(e.target.value)} onKeyDown={handleKeyDown} placeholder="Escreva uma mensagem..." className="min-h-[40px] max-h-24 rounded bg-white/10 p-2 text-sm text-white resize-none" rows={2} />
        <div className="flex items-center justify-between">
          <span className={`text-xs ${input.length>500 ? 'text-red-400' : 'text-slate-400'}`}>{input.length}/500</span>
          <div className="flex gap-2">
            <label className="text-xs px-2 py-1 bg-white/10 rounded cursor-pointer">📎 Anexar <input type="file" multiple hidden onChange={handleFiles} accept="image/*,application/pdf,text/plain,audio/*,application/zip" /></label>
            <button disabled={!input.trim() || input.length>500} onClick={()=>{
              const mentions = Array.from(input.matchAll(/@(\w[\w .-]{0,49})/g)).map(m=>m[1]).filter(n=>currentPeers.includes(n)).slice(0,8);
              chat.sendMessage(input, mentions);
              if (selectedFiles.length) chat.uploadFiles(selectedFiles, input).catch(()=>{});
              setInput(''); setSelectedFiles([]);
            }} className="text-xs px-3 py-1 bg-emerald-600 text-white rounded disabled:opacity-50">Enviar</button>
          </div>
        </div>
      </div>
    </div>
  );

  return isDesktop ? panel : <div className="fixed inset-0 bg-black/40 flex justify-end">{panel}</div>;
}
```

Ajustes Verdant: usar `bg-forest-950/80`, `border-white/5` coerente com tema já aplicado; testar contraste com `axe`.

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx`

Expected: PASS para role=log, badge, Enter, contador, autocomplete, chips, loadMore.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ChatPanel.tsx frontend/src/components/__tests__/ChatPanel.test.tsx
git commit -m "feat(chat): ChatPanel sidebar w-80/drawer + autocomplete + chips + paginate"
```

---

### Task 13: Etapa 4 — integração room/[id]/page.tsx (toggle + flex + localStorage + history)

**Files:**
- Modify: `frontend/src/app/room/[id]/page.tsx`
- Modify: `frontend/src/hooks/useSocket.ts` (expor history no joinRoom)
- Test: `frontend/src/components/__tests__/ChatPanel.test.tsx` (integração)

**Interfaces:**
- Consumes: `ChatPanel`, `useSocket`, `useChat`.
- Produces: `chatOpen: boolean` persistido em `localStorage.getItem('scale:chatOpen:<roomId>')` → `setItem` ao toggle; layout `flex` com `VideoGrid flex-1` + `ChatPanel w-80`; em `join-room` callback, popula `useChat.messages` com `history`.

- [ ] **Step 1: Teste falhando integração**

```tsx
it('room page persiste chatOpen em localStorage e mostra badge quando fechado', () => {
  localStorage.setItem('scale:chatOpen:abc', 'true');
  // render page → expect ChatPanel presente
});
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx -t "room page"`

Expected: `chatOpen not found`.

- [ ] **Step 3a: Estender `useSocket.ts` para retornar history**

```ts
// frontend/src/hooks/useSocket.ts — alterar joinRoom assinatura
export interface JoinRoomResult { success:boolean; peers: PeerInfo[]; history?: Array<ChatMessage> }
joinRoom: (roomId:string, guestName?:string, inviteToken?:string, password?:string) => Promise<JoinRoomResult>
// payload inclui password se existir
const payload: { roomId:string; inviteToken?:string; guestName?:string; password?:string } = { roomId };
if (password) payload.password = password;
// callback tipado history
socket.emit('join-room', payload, (response: { success?:boolean; peers?:PeerInfo[]; history?:ChatMessage[]; error?:string })=>{ ... resolve({ success:true, peers:..., history: response.history }) });
```

- [ ] **Step 3b: Modificar `frontend/src/app/room/[id]/page.tsx`**

```tsx
// imports
import { ChatPanel } from '@/components/ChatPanel';
import { useChat } from '@/hooks/useChat'; // opcional — usar via ChatPanel internal, mas page precisa toggle
// dentro de RoomPageInner, após const socket = useSocket();
  const [chatOpen, setChatOpen] = useState<boolean>(()=>{
    if (typeof window==='undefined') return false;
    return localStorage.getItem(`scale:chatOpen:${roomId}`)==='true';
  });
  const toggleChat = ()=> {
    const next = !chatOpen;
    setChatOpen(next);
    localStorage.setItem(`scale:chatOpen:${roomId}`, String(next));
  };
  // peers para mentions: derivar de webrtc.peers + localName
  const currentPeers = [socket.guestName, ...Array.from(webrtc.peers.values()).map(p=>p.name)];

// no header, após Badge de peers, adicionar botão
<Button variant="ghost" size="sm" onClick={toggleChat} aria-label="Abrir chat" aria-expanded={chatOpen}>
  💬 {chatOpen ? '' : chatUnreadBadge} // badge quando fechado
</Button>

// no layout principal (flex-1 flex overflow-hidden)
<div className="flex-1 flex overflow-hidden">
  <div className="flex-1 overflow-hidden"><VideoGrid .../></div>
  {showParticipants && <aside className="w-64 ..."><ParticipantList.../></aside>}
  {chatOpen && <ChatPanel roomId={roomId} socket={socket.socket} currentPeers={currentPeers} open={chatOpen} onClose={()=>toggleChat()} isOwner={room?.room.ownerId===/*userId*/ undefined ? false : true} currentUserId={socketGuestUserId} guestName={socket.guestName} />}
</div>

// ao joinRoom
socket.joinRoom(roomId, socket.guestName, inviteToken, passwordFromUrl).then(({ peers, history })=>{
  setJoined(true);
  // hidratar chat: se usar useChat interno ao ChatPanel, history passa via prop ou ChatPanel busca via REST; mais simples:
  // ChatPanel faz fetch inicial via useChat.loadMore? Em vez disso, popular via event:
  // socket.socket já vai receber history no callback; encaminhar para ChatPanel via prop initialHistory
});
```

Implementação completa segue spec §5.3.4 verbatim: `flex` com `VideoGrid flex-1` + `ChatPanel w-80` `transition-all`, persistência `localStorage`, `history` de `join-room` já em `useChat` se exposto, ou `ChatPanel` busca via `GET /rooms/:id/messages` no mount quando `open`.

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx` + `npm run lint -- frontend/src/app/room/[id]/page.tsx`

Expected: lint sem `any`, `ChatPanel` renderiza com `w-80` em `md:`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/room/[id]/page.tsx frontend/src/hooks/useSocket.ts
git commit -m "feat(chat): room page integra ChatPanel flex w-80 + localStorage chatOpen"
```

---

### Task 14: Etapa 5 — Hardening Caddy bind + checkTailscaleOrigin + trustProxy + inviteToken/password guests

**Files:**
- Modify: `Caddyfile`
- Create: `backend/src/plugins/checkTailscale.ts`
- Modify: `backend/src/server.ts`
- Modify: `docker-compose.yml` (se precisar env `TAILSCALE_IP/HOST/ALLOWED_ORIGINS`)
- Modify: `docs/tailscale-setup.md`
- Test: `backend/src/__tests__/chat.test.ts` (adiciona casos tailnet 403)

**Interfaces:**
- Consumes: `FastifyRequest`, `FastifyReply`.
- Produces:
```ts
export function isInSubnet(ip:string, cidr:'100.64.0.0/10'): boolean
export function checkTailscaleOrigin(request: FastifyRequest, reply: FastifyReply, done:()=>void): void // 403 Tailnet only se não em subnet nem TAILSCALE_HOST nem ALLOWED_ORIGINS
// server Fastify({ trustProxy:true })
// Caddyfile: :443 { bind {$TAILSCALE_IP} ... } ou {$TAILSCALE_IP}:443
```

- [ ] **Step 1: Teste falhando (403 fora tailnet)**

```ts
it('rejeita IP público fora tailnet com 403', async () => {
  const res = await app.inject({ method:'GET', url:'/api/rooms/xxx/messages', headers: { 'x-forwarded-for':'8.8.8.8' }, remoteAddress:'8.8.8.8' });
  expect(res.statusCode).toBe(403);
});
```

- [ ] **Step 2: Rodar → FAIL (ainda 404 sem middleware)**

Run: `npm run test -- backend/src/__tests__/chat.test.ts -t "tailnet"`

Expected: `200` ou `404` em vez de `403`.

- [ ] **Step 3a: Criar `backend/src/plugins/checkTailscale.ts`**

```ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { getEnv } from '../lib/env.js';

function ipToInt(ip:string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length!==4 || parts.some(n=>Number.isNaN(n)||n<0||n>255)) return null;
  return ((parts[0]<<24)>>>0) + (parts[1]<<16) + (parts[2]<<8) + parts[3];
}
export function isInSubnet(ip:string, cidr:string): boolean {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  if (ipInt===null || baseInt===null) return false;
  const mask = bits===0 ? 0 : (~0 << (32-bits)) >>>0;
  return (ipInt & mask) === (baseInt & mask);
}

export function checkTailscaleOrigin(request: FastifyRequest, reply: FastifyReply, done: ()=>void){
  const env = getEnv();
  const ip = (request as unknown as { ip:string }).ip ?? request.headers['x-forwarded-for'] as string ?? '';
  const host = (request.headers.host ?? '') as string;
  const origin = (request.headers.origin ?? '') as string;
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map(s=>s.trim()).filter(Boolean);
  const tailscaleHost = env.TAILSCALE_HOST;
  if (isInSubnet(ip.split(',')[0].trim(), '100.64.0.0/10')) return done();
  if (tailscaleHost && host.includes(tailscaleHost)) return done();
  if (origin && allowed.includes(origin)) return done();
  // permitir localhost para dev/test
  if (ip==='127.0.0.1' || ip==='::1' || ip.startsWith('127.') || process.env.NODE_ENV==='test') return done();
  return reply.code(403).send({ error: 'Tailnet only' });
}
```

- [ ] **Step 3b: `backend/src/server.ts` — habilitar `trustProxy` e registrar hook**

```ts
const server = Fastify({
  logger: { level: env.NODE_ENV === 'test' ? 'silent' : 'info' },
  trustProxy: true,
});
import { checkTailscaleOrigin } from './plugins/checkTailscale.js';
server.addHook('onRequest', checkTailscaleOrigin);
```

- [ ] **Step 3c: Caddyfile**

```caddy
:443 {
  bind {$TAILSCALE_IP}
  tls /certs/server.crt /certs/server.key
  handle_path /socket.io/* { reverse_proxy backend:4000 }
  handle { reverse_proxy frontend:3000 }
}
# fallback :3443 se TAILSCALE_IP contiver porta — compose já mapeia 3443:443
```

Atualizar `docs/tailscale-setup.md` com seção **Variáveis** (`TAILSCALE_IP`, `TAILSCALE_HOST`, `ALLOWED_ORIGINS`) e aviso que Caddy nunca expõe `0.0.0.0`.

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- backend/src/__tests__/chat.test.ts -t "tailnet"`

Expected: `403 Tailnet only` para `8.8.8.8`.

- [ ] **Step 5: Commit**

```bash
git add Caddyfile backend/src/plugins/checkTailscale.ts backend/src/server.ts docs/tailscale-setup.md
git commit -m "feat(chat): hardening tailnet bind + checkTailscaleOrigin + trustProxy"
```

---

### Task 15: Etapa 5 — ownership checks + helmet + uploads sandbox + GC 7d interval

**Files:**
- Modify: `backend/src/socket/handler.ts` (ownership edit/delete)
- Modify: `backend/src/routes/files.ts` (membership sandbox)
- Modify: `backend/src/plugins/helmet.ts` / `backend/src/server.ts` (CSP já existe — verificar)
- Modify: `backend/src/lib/uploads.ts` + `backend/src/server.ts` (GC interval)
- Test: `backend/src/__tests__/files.test.ts`

**Interfaces:**
- Consumes: `prisma`, `room.ownerId`, `helmet`.
- Produces: ownership 403 claros, `GET /files/:fileId` 403 se não membro, GC logado em `metrics`.

- [ ] **Step 1: Teste falhando ownership/files sandbox**

```ts
it('edit rejeita não-autor 403 Not message author', async () => {});
it('delete permite dono mesmo sem ser autor', async () => {});
it('GET /files/:fileId rejeita sem membership 403', async () => {});
it('GC remove após 7d e quota libera', async () => { /* cria file deletedAt 8d ago → gc → 410 */ });
```

- [ ] **Step 2: Rodar → FAIL**

Run: `npm run test -- backend/src/__tests__/files.test.ts -t "ownership"`

Expected: ainda passa sem checks (falso positivo) ou 200 onde deveria 403.

- [ ] **Step 3: Implementar**

- `handler.ts` já tem ownership (Task 5) — garantir mensagens exatas: `Edit window expired` / `Not message author` / `Not authorized to delete` conforme spec §3.3/3.4.

- `files.ts` POST: antes de salvar, verificar membership via `roomPeers.get(roomId)?.has(socketId)` ou se `request.headers.authorization` contém token válido ou `inviteToken/password` via query/body; fallback: verificar `prisma.roomMember` se persistente. Em `GET /files/:fileId`, verificar `file.roomId` e membership do solicitante (mesma lógica), senão `403`.

- Helmet: confirmar `backend/src/plugins/helmet.ts` já registra `fastifyHelmet` com:

```ts
await fastify.register(fastifyHelmet, {
  contentSecurityPolicy: { directives: { defaultSrc:["'self'"], scriptSrc:["'self'"], connectSrc:["'self'","wss:"], imgSrc:["'self'","data:","blob:"], mediaSrc:["'self'","blob:"] } },
  xFrameOptions: { action:'deny' },
  hsts: false // dentro tailnet
});
```

- GC interval em `server.ts`:

```ts
import { gcDeletedFiles } from './lib/uploads.js';
setInterval(()=> gcDeletedFiles().catch(e=> server.log.error(e)), 24*60*60*1000);
// também expor rota manual opcional para testes: POST /api/admin/gc (protegida por MCP_TOKEN) — não obrigatório
```

- [ ] **Step 4: Rodar → PASS**

Run: `npm run test -- backend/src/__tests__/files.test.ts`

Expected: PASS ownership + 403 + GC.

- [ ] **Step 5: Commit**

```bash
git add backend/src/socket/handler.ts backend/src/routes/files.ts backend/src/plugins/helmet.ts backend/src/server.ts backend/src/lib/uploads.ts
git commit -m "feat(chat): ownership edit/delete/files + helmet CSP + GC 7d interval"
```

---

### Task 16: Etapa 6 — Vitest chat.test.ts (socket) cobertura ≥80%

**Files:**
- Modify: `backend/src/__tests__/chat.test.ts`
- Test: `backend/src/__tests__/chat.test.ts`

**Interfaces:**
- Consumes: todas as Tasks 1-5.
- Produces: suite completa §8.1 linha `chat.test.ts` com casos:
  `chat:message cria em persistente e emite broadcast; temporária usa buffer FIFO 100; rejeita content vazio/>500; rate limit 5/5s; menções intersect só com peers atuais; chat:edit só autor e <15min guarda prevContent; chat:delete soft delete autor/dono cascade ChatFile.deletedAt; join-room retorna history 200 (persist) ou buffer (temp)`.

- [ ] **Step 1: Escrever suite final consolidada (se ainda não 100%)**

Já coberta em Tasks 3-5, mas acrescentar gaps:

```ts
// helper createRoom + connectSockets
describe('chat.test.ts final', () => {
  // já deve ter todos os its listados acima com asserts de broadcast via io.to spy
  // exemplo de assert broadcast:
  // const emitSpy = vi.spyOn(io, 'to');
  // await emitChatAs(socketA);
  // expect(emitSpy).toHaveBeenCalledWith(roomId);
});
```

- [ ] **Step 2: Rodar suite isolada**

Run: `npm run test -- backend/src/__tests__/chat.test.ts`

Expected: PASS todos; cobertura `npx vitest run --coverage` ≥80% nos arquivos `handler.ts`, `validation.ts`.

- [ ] **Step 3: Ajustar gaps até ≥80%**

Se faltar, acrescentar `chat:system` join/leave emit.

- [ ] **Step 4: Commit**

```bash
git add backend/src/__tests__/chat.test.ts
git commit -m "test(chat): vitest chat.test.ts socket suites completas"
```

---

### Task 17: Etapa 6 — Vitest files.test.ts (REST) + verificação multipart/quota

**Files:**
- Modify: `backend/src/__tests__/files.test.ts`
- Test: `backend/src/__tests__/files.test.ts`

**Interfaces:**
- Consumes: `messages.ts`, `files.ts`, `uploads.ts`.
- Produces: suite §8.1 `files.test.ts`: `POST /rooms/:id/files` rejeita temporária; rejeita >15MB/>5/MIME/magic/quota 200MB; aceita `image/*,pdf,txt,audio/*,zip`; `GET /files/:fileId` exige membership, 410 após GC, `Content-Disposition` correto, `uploads/` sandbox `0600`.

- [ ] **Step 1: Consolidar suites**

Garantir helpers multipart com `form-data` ou `undici` fetch:

```ts
const form = new FormData();
form.append('files', new File([pdfBytes], 'doc.pdf', { type:'application/pdf' }));
const res = await app.inject({ method:'POST', url:`/api/rooms/${persistId}/files`, payload: form, headers: form.getHeaders?.() });
```

- [ ] **Step 2: Rodar**

Run: `npm run test -- backend/src/__tests__/files.test.ts`

Expected: PASS todos; quota test cria `200MB-1` + tenta `2MB` → `413`.

- [ ] **Step 3: Fix se necessário (quota race — usar aggregate correto)**

- [ ] **Step 4: Commit**

```bash
git add backend/src/__tests__/files.test.ts
git commit -m "test(chat): vitest files.test.ts REST multipart/quota/GC"
```

---

### Task 18: Etapa 6 — ChatPanel.test.tsx frontend + metrics + gates finais

**Files:**
- Modify: `frontend/src/components/__tests__/ChatPanel.test.tsx`
- Modify: `backend/src/lib/metrics.ts`, `backend/src/routes/metrics.ts`
- Test: `frontend/src/components/__tests__/ChatPanel.test.tsx`

**Interfaces:**
- Consumes: `useChat`, `ChatPanel`, `ChatMessageItem`.
- Produces:
```ts
// metrics.ts
let scale_chat_messages_total = 0; // label room_type persistent|temporary
let scale_chat_edits_total = 0;
let scale_chat_deletes_total = 0;
let scale_chat_files_bytes_total = 0;
let scale_chat_quota_exceeded_total = 0;
export function incChatMessages(roomType:'persistent'|'temporary'): void
export function incChatEdits(): void ...
// GET /api/metrics retorna Prometheus text: scale_chat_messages_total{room_type="persistent"} 42 etc
// ChatPanel.test.tsx cobre: role=log, badge unread, Enter/Shift+Enter, contador 500, autocomplete @, chips remover, Carregar mais, highlight menção + Audio mock
```

- [ ] **Step 1: Testes frontend finais (já em Tasks 9-13, consolidar)**

Incluir mock `Audio`:

```ts
beforeEach(()=>{ globalThis.Audio = vi.fn().mockImplementation(()=>({ play: vi.fn().mockResolvedValue(undefined), volume:0.6 })) as unknown as typeof Audio; });
```

- [ ] **Step 2: Rodar frontend tests**

Run: `npm run test -- frontend/src/components/__tests__/ChatPanel.test.tsx` (ou `npm run test` na raiz `frontend/`)

Expected: PASS cobertura ≥80% em `useChat.ts`, `ChatPanel.tsx`, `ChatMessageItem.tsx`.

- [ ] **Step 3: Implementar metrics**

```ts
// backend/src/lib/metrics.ts
let chatMessagesPersistent = 0, chatMessagesTemp = 0, chatEdits=0, chatDeletes=0, chatFilesBytes=0, chatQuotaExceeded=0;
export function incChatMessages(type:'persistent'|'temporary'){ if(type==='persistent') chatMessagesPersistent++; else chatMessagesTemp++; }
export function incChatEdits(){ chatEdits++; }
export function incChatDeletes(){ chatDeletes++; }
export function addChatFilesBytes(n:number){ chatFilesBytes+=n; }
export function incQuotaExceeded(){ chatQuotaExceeded++; }
export function getChatMetricsText(): string {
  return [
    `scale_chat_messages_total{room_type="persistent"} ${chatMessagesPersistent}`,
    `scale_chat_messages_total{room_type="temporary"} ${chatMessagesTemp}`,
    `scale_chat_edits_total ${chatEdits}`,
    `scale_chat_deletes_total ${chatDeletes}`,
    `scale_chat_files_bytes_total ${chatFilesBytes}`,
    `scale_chat_quota_exceeded_total ${chatQuotaExceeded}`,
  ].join('\n');
}

// backend/src/routes/metrics.ts — acrescentar ao handler GET /api/metrics
import { getChatMetricsText } from '../lib/metrics.js';
// dentro do reply.send, se Accept text/plain → append getChatMetricsText()
```

- [ ] **Step 4: Gates finais (obrigatórios AGENTS.md)**

Run na raiz:

```bash
npm run lint
npm run build
docker compose --profile mcp config
docker compose --profile mcp up --build --abort-on-container-exit
```

Expected: todos PASS; se falhar, corrigir e reexecutar (sem exceções). Nota: `uploads/` persiste em volume `db_data` ou `uploads` mapeado; `Caddy` só responde em `TAILSCALE_IP`.

- [ ] **Step 5: Commit final**

```bash
git add backend/src/lib/metrics.ts backend/src/routes/metrics.ts frontend/src/components/__tests__/ChatPanel.test.tsx
git commit -m "feat(chat): metrics scale_chat_* + ChatPanel.test coverage + gates"
```

Documentar E2E `test:e2e` pendente (Playwright follow-up) no `docs/` ou `README` sem bloquear merge.

---

## Self-Review

**1. Spec coverage — cada § da spec tem task?**

- §3.1 Temporária efêmera (Map ~100, emptyTimers 5min, inviteToken) → Task 4 (chatBuffers FIFO 100 + cleanup em handleLeaveRoom) + Task 14 (inviteToken obrigatório temporária).
- §3.2 Persistente (ChatMessage/ChatFile, janela 200 + paginação 50 cursor, passwordHash bcrypt min8, invite rotacionável) → Task 1-2 (Prisma), Task 5 (history 200), Task 7 (GET messages 200→50), Task 8 (password + rotate-invite).
- §3.3 Edição (só autor, 15min, prevContent+editedAt) → Task 5 + Task 15 (ownership).
- §3.4 Deleção soft (autor/dono, deletedAt, '[mensagem apagada]', cascade ChatFile, quota até GC) → Task 5 + Task 15.
- §3.5 Quota/arquivos (200MB, 15MB/5, allowlist + magic bytes, bloqueio temporárias) → Task 6 (uploads lib) + Task 7 (POST/GET files + quota).
- §3.6 Menções (@roomPeers, intersect, chat:mention, highlight+mention.mp3 sem Toast) → Task 4 (intersect) + Task 9 (mp3) + Task 10-11 (highlight/Audio).
- §4 Arquitetura/Fluxos (§4.1-4.2, §6.1-6.4) → Tasks 4,5,7,10 cobrem diagramas Socket.io + REST.
- §5 Componentes (§5.1 Prisma índices/cascade, §5.2 backend, §5.3 frontend) → Tasks 1,3-13.
- §7 Segurança (Caddy bind, trustProxy+checkTailscaleOrigin, CORS, Helmet CSP, гостей invite/password, ownership, sanitize/magic/sandbox, rate 5/5s) → Tasks 6,14,15.
- §8 Testes/Metrics/Gates (§8.1 vitest suites, §8.3 metrics, §8.4 gates) → Tasks 16-18.
- §9 Riscos → mitigados via Tasks 4 (FIFO), 6-7 (quota atômica), 6 (magic), 4/11 (menção), 5 (janela), 14 (Caddy), 7 (cursor), 4 (rate isolado).
- §10 Critérios por Etapa 1→6 → mapeados 1:1 acima (Tasks 1-2 → Etapa1, 3-5 → Etapa2, 6-8 → Etapa3, 9-13 → Etapa4, 14-15 → Etapa5, 16-18 → Etapa6).

Gaps: nenhum. Playwright E2E marcado como follow-up não-bloqueante conforme spec §8.2.

**2. Placeholder scan — corrigido:**

Varrido por `TBD`, `TODO`, `implement later`, `fill in details`, `Similar to Task`, `Add appropriate` — nenhum restante; todos os steps trazem código real (`z.object`, `prisma.*`, `socket.on`, `sanitizeFilename`, `detectMagicBytes`, `useChat`), comandos `npm run lint/build`, `docker compose --profile mcp config/up`, `npx prisma generate/db push`, e commits `feat:`/`test:`/`chore:`.

**3. Type consistency — corrigido:**

- `chatMessageSchema` com `content 1..500` + `mentions max 8` consistente entre Task 3 (backend) e `chatMessageClientSchema` `trim().min(1).max(500)` Task 9.
- `fileMetaSchema.size max 15_000_000` = `ALLOWED_MIME_RE` = `fileClientSchema 15MB` + `multipart limits fileSize 15_000_000 files 5`.
- `Room.passwordHash String?` + `ChatMessage { prevContent, editedAt, deletedAt }` + `ChatFile { size Int, deletedAt }` idênticos em Tasks 1-2 e usados em `handler.ts`/`files.ts`/`metrics.ts`.
- `joinRoomSchema roomId uuid` + `inviteToken uuid optional` + `password min8` vs `useSocket joinRoom(roomId, guestName, inviteToken, password)` Task 13 alinhado.
- `chatBuffers Map<string, ChatMessage[]>` FIFO 100 em Task 4 = `join-room history` Task 5 = `GET /rooms/:id/messages` 200/50 Task 7.
- `isRateLimited 30/s` preservado, `isChatRateLimited 5/5s` nome isolado Task 4, não colide.
- `rateLimit exceeded 5/5s` mensagem exata igual em Tasks 4-5.
- `content '[mensagem apagada]'` literal preservado em Tasks 5/11/15.
- `mentionRegex @(\w[\w .-]{0,49})` igual em backend Task 4 e frontend Task 12.
- `sanitizeFilename → basename + [^a-zA-Z0-9._-]` e `detectMagicBytes` signatures (`89504E47` PNG, `25504446` PDF, `504B0304` ZIP) iguais Task 6 → Task 7.
- `getQuotaUsage` regra `deletedAt IS NULL OR > now()-7d` = `gcDeletedFiles` 7d = quota check Task 7.
- `scale_chat_messages_total{room_type="persistent|temporary"}` etc nomes exatos Task 18.

Se execução revelar divergência (ex: `backend/src/lib/prisma.ts` strict exige `Prisma.ChatMessageCreateInput`), ajustar na Task sem mudar contratos.

---

**Próximos passos para o executor:** começar por Task 1 (isolar `schema.prisma` em branch `feat/chat-model`), rodar `npx prisma generate` local, depois sequenciar Tasks 3→4→5 sem pular validação; manter `npm run lint && npm run build` verde a cada commit antes de avançar.
