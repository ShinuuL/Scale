# Scale — Spec de Chat (Opção A)

**Data:** 2026-09-11
**Status:** v1.0
**Base:** `AGENTS.md` v1.0 (2026-09-09) + `docs/superpowers/specs/2026-09-09-concord-design.md`
**Escopo:** chat de texto em sala — opção A aprovada (temporárias efêmeras + persistentes com senha, menções, edição, arquivos zip e hardening tailnet)

---

## 1. Overview

Esta spec formaliza o chat de texto do Scale sem alterar o core P2P existente. O chat funciona dentro da sala (`/room/[id]`) como canal lateral ao WebRTC mesh (2–8 peers), com transporte via Socket.io e persistência condicional via SQLite/Prisma.

- **Temporária efêmera:** histórico vive só em memória (`Map` por sala, ~100 mensagens), limpo quando `emptyTimers` dispara após 5 min vazia. Acesso exige `inviteToken`.
- **Persistente com histórico:** histórico em `ChatMessage`/`ChatFile` no SQLite, janela ativa de 200 mensagens + paginação de 50 via cursor. Acesso opcional por `inviteToken` rotacionável ou `passwordHash` (`bcrypt`, mínimo 8 caracteres).
- **Recursos comuns:** menções `@` restritas aos `roomPeers` atuais (highlight + `sounds/mention.mp3`, sem Toast), edição limitada ao autor em 15 min com `prevContent` + `editedAt`, deleção soft pelo autor ou dono da sala (`deletedAt`, `content='[mensagem apagada]'`, arquivos em cascata, quota 200 MB/sala).

A spec cobre arquitetura, componentes, fluxos, segurança, testes e critérios de aceite por etapa. Nenhum requisito novo além das 5 seções aprovadas é introduzido.

---

## 2. Objetivos e Não-objetivos

### 2.1 Objetivos

- Entregar chat de texto confiável dentro da sala, com latência baixa via Socket.io, sem degradar o mesh WebRTC.
- Distinguir comportamento efêmero (temporária) e persistente histórico (persistente) com regras claras de retenção e limpeza.
- Permitir colaboração leve: menções, edição, deleção soft e compartilhamento de arquivos com limites explícitos.
- Manter segurança tailnet-only (Caddy + `checkTailscaleOrigin`) e validação `zod` ponta a ponta.
- Garantir observabilidade (`metrics` chat) e gates reprodutíveis.

### 2.2 Não-objetivos

- Gravação de chamadas, chat fora de sala, DM entre usuários ou histórico global.
- Edição/deleção por não-autor (exceto dono da sala para deleção), threads, reações, markdown rico ou preview de links.
- Uploads acima de 15 MB, mais de 5 arquivos por mensagem, tipos fora da allowlist, ou quota acima de 200 MB/sala.
- Suporte a múltiplos dispositivos por usuário, escalabilidade além de 8 peers, ou exposição pública fora do tailnet.
- Notificações Toast para menções — apenas highlight inline e som simples.

---

## 3. Visão e Regras (§1 formalizado)

### 3.1 Temporária efêmera

| Regra | Definição |
|-------|-----------|
| Buffer | `Map<string, ChatMessage[]>` em memória no `backend/src/socket/handler.ts`, por `roomId`, limite ~100 mensagens (FIFO; descarta mais antigas). |
| Limpeza | Reusa `emptyTimers` existente (5 min vazia → `setTimeout` em `handleLeaveRoom`). Ao disparar, remove buffer da sala e, se `!room.isPersistent`, apaga a sala (`prisma.room.delete`). Não persiste em `ChatMessage`. |
| Acesso | `inviteToken` obrigatório em `join-room` quando `room.isPrivate === true` ou sempre para temporárias (token gerado em `POST /api/rooms`). Falha → `callback { error: 'Invalid invite token' }`. |
| Ciclo de vida | Mensagens existem só enquanto a sala existir em memória. `join-room` não retorna histórico de SQLite para temporárias. |

### 3.2 Persistente com histórico

| Regra | Definição |
|-------|-----------|
| Persistência | `ChatMessage` + `ChatFile` no SQLite via Prisma. Ao receber `chat:message`, persistir somente se `room.isPersistent === true`. |
| Janela ativa | `GET /rooms/:id/messages` retorna até 200 mensagens mais recentes (ordenadas por `createdAt DESC`, entregues ASC ao cliente). Paginação com `cursor` (id da mensagem mais antiga) retorna blocos de 50. |
| Senha | `Room.passwordHash` (`String?`, `bcrypt`, custo 10, mínimo 8 caracteres em claro antes do hash). `inviteToken` opcional e rotacionável (`POST /api/rooms/:id/rotate-invite` — dono). Acesso de convidado: `inviteToken` válido **ou** `password` correta. Falha → `403`. |
| Retenção | Mensagens persistentes não são apagadas por `emptyTimers`. Deleção soft mantém linha para paginação. GC de arquivos só após 7 dias de `deletedAt`. |

### 3.3 Edição

- Só autor (`message.authorId === userId` ou `guestName` correspondente para guests autenticados via token) e dentro de 15 min após `createdAt`.
- Payload: `chatEditSchema` (`messageId: uuid`, `content: 1..500`). Servidor guarda `prevContent` (conteúdo anterior) e `editedAt: DateTime`.
- Broadcast: `chat:edit` para `roomId` com `{ messageId, content, prevContent, editedAt }`.
- Tentar fora da janela ou sem ownership → `403` com `error: 'Edit window expired'` / `'Not message author'`.

### 3.4 Deleção soft

- Autor da mensagem ou dono da sala (`room.ownerId === userId`) pode deletar.
- Efeito: `deletedAt = now()`, `content = '[mensagem apagada]'`, `prevContent` preservado se houve edição, `editedAt` mantido. Arquivos vinculados (`ChatFile`) marcados `deletedAt` em cascata e excluídos da listagem.
- `ChatFile` em disco permanece até GC de 7 dias para permitir auditoria/quota. Contabiliza na quota até GC.
- Broadcast: `chat:delete` com `{ messageId, deletedAt }`. Clientes renderizam placeholder.

### 3.5 Quota e arquivos

- Quota: 200 MB por sala persistente (soma de `ChatFile.size` com `deletedAt IS NULL` + `deletedAt` dentro de 7 dias). Excedeu → `413 Quota exceeded`.
- Limites por upload: 15 MB por arquivo, até 5 arquivos por mensagem.
- Allowlist MIME: `image/*`, `application/pdf`, `text/plain`, `audio/*`, `application/zip`. Validação em duas camadas: `mime` declarado + magic bytes (`lib/uploads.ts`).
- Temporárias: upload bloqueado (`400 Temporary rooms do not support files`).

### 3.6 Menções

- Sintaxe: `@nome` onde `nome` corresponde a `roomPeers` atuais (`roomPeers.get(roomId)` no `handler.ts`). Menções a ex-participantes ou fora da sala são ignoradas (sem erro, sem highlight).
- Servidor faz `intersect(mentionsExtraídas, roomPeersNomes)` e emite `chat:mention` apenas para `socketId` dos mencionados, além do `chat:message` geral.
- Cliente: highlight inline (`mentionHighlight`) + `new Audio('/sounds/mention.mp3').play()` (volume baixo, respeita autoplay policy). Sem Toast.

---

## 4. Arquitetura

### 4.1 Diagrama ASCII

```
┌──────────────────────────────────────────────────────────────────┐
│                        Tailscale Mesh (100.64.0.0/10)            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Peer A   │  │ Peer B   │  │ Peer C   │  │ Peer N   │ (2-8)   │
│  │ Next.js  │  │ Next.js  │  │ Next.js  │  │ Next.js  │         │
│  │ WebRTC   │  │ WebRTC   │  │ WebRTC   │  │ WebRTC   │         │
│  │ ChatPanel│  │ ChatPanel│  │ ChatPanel│  │ ChatPanel│         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│       │             │             │             │                 │
│       └─────────────┴──────┬──────┴─────────────┘                 │
│                            │  Socket.io + REST (Fastify 5)        │
│                     ┌──────┴──────┐                              │
│                     │   Backend   │  Caddy :3443 (TAILSCALE_IP)   │
│                     │  Fastify    │  trustProxy + checkTailscale  │
│                     │  Socket.io  │  helmet CSP + CORS whitelist  │
│                     └──────┬──────┘                              │
│                            │                                     │
│              ┌─────────────┼──────────────┐                      │
│              │             │              │                       │
│       ┌──────┴──────┐ ┌───┴────┐  ┌──────┴──────┐                │
│       │   SQLite    │ │  Map   │  │   uploads/  │                │
│       │ (Prisma 6)  │ │buffer  │  │  sandbox    │                │
│       │ ChatMessage │ │ ~100   │  │  200MB/sala │                │
│       │ ChatFile    │ │temp    │  │  GC 7d      │                │
│       └─────────────┘ └────────┘  └─────────────┘                │
│                                                                  │
│                     ┌─────────────┐                               │
│                     │ MCP Server  │ (profile mcp, proxy opcional) │
│                     └─────────────┘                               │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Fluxo de Dados Geral

```
Frontend (useChat.ts) ──socket: chat:message/edit/delete──▶ Backend (handler.ts)
        │                                                     │  zod + rateLimit
        │                                                     ├─▶ Map buffer (temp) ──┐
        │                                                     ├─▶ Prisma (persist)    │
        │                                                     └─▶ Broadcast roomId ───┤
        │◀────────────── chat:message / chat:mention / system ───────────────────────┘
        │
        ├──REST GET /rooms/:id/messages?limit&cursor ──▶ messages.ts ──▶ SQLite
        ├──REST POST /rooms/:id/files (multipart) ──▶ files.ts ──▶ uploads/ + ChatFile
        └──REST GET /files/:fileId ──▶ files.ts (membership + mime + sandbox)
```

---

## 5. Componentes

### 5.1 Prisma — `backend/prisma/schema.prisma`

```prisma
model Room {
  id              String        @id @default(uuid())
  name            String
  ownerId         String?
  isPersistent    Boolean       @default(false)
  isPrivate       Boolean       @default(false)
  maxParticipants Int           @default(8)
  inviteToken     String        @unique @default(uuid())
  passwordHash    String?       // bcrypt, min 8 chars em claro; null = sem senha
  status          RoomStatus    @default(ACTIVE)
  createdAt       DateTime      @default(now())
  expiresAt       DateTime?

  owner       User?         @relation(fields: [ownerId], references: [id], onDelete: SetNull)
  roomMembers RoomMember[]
  chatMessages ChatMessage[]
  chatFiles    ChatFile[]    // agregado via ChatMessage, mas índice por roomId

  @@index([isPersistent, status])
  @@index([expiresAt])
}

model ChatMessage {
  id          String    @id @default(uuid())
  roomId      String
  authorId    String?   // User.id se autenticado, null para guest
  guestName   String?   // preenchido quando authorId null
  content     String    // 1..500, ou '[mensagem apagada]' quando soft-deleted
  prevContent String?   // conteúdo anterior à última edição
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
  filename    String    // sanitizado (basename, sem path)
  mime        String    // validado por allowlist + magic bytes
  size        Int       // bytes, max 15_000_000
  path        String    // caminho relativo sandbox (ex: uploads/<roomId>/<id>-<filename>)
  uploadedBy  String?   // authorId ou guestName
  createdAt   DateTime  @default(now())
  deletedAt   DateTime? // setado em cascata na deleção da mensagem

  room    Room        @relation(fields: [roomId], references: [id], onDelete: Cascade)
  message ChatMessage @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@index([roomId])
  @@index([messageId])
  @@index([roomId, deletedAt])
}
```

**Índices e integridade:** `ChatMessage` e `ChatFile` com `onDelete: Cascade` em `Room`/`ChatMessage` garantem limpeza em cascata na remoção definitiva da sala. Índices por `(roomId, createdAt)` e `(roomId, deletedAt)` otimizam janela de 200 e paginação 50.

### 5.2 Backend

#### 5.2.1 `backend/src/socket/validation.ts`

```ts
export const chatMessageSchema = z.object({
  roomId: z.string().uuid(),
  content: z.string().min(1).max(500),
  mentions: z.array(z.string().min(1).max(50)).max(8).optional(),
  // cliente envia raw; servidor valida length após trim
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
  messageId: z.string().uuid().optional(), // se upload avulso, cria mensagem de sistema
  filename: z.string().min(1).max(255),
  mime: z.string().min(3).max(127),
  size: z.number().int().min(1).max(15_000_000),
});
```

Validação server-side obrigatória; falha retorna `callback { error, details }` com `400`.

#### 5.2.2 `backend/src/socket/handler.ts`

**Estado em memória:**

```ts
const roomPeers = new Map<string, Map<string, RoomPeer>>(); // já existente
const emptyTimers = new Map<string, NodeJS.Timeout>();       // já existente, 5 min
const chatBuffers = new Map<string, ChatMessage[]>();        // novo: ~100 por sala temp
```

**Eventos Socket.io (namespaces existentes, novos handlers):**

| Evento | Direção | Payload validado | Comportamento |
|--------|---------|-----------------|---------------|
| `chat:message` | client→server | `chatMessageSchema` | rate limit 30/s + janela 5/5s; valida `roomId` existe e `ACTIVE`; valida membership (socket está em `roomPeers.get(roomId)`); extrai menções via regex `@(\w[\w .-]{0,49})`; `intersect` com `roomPeers` nomes; se `room.isPersistent` → `prisma.chatMessage.create`; senão → push em `chatBuffers` (FIFO 100); `io.to(roomId).emit('chat:message', msg)`; para cada mencionado → `io.to(socketId).emit('chat:mention', { messageId, roomId })`. |
| `chat:edit` | client→server | `chatEditSchema` | verifica ownership e `Date.now() - createdAt <= 15*60*1000`; atualiza `prevContent`, `content`, `editedAt`; broadcast `chat:edit`. |
| `chat:delete` | client→server | `chatDeleteSchema` | verifica `authorId` ou `room.ownerId`; soft delete (`deletedAt`, `content='[mensagem apagada]'`); marca `ChatFile.deletedAt` em cascata; broadcast `chat:delete`. |
| `chat:system` | server→room | `{ roomId, text, kind }` | mensagens de sistema (join/leave, rotação de invite) emitidas via `chat:system`. |
| `join-room` (estendido) | client→server | `joinRoomSchema` + `password?` | além do fluxo existente, retorna `history` (200 recentes se persistente, ou `chatBuffers` se temporária) no `callback { success, peers, history }`. |

**Rate limiting chat:** reuso de `lib/rateLimit.ts` com chave `chat:${socket.id}`. Duas janelas: 30/s global (já existente) + 5 mensagens em 5 s específica de chat (evita spam). Excedeu → `callback { error: 'Rate limit exceeded. Max 5 messages/5s.' }`.

#### 5.2.3 `backend/src/routes/messages.ts` — `GET /rooms/:id/messages`

```
GET /api/rooms/:id/messages?limit=50&cursor=<messageId>
Auth: membership (JWT owner ou guestName+inviteToken/password já validado em join)
```

- `limit` default 50, max 50, min 1 (`z.coerce.number().int().min(1).max(50)`).
- `cursor` opcional: `id` da mensagem mais antiga já carregada; query `where: { roomId, createdAt: { lt: cursorCreatedAt } }` ordenada `createdAt DESC` + `take: limit`.
- Retorna `{ messages: ChatMessage[], nextCursor: string | null }`. Filtra `deletedAt`? Não — retorna placeholder `[mensagem apagada]` para manter paginação consistente, exceto arquivos removidos da listagem.
- Temporárias → `404` ou `400` com `error: 'Temporary rooms have no persisted history'`.

#### 5.2.4 `backend/src/routes/files.ts`

```
POST /api/rooms/:id/files  — multipart/form-data
GET  /api/files/:fileId    — stream/download
```

**POST:**

- Auth: membership (mesma regra de `messages.ts`).
- Verifica `room.isPersistent === true`, senão `400`.
- `fastify-multipart` com `limits: { fileSize: 15_000_000, files: 5 }`.
- Para cada arquivo: sanitiza `filename` (`path.basename`, remove `..`, `null bytes`, limita 255), valida `mime` contra allowlist (`image/*`, `application/pdf`, `text/plain`, `audio/*`, `application/zip`), verifica magic bytes (`lib/uploads.ts: detectMagicBytes(buffer)` — ex: `25504446` PDF, `504B0304` ZIP, `89504E47` PNG), rejeita mismatch.
- Verifica quota: `SUM(size) WHERE roomId AND (deletedAt IS NULL OR deletedAt > now()-7d)` + novos arquivos ≤ 200 MB.
- Salva em `uploads/<roomId>/<fileId>-<sanitized>` via `lib/uploads.ts: saveFile()`.
- Cria `ChatFile` + `ChatMessage` (se `messageId` não fornecido, cria mensagem com `content` vazio ou texto do campo `content`).
- Retorna `201 { files: ChatFile[] }` e emite `chat:message` com `files` anexados.

**GET:**

- Auth: membership (usuário deve estar em `roomPeers` ou ter `inviteToken`/`password` válido para aquela sala — verificado via `prisma.room` + `roomPeers` snapshot).
- Stream com `Content-Type` do `mime` validado, `Content-Disposition: attachment; filename="<sanitized>"`, `X-Content-Type-Options: nosniff`.
- Se `file.deletedAt` não nulo e fora da janela de grace → `410 Gone`.

#### 5.2.5 `backend/src/lib/uploads.ts`

- `sanitizeFilename(name: string): string` — `basename`, remove `[^a-zA-Z0-9._-]` → `_`, trunca 255, previne `..` e `/`.
- `detectMagicBytes(buf: Buffer): string | null` — lê primeiros 8 bytes, mapeia para MIME esperado, retorna mismatch se divergir de `mime` declarado.
- `saveFile(roomId, fileId, filename, buffer): Promise<string>` — `mkdir -p uploads/<roomId>`, `writeFile` com `0600`, retorna `path`.
- `getQuotaUsage(roomId): Promise<number>` — soma `size` conforme regra.
- `gcDeletedFiles(): Promise<void>` — cron diário (ou `setInterval` 24h) remove de disco arquivos com `deletedAt < now()-7d` e `prisma.chatFile.delete`.

### 5.3 Frontend

#### 5.3.1 `frontend/src/hooks/useChat.ts`

Hook central que encapsula Socket.io chat + REST.

```ts
function useChat(roomId: string, socket: Socket | null) {
  // state
  messages: ChatMessage[]  // janela ativa (até 200 + paginados)
  hasMore: boolean
  nextCursor: string | null
  unread: number           // incrementa quando chat fechado e chega chat:message
  isLoadingHistory: boolean
  // actions
  sendMessage(content: string, mentions: string[]): void
  editMessage(messageId: string, content: string): void
  deleteMessage(messageId: string): void
  loadMore(): Promise<void> // GET /rooms/:id/messages?cursor
  uploadFiles(files: File[], content?: string): Promise<void>
  markRead(): void
}
```

- Conecta listeners `chat:message`, `chat:edit`, `chat:delete`, `chat:mention`, `chat:system` no `socket` fornecido por `useSocket` existente.
- `sendMessage` valida `z.string().min(1).max(500)` no cliente antes de emitir; `mentions` extraídas via regex cliente para autocomplete, mas servidor revalida.
- `chat:mention` → toca `sounds/mention.mp3` (`new Audio(...).volume = 0.6`) e aplica classe `mentionHighlight` na mensagem correspondente.
- `unread` zera em `markRead()` chamado quando `ChatPanel` abre ou usuário scrolla ao fim.

#### 5.3.2 `frontend/src/components/ChatPanel.tsx`

- **Layout:** sidebar direita `w-80` (`320px`) em `md:`+, `drawer` full-height com overlay em mobile (`fixed inset-0`, `role="dialog"`). Container principal com `role="log"` e `aria-live="polite"` para mensagens.
- **Header:** título "Chat" + `badge` unread (`{unread > 99 ? '99+' : unread}`) + botão fechar.
- **Lista:** virtualização simples (`overflow-y-auto`, `flex-col`, scroll ancorado no fim). Cada item é `ChatMessageItem`.
- **Input:** `textarea` com `Enter` envia, `Shift+Enter` quebra linha, contador `500` (`{content.length}/500`, vermelho quando >500), botão enviar desabilitado quando vazio ou >500.
- **Autocomplete `@`:** ao digitar `@`, filtra `roomPeers` (nomes atuais) case-insensitive, lista dropdown com `role="listbox"`, navegação `ArrowUp/Down` + `Enter`.
- **Preview chips de arquivos:** ao selecionar arquivos, mostra chips `{filename, size, mimeIcon}` com `×` para remover antes de enviar. Validação cliente: `file.size <= 15MB`, `files.length <=5`, MIME allowlist; erro inline.
- **Paginação:** botão "Carregar mais" no topo quando `hasMore`, chama `loadMore()`.

#### 5.3.3 `frontend/src/components/ChatMessageItem.tsx`

Props: `{ message, isOwn, isOwner, onEdit, onDelete, currentPeers }`.

- Renderiza `author` (nome + `editedAt ? ' (editado)' : ''` + `deletedAt ? ' [apagada]' : ''`), `content` com `linkify` (regex `https?://...` → `<a target="_blank" rel="noopener">`) e `mentionHighlight` (envolve `@nome` com `<span class="bg-amber-200">` quando `nome` está em `currentPeers`).
- Arquivos: lista de links `GET /files/:fileId` com ícone por MIME, tamanho formatado.
- Botões condicionais: `Editar` visível só se `isOwn && !deletedAt && Date.now()-createdAt < 15min`; `Deletar` visível se `(isOwn || isOwner) && !deletedAt`. Edição inline: substitui conteúdo por `textarea` com `Salvar/Cancelar`.

#### 5.3.4 `frontend/src/app/room/[id]/page.tsx` — integração

- Importa `ChatPanel` e `useChat`, adiciona estado `chatOpen: boolean` persistido em `localStorage.getItem('scale:chatOpen:<roomId>')`.
- Botão toggle na barra de controles existente (ícone chat + badge unread quando fechado).
- Layout: `flex` com `VideoGrid` (`flex-1`) + `ChatPanel` (`w-80` quando aberto, animação `transition-all`).
- Em `join-room` callback, popula `messages` iniciais com `history` retornado.

#### 5.3.5 `frontend/src/lib/validation.ts` (cliente)

```ts
export const chatMessageClientSchema = z.string().trim().min(1).max(500);
export const chatEditClientSchema = z.string().trim().min(1).max(500);
export const fileClientSchema = z.object({
  file: z.instanceof(File),
}).refine(f => f.file.size <= 15_000_000, 'Máx. 15MB')
 .refine(f => ALLOWED_MIME.test(f.file.type), 'Tipo não permitido');
```

Mensagens de erro em PT-BR, exibidas inline no `ChatPanel`.

#### 5.3.6 `frontend/public/sounds/mention.mp3`

Arquivo de áudio curto (~0.5s, <50KB), sem dependência externa. Tocado só em `chat:mention`, respeita `prefers-reduced-motion`? Não — áudio; respeita `AudioContext` suspenso em autoplay block (catch silencioso).

#### 5.3.7 `mcp` — proxy opcional

Se perfil `mcp` ativo, `mcp` pode expor `GET /mcp/rooms/:id/messages?limit&cursor` como proxy autenticado via `MCP_TOKEN`, reusando `GET /api/rooms/:id/messages` internamente (`BACKEND_URL=http://backend:4000`). Não adiciona lógica de chat própria; apenas repassa com mesma validação de `checkTailscaleOrigin`.

---

## 6. Data Flow / Fluxos (§3 — diagramas texto)

### 6.1 Enviar mensagem + menção

```
1. Usuário digita "olá @Bob" e pressiona Enter
   Frontend (ChatPanel) → validation.ts cliente (1..500) → useChat.sendMessage()
2. useChat extrai mentions ["Bob"] do conteúdo, emite:
   socket.emit('chat:message', { roomId, content: "olá @Bob", mentions: ["Bob"] })
3. Backend handler.ts:
   a. isRateLimited(`chat:${socket.id}`) → se 30/s ou 5/5s → callback error
   b. zod safeParse(chatMessageSchema)
   c. verifica roomPeers.has(socket.id) → senão 403 Not in room
   d. verifica room existe e ACTIVE, e inviteToken/password se necessário
   e. intersect mentions com roomPeers nomes → ["Bob"] se Bob está conectado
   f. if room.isPersistent → prisma.chatMessage.create({ roomId, authorId, content })
      else → chatBuffers.get(roomId).push(msg) (FIFO 100)
   g. io.to(roomId).emit('chat:message', fullMsg)
   h. para cada mencionado → io.to(mentionedSocketId).emit('chat:mention', { messageId })
   i. callback({ success: true, messageId })
4. Frontend listeners:
   - todos: append em messages[], scroll se perto do fim, incrementa unread se chat fechado
   - mencionados: toca mention.mp3, aplica mentionHighlight
```

### 6.2 Editar mensagem

```
1. Autor clica Editar em mensagem própria (janela <15min)
   ChatMessageItem → textarea → Salvar
2. Frontend valida 1..500, emite:
   socket.emit('chat:edit', { roomId, messageId, content: "novo texto" })
3. Backend:
   a. rate limit + zod(chatEditSchema)
   b. prisma.chatMessage.findUnique(messageId) → verifica roomId match
   c. verifica authorId === socketUser.userId (ou guestName)
   d. verifica now - createdAt <= 900_000 (15min) → senão 403 Edit window expired
   e. verifica deletedAt IS NULL → senão 400 Cannot edit deleted
   f. update { prevContent: oldContent, content, editedAt: now() }
   g. io.to(roomId).emit('chat:edit', { messageId, content, prevContent, editedAt })
4. Frontend: atualiza messages[] in place, mostra "(editado)" e tooltip com prevContent
```

### 6.3 Deletar mensagem

```
1. Autor ou dono clica Deletar → confirmação inline
   socket.emit('chat:delete', { roomId, messageId })
2. Backend:
   a. rate limit + zod(chatDeleteSchema)
   b. load message + room
   c. verifica (authorId === userId) OR (room.ownerId === userId) → senão 403
   d. verifica deletedAt IS NULL → senão idempotente success
   e. update message { deletedAt: now(), content: '[mensagem apagada]' }
   f. updateMany ChatFile where messageId → { deletedAt: now() }
   g. io.to(roomId).emit('chat:delete', { messageId, deletedAt })
   h. quota: mantém contabilização até GC 7d
3. Frontend: substitui content por placeholder, remove chips de arquivos, desabilita edit/delete
```

### 6.4 Upload / Download / Paginação

```
Upload:
1. Usuário seleciona até 5 arquivos (≤15MB, allowlist) + texto opcional
   ChatPanel preview chips → valida cliente (size, mime) → useChat.uploadFiles()
2. useChat faz POST /api/rooms/:id/files (multipart) com Authorization (JWT cookie)
   Headers: inviteToken ou password via query/body se guest
3. Backend files.ts:
   a. membership check (roomPeers ou inviteToken/password)
   b. isPersistent check → senão 400
   c. para cada file: sanitizeFilename, detectMagicBytes, quota check
   d. saveFile() em uploads/<roomId>/, prisma.chatFile.create + chatMessage.create
   e. io.to(roomId).emit('chat:message', msgComFiles)
   f. responde 201 { files }

Download:
1. Usuário clica em arquivo → GET /api/files/:fileId
2. Backend verifica membership + file.roomId === requested room
3. Se file.deletedAt e now - deletedAt > 7d → 410 Gone (GC já removeu)
   Senão stream com CSP nosniff + attachment

Paginação (cursor):
1. join-room retorna history (200 recentes) → cliente renderiza
2. Usuário clica "Carregar mais" no topo
   useChat.loadMore() → GET /api/rooms/:id/messages?limit=50&cursor=<oldestId>
3. Backend: lookup cursorCreatedAt, query WHERE roomId AND createdAt < cursorCreatedAt
   ORDER BY createdAt DESC LIMIT 50 → retorna { messages ASC, nextCursor }
4. Frontend: prepend em messages[], mantém scroll position (anchor no primeiro visível)
```

---

## 7. Segurança (§4)

### 7.1 Perímetro de rede — Caddy + Fastify

| Camada | Configuração | Efeito |
|--------|--------------|--------|
| Caddy | `bind {$TAILSCALE_IP} 443` ou `listen :3443` só em `TAILSCALE_IP:3443`; `Caddyfile` não publica em `0.0.0.0` | Exposição só via tailnet; `docker-compose.yml` profile `https` publica `3443:443` mas Caddy escuta só no IP tailnet |
| Fastify | `trustProxy: true` + `checkTailscaleOrigin` middleware em `server.ts` | Valida `X-Forwarded-For`/`request.ip` contra `100.64.0.0/10` (CGNAT Tailscale) **ou** `TAILSCALE_HOST` (ex: `scale.ts.net`) **ou** `ALLOWED_ORIGINS` whitelist (ex: `https://scale.tailnet:3443`). IP público → `403 Tailnet only`. |
| CORS | `origin: ALLOWED_ORIGINS.split(',')` + `credentials: true` | Whitelist explícita, sem `*`. |
| Helmet | `fastifyHelmet` com `contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], connectSrc: ["'self'", "wss:"] } }` | CSP habilitada, `X-Frame-Options: DENY`, `nosniff`. |

`checkTailscaleOrigin` (novo em `backend/src/plugins/checkTailscale.ts`):

```ts
export function checkTailscaleOrigin(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const ip = request.ip; // após trustProxy
  const origin = request.headers.origin;
  const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s=>s.trim());
  const tailscaleHost = process.env.TAILSCALE_HOST;
  if (isInSubnet(ip, '100.64.0.0/10')) return done();
  if (tailscaleHost && request.headers.host?.includes(tailscaleHost)) return done();
  if (origin && allowed.includes(origin)) return done();
  return reply.code(403).send({ error: 'Tailnet only' });
}
```

### 7.2 Acesso de convidados

- **Temporárias:** `inviteToken` obrigatório. `join-room` valida `inviteToken === room.inviteToken` quando `isPrivate` ou para todo acesso temporário. Sem token → `401`.
- **Persistentes:** `inviteToken` opcional **ou** `password`. Fluxo: `POST /api/rooms` com `password` (min 8) → `bcrypt.hash`; `join-room` aceita `{ inviteToken }` **ou** `{ password }` (comparado com `bcrypt.compare`). `inviteToken` rotacionável via `POST /api/rooms/:id/rotate-invite` (dono, gera novo `uuid`, emite `chat:system`).
- **Dono:** JWT em cookie `HttpOnly`, `SameSite=Strict`, `Secure` quando `NODE_ENV=production`. `fastify.authenticate` popula `request.userId`.
- **Guests:** `guestName` (1..50) + `inviteToken`/`password` válido; sem JWT. `SocketUser` com `userId: null`. Ownership de mensagem compara `guestName` quando `authorId null`.

### 7.3 Autorização e validação

- **Ownership checks:** `chat:edit` compara `message.authorId`/`guestName` com `socket.data.user`; `chat:delete` permite `author` **ou** `room.ownerId`. `GET /files/:fileId` verifica `file.roomId` e membership do solicitante.
- **Zod:** todos os eventos socket e rotas REST validados com `safeParse`; `400` com `details.flatten()` em falha. Frontend duplica validação para UX, mas servidor é autoritativo.
- **Sanitização:** `sanitizeFilename` remove path traversal; `detectMagicBytes` bloqueia `mime` forjado (ex: `image/png` com conteúdo `application/zip`); `linkify` escapa HTML antes de inserir `<a>` (previne XSS).
- **Rate limiting:** janela global 30/s por `socket.id` (existente) + janela chat 5/5s. Excedeu → rejeita com erro claro, sem derrubar conexão.
- **Files via GET:** só com membership ativo; sem listagem pública. `uploads/` fora de `public/`, servido só via `GET /files/:fileId` com `sandbox` (`path.resolve` deve estar sob `uploads/<roomId>`).

### 7.4 Quota e GC

- Quota 200 MB/sala inclui `deletedAt IS NULL` + `deletedAt > now()-7d`. GC diário: `setInterval(gcDeletedFiles, 24h)` remove do disco e apaga linha `ChatFile` quando `deletedAt < now()-7d` e `message.deletedAt` também expirado. Loga em `metrics`.

---

## 8. Testes, Observabilidade e Gates (§5)

### 8.1 Vitest — `backend/src/__tests__/chat.test.ts` e `files.test.ts`

| Suite | Casos |
|-------|-------|
| `chat.test.ts` — socket | `chat:message` cria em persistente e emite broadcast; temporária usa buffer FIFO 100; rejeita `content` vazio/>500; rate limit 5/5s; menções intersect só com peers atuais; `chat:edit` só autor e <15min, guarda `prevContent`; `chat:delete` soft delete autor/dono, cascade `ChatFile.deletedAt`; `join-room` retorna `history` 200 (persist) ou buffer (temp). |
| `files.test.ts` — REST | `POST /rooms/:id/files` rejeita temporária; rejeita >15MB, >5 arquivos, MIME fora allowlist, magic bytes mismatch, quota 200MB; aceita `image/*,pdf,txt,audio/*,zip` válidos; `GET /files/:fileId` exige membership, retorna 410 após GC, `Content-Disposition` correto. |
| `ChatPanel.test.tsx` — frontend | Renderiza `role=log`, badge unread, `Enter` envia/`Shift+Enter` quebra, contador 500, autocomplete `@` filtrado por `roomPeers`, preview chips com remover, botão "Carregar mais" chama `GET` com `cursor`, highlight menção e `mention.mp3` mock. |

### 8.2 E2E (Playwright) — follow-up

Cenários: criar sala persistente com senha, join com `inviteToken`/`password`, troca de mensagens, menção com som, edição em 15min, deleção por dono, upload `zip` + download, paginação 200→50, `emptyTimers` limpa buffer temporária após 5min.

### 8.3 Métricas — `backend/src/lib/metrics.ts`

Adição ao `GET /api/metrics` existente:

```
scale_chat_messages_total{room_type="persistent|temporary"} counter
scale_chat_edits_total counter
scale_chat_deletes_total counter
scale_chat_files_bytes_total counter
scale_chat_quota_exceeded_total counter
```

Incrementados em `handler.ts`/`files.ts`, expostos em Prometheus text format junto às métricas já existentes.

### 8.4 Gates obrigatórios

Executar na raiz do projeto antes de considerar a tarefa completa (conforme `AGENTS.md`):

```bash
npm run lint
npm run build
docker compose --profile mcp config
docker compose --profile mcp up --build --abort-on-container-exit
```

Falha em qualquer gate → corrigir e reexecutar. Sem exceções. O chat não altera `docker-compose.yml` além de variáveis já previstas (`TAILSCALE_IP`, `TAILSCALE_HOST`, `ALLOWED_ORIGINS`); `volumes: db_data` e `uploads/` persistem em `db_data`.

---

## 9. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| Buffer em memória cresce sem limite | Médio | FIFO rígido 100 por sala temporária; `emptyTimers` remove buffer junto à sala; sem persistência. |
| Quota 200 MB estoura com uploads paralelos | Médio | Check atômico `SUM` + `SERIALIZABLE` ou `SELECT ... FOR UPDATE` antes de `create`; erro `413` claro; GC 7d libera espaço. |
| Magic bytes bypass via polyglot | Alto | Validar magic bytes **e** extensão sanitizada; `helmet` `nosniff`; `Content-Disposition: attachment` (não `inline`). |
| Menções spam / som irritante | Baixo | Só peers atuais; som curto, volume 0.6, sem autoplay se bloqueado (catch silencioso); sem Toast. |
| Edição fora da janela gera disputa | Baixo | Janela fixa 15min server-side; `prevContent` auditável; UI desabilita botão após expirar. |
| Caddy exposto em IP público por engano | Alto | `Caddyfile` com `bind {$TAILSCALE_IP}`; `checkTailscaleOrigin` como segunda barreira (403); doc `tailscale-setup.md` atualizado com `TAILSCALE_IP`/`HOST`. |
| Paginação com cursor inválido | Baixo | Validar `cursor` existe e pertence à sala; `404` se não encontrado; `limit` clamp 1..50. |
| WebRTC + chat competem por socket | Médio | Reuso do mesmo `Server` Socket.io; rate limit separado para chat (5/5s) não afeta `signal:*` (30/s global). |

---

## 10. Critérios de Aceite por Etapa

### Etapa 1 — Modelagem (Prisma)

- [ ] `Room.passwordHash` adicionado, `ChatMessage` e `ChatFile` criados com índices e `onDelete: Cascade` conforme §5.1
- [ ] `prisma generate` e `prisma db push` passam; `backend/src/lib/prisma.ts` sem `any`
- [ ] Teste `chat.test.ts` setup: cria sala persistente com senha e sala temporária com buffer vazio

### Etapa 2 — Socket (tempo real)

- [ ] `validation.ts` com `chatMessageSchema` (1..500), `chatEditSchema`, `chatDeleteSchema`, `fileMetaSchema` e testes `zod`
- [ ] `handler.ts` com `chatBuffers` (~100 FIFO), `chat:message`/`edit`/`delete`/`mention`/`system`, rate 30/s + 5/5s, `intersect` menções, persist condicional
- [ ] `join-room` estendido retorna `history` (200 persist / buffer temp) e cancela `emptyTimers` quando reocupada
- [ ] `chat.test.ts` socket: todos os casos de §8.1 passam

### Etapa 3 — REST (mensagens e arquivos)

- [ ] `routes/messages.ts` `GET /rooms/:id/messages?limit&cursor` com validação `limit` 1..50, `nextCursor`, placeholder `[mensagem apagada]`
- [ ] `routes/files.ts` `POST /rooms/:id/files` (multipart 15MB, 5/mensagem, allowlist + magic bytes, quota 200MB) e `GET /files/:fileId` com membership + `attachment`
- [ ] `lib/uploads.ts` com `sanitizeFilename`, `detectMagicBytes`, `saveFile`, `getQuotaUsage`, `gcDeletedFiles` (7d)
- [ ] `routes/room.ts` (ou novo `routes/rooms.ts`) com `POST /rooms/:id/rotate-invite` (dono) e `passwordHash` bcrypt min 8
- [ ] `files.test.ts` passa; `uploads/` em `sandbox` com `0600`

### Etapa 4 — Frontend

- [ ] `hooks/useChat.ts` com `messages`, `unread`, `send/edit/delete/loadMore/upload`, listeners `chat:*`, `mention.mp3`
- [ ] `components/ChatPanel.tsx` sidebar `w-80` desktop / drawer mobile (`role=log`, badge unread, `Enter`/`Shift+Enter`, contador 500, autocomplete `@` filtrado, preview chips)
- [ ] `components/ChatMessageItem.tsx` com `linkify`, `mentionHighlight`, botões edit/delete condicionais, placeholder deleção
- [ ] `app/room/[id]/page.tsx` integra `ChatPanel`, persiste `chatOpen` em `localStorage`, reposiciona `VideoGrid`
- [ ] `lib/validation.ts` cliente com `z.string().trim().min(1).max(500)` e `fileClientSchema`; erros PT-BR inline
- [ ] `public/sounds/mention.mp3` presente; `ChatPanel.test.tsx` passa

### Etapa 5 — Hardening (segurança e rede)

- [ ] `Caddyfile` com `bind {$TAILSCALE_IP}:443` (ou `:3443` no compose) e doc `tailscale-setup.md` atualizado
- [ ] `server.ts` com `trustProxy: true` e `checkTailscaleOrigin` (100.64.0.0/10 + `TAILSCALE_HOST` + `ALLOWED_ORIGINS` whitelist, `403 Tailnet only`)
- [ ] Convidados via `inviteToken` (temporárias) ou `password`/`inviteToken` (persistentes); JWT `HttpOnly` `SameSite=Strict` para dono; `guestName` para guests
- [ ] Ownership checks em edit/delete/files; `helmet` CSP; `uploads/` sem listagem; quota GC 7d com log

### Etapa 6 — Testes e Gates

- [ ] `backend/src/__tests__/chat.test.ts` + `files.test.ts` + `frontend/src/components/__tests__/ChatPanel.test.tsx` com cobertura ≥80% nos novos módulos
- [ ] `metrics.ts` com `scale_chat_*` expostos em `/api/metrics`
- [ ] Todos os gates passam: `npm run lint`, `npm run build`, `docker compose --profile mcp config`, `docker compose --profile mcp up --build --abort-on-container-exit`
- [ ] E2E Playwright follow-up documentado (não bloqueia merge, mas criado como `test:e2e` pendente)

---

## 11. Referências

- `AGENTS.md` v1.0 (2026-09-09) — stack (Next.js 15, Fastify 5, Socket.io 4, Prisma 6, SQLite, Docker Compose, Vitest + Playwright), strict mode sem `any`, `zod` obrigatório, gates (`lint`, `build`, `docker compose --profile mcp config/up`), JWT `HttpOnly` `SameSite=Strict`, rate limiting 30/s, CORS whitelist, CSP, Tailscale tailnet-only, STUN `stun:stun.l.google.com:19302`.
- `docs/superpowers/specs/2026-09-09-concord-design.md` — spec anterior (Concord/Scale) com arquitetura P2P mesh, fluxos criar/join/signaling/screen-share, Docker Compose com `frontend`/`backend`/`mcp` (profile `mcp`), volumes `sqlite-data`, health checks, wizard 5 passos.
- `backend/prisma/schema.prisma` — modelos `Room`, `User`, `RoomMember` atuais, base para extensão `passwordHash`, `ChatMessage`, `ChatFile`.
- `backend/src/socket/handler.ts` / `validation.ts` / `lib/rateLimit.ts` — `roomPeers`, `emptyTimers` (5 min), `joinRoomSchema`, `isRateLimited` 30/s, padrão de callbacks e `zod` `safeParse`.
- `backend/src/routes/rooms.ts` / `docker-compose.yml` / `Caddyfile` — padrões REST, `TAILSCALE_IP`/`HOST`/`ALLOWED_ORIGINS`, `trustProxy` e `helmet`.

---

**Próximos passos:** implementar Etapa 1 (modelagem) → 2 (socket) → 3 (REST) → 4 (frontend) → 5 (hardening) → 6 (testes/gates), validando cada critério antes de avançar.
