# Scale

![Scale logo](./apps/web/public/logo.png)

**P2P mesh 2-8 com acesso remoto por túnel cloudflared** — Sistema de videochamadas P2P com escamas de dragão. Sala de voz e tela compartilhada, expostas por um túnel rápido `*.trycloudflare.com`. Suporta 2-8 participantes, salas temporárias e persistentes, com wizard de onboarding.

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 15 (App Router) |
| Backend | Fastify 5 |
| WebSocket | Socket.io 4 |
| ORM | Prisma 6 |
| Database | SQLite |
| Containerizacao | Docker Compose |
| Testes | Vitest (unit/integration) + Playwright (e2e) |

## Quick Start

### Desenvolvimento Local

```bash
# Instalar dependencias
npm install

# Gerar Prisma Client
npx prisma generate --schema=apps/server/prisma/schema.prisma

# Rodar migrations
(cd apps/server && npx prisma db push)

# Iniciar em modo dev
npm run dev
```

O frontend (`next dev`) estara em `http://localhost:3000` e o backend em `http://localhost:4100`.
Em dev o `/api` e reescrito pelo `next dev` e o socket conecta direto no backend
(`NEXT_PUBLIC_DEV_WS_URL`, so na fase de dev). No Docker o app e servido em
`http://localhost:${PROXY_PORT}` (Caddy), sempre no mesmo origin.

### Docker Compose

```bash
# Sobe backend + proxy (Caddy com o frontend estatico embutido). O proxy e a
# entrada do app e fica atras do tunel (default profile).
docker compose up --build

# Sobe com o tunel publico (profile tunnel): gera uma URL efemera
# https://<aleatorio>.trycloudflare.com. Leia a URL com:
#   docker compose logs cloudflared
# Guia completo: docs/tunnel-setup.md
docker compose --profile tunnel up -d --build

# Sobe com MCP validator (profile mcp)
docker compose --profile mcp up --build --abort-on-container-exit

# Sobe com servidor TURN (profile turn)
docker compose --profile turn up --build

# Todos os profiles
docker compose --profile mcp --profile turn --profile tunnel up --build
```

### Variaveis de Ambiente

Copie `.env.example` para `.env` e configure:

```env
JWT_SECRET=sua-chave-secreta-aqui
DATABASE_URL=file:./data.db
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:8080
ENABLE_TURN=false
PROXY_PORT=8080
PORT=4100
BACKEND_PORT=4100
NODE_ENV=development
```

| Variavel | Descricao | Padrao |
|----------|-----------|--------|
| `JWT_SECRET` | Chave secreta para JWT (min 8 chars) | `change-me-in-production` |
| `DATABASE_URL` | URL do SQLite | `file:./data.db` |
| `ALLOWED_ORIGINS` | Origens CORS permitidas (CSV) | `http://localhost:3000,http://localhost:8080` |
| `ENABLE_TURN` | Habilitar servidor TURN | `false` |
| `PROXY_PORT` | Porta do proxy interno (Caddy) no host | `8080` |
| `PORT` | Porta do backend em dev no host (container sempre 4000) | `4100` |
| `BACKEND_PORT` | Porta do backend publicada no host pelo compose | `4100` |
| `NODE_ENV` | Ambiente (`development`, `production`, `test`) | `development` |

## Arquitetura

```
/
├── apps/
│   ├── web/           # Next.js 15 App Router, export estatico (output: 'export')
│   │   ├── src/       # app/ (rotas), components/, hooks/, lib/
│   │   ├── public/    # assets + theme-boot.js (tema antes da 1a pintura)
│   │   ├── scripts/   # csp.mjs: gera a CSP (sha256 dos scripts inline)
│   │   └── Dockerfile # imagem do proxy: build estatico + Caddy
│   ├── server/        # Fastify 5 + Socket.io + Prisma
│   │   ├── src/       # lib/, plugins/, routes/, socket/
│   │   ├── prisma/    # Prisma schema
│   │   └── Dockerfile
│   └── mcp/           # MCP server (Docker profile mcp)
├── packages/
│   └── shared/        # @scale/shared: schemas zod, tipos de eventos, limites
├── docs/
├── docker-compose.yml
├── Caddyfile          # estaticos + /api + /socket.io + headers de seguranca
├── AGENTS.md
└── README.md
```

## Servicos

### Frontend (estatico, servido pelo proxy; `next dev` na 3000)

- Interface de videochamadas com WebRTC
- Wizard de onboarding em 5 passos (boas-vindas, criar conta ou entrar, criar ou entrar numa sala, compartilhar o link, microfone e tela), com tutorial interativo em `/tutorial`
- Salas com grid de video e controles

### Backend (porta 4100 no host em dev; 4000 no container)

- API REST (Fastify 5) para autenticacao e salas
- WebSocket (Socket.io 4) para signaling WebRTC
- Prisma 6 com SQLite para persistencia
- Rate limiting (30 msg/s por conexao)
- JWT em cookie HttpOnly

### MCP Validator (profile `mcp`)

- Verifica health do backend e frontend
- Testa conectividade Socket.io + join-room
- Reporta JSON com pass/fail

### Proxy interno (Caddy, default)

- Serve o export estatico do frontend (`try_files` com fallback) e roteia
  `/api/*` e `/socket.io/*` → `backend:4000`
- Headers: CSP sem `'unsafe-inline'` em `script-src` (hashes gerados no build),
  `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, cache
  imutavel em `/_next/static/*`
- Links antigos `/room/<id>` redirecionam (302) para `/room?id=<id>`
- Publica `${PROXY_PORT:-8080}`

### Cloudflared (profile `tunnel`)

- Tunel rapido (`--url http://proxy:8080`): URL efemera `*.trycloudflare.com`
- Sem conta, sem token, sem abrir porta no roteador
- Guia: `docs/tunnel-setup.md`

### COTURN (profile `turn`)

- Servidor TURN para WebRTC
- Uso quando NAT traversal direto nao funciona

## Observabilidade

### GET /api/metrics (backend)

Restrito a administradores. Aceita:

- usuario logado (cookie `token`) cujo email esta em `METRICS_ADMIN_EMAILS`
  (CSV; vazio = ninguem). Usuario comum recebe **403**;
- token de servico `Authorization: Bearer $METRICS_SERVICE_TOKEN` (>= 32
  caracteres, comparado em tempo constante) — e o que o MCP usa.

Sem credencial responde **401**. Login/register/refresh nao devolvem mais o JWT
no corpo (so no cookie HttpOnly).

```bash
curl -s -H "Authorization: Bearer $METRICS_SERVICE_TOKEN" http://localhost:4100/api/metrics | jq .
```

Resposta (JSON):

```json
{
  "uptimeSeconds": 3600,
  "rooms": { "total": 12, "active": 5, "withPeers": 2 },
  "peers": { "total": 4, "perRoom": [2] },
  "chat": { "messagesPersistent": 0, "messagesTemporary": 0, "edits": 0, "deletes": 0, "filesBytes": 0, "quotaExceeded": 0 }
}
```

- `rooms.total` / `rooms.active`: contagens via Prisma.
- `rooms.withPeers` e `peers.total` / `peers.perRoom`: snapshot do signaling (Socket.io) — salas com participantes conectados agora. `perRoom` traz **apenas as contagens** por sala: o `roomId` (uuid que dá acesso à sala) nunca sai deste endpoint.
- `POST /api/rooms` é limitado a 10 salas / 5s por IP (429 acima disso).
- `memory`/`version` nao sao expostos (fingerprint do servidor).

### GET /metrics (frontend)

Dashboard em `/metrics` com cards (uptime, salas, peers) e auto-refresh a cada 10s. Consome `/api/metrics` no mesmo origin (Caddy). Como o endpoint exige JWT, **sem sessao a pagina mostra "Requer login"** (com link para `/login`) em vez de quebrar.

### GET /mcp/metrics (MCP server, profile `mcp`)

Proxy do backend com dois tokens distintos:

- `MCP_TOKEN`: quem chama o MCP (`curl -H "Authorization: Bearer $MCP_TOKEN" http://localhost:4001/mcp/metrics`).
- `METRICS_SERVICE_TOKEN`: token de servico (>= 32 caracteres) que o MCP usa para chamar `/api/metrics`; o backend le o mesmo valor do `.env` e compara em tempo constante. Sem ele, `/mcp/metrics` responde **503** com instrucao. Usuarios logados so leem `/api/metrics` se o email estiver em `METRICS_ADMIN_EMAILS` (vazio = ninguem; demais recebem 403).

## Testes

### Vitest (unit/integration)

- **Backend** (`npm run test -w scale-backend`): **91 testes** (11 arquivos) — chat socket (message/edit/delete/rate/mentions/history), REST messages paginadas, files multipart (magic bytes, quota, GC, sandbox), uploads lib, hardening de exposição pública (auth/CORS/Helmet/trust proxy), rooms/password/rotate-invite, signaling e métricas `scale_chat_*` (inclui auth de `/api/metrics`: 401 sem credencial, 401 com token invalido, 200 com cookie/Bearer).
- **Frontend** (`npm run test -w scale-frontend`): **48 testes** (4 arquivos) — validação cliente + `useChat` (unread, edit/delete, mention audio, loadMore, upload) e `ChatMessageItem` (linkify, highlight, XSS, ações) cobertos em `ChatPanel.test.tsx`; `useSocket` (connect_error, onReconnect/isConnected); `useWebRTC` (regra determinística de quem inicia offer e glare/perfect negotiation); e `Icon` (decorativo vs rótulo acessível, grade 24×24, strokeWidth 1.75, preenchimento só nos estados "ligado"). A suíte de `ChatPanel` cobre ainda role=log, Enter/Shift+Enter, contador 500, autocomplete `@`, chips, loadMore e drawer mobile.

### GET /api/metrics — formato Prometheus

O endpoint aceita `Accept: text/plain` ou `?format=prometheus` e responde texto Prometheus (`scale_uptime_seconds`, `scale_rooms_total`, `scale_rooms_active`, `scale_peers_total`, `scale_chat_messages_total{room_type=...}`, `scale_chat_edits_total`, `scale_chat_deletes_total`, `scale_chat_files_bytes_total`, `scale_chat_quota_exceeded_total`).

### Playwright E2E

A suíte E2E (`npm run test:e2e`, `e2e/*.spec.ts`) cobre o fluxo de chat ponta a
ponta com **dois contextos de browser reais (P2P)**, além de acessibilidade e
reconexão:

- chat: criar sala → dois peers → mensagem em tempo real, edição/exclusão, menções, histórico e upload.
- **reconexão**: o WebSocket de um peer é derrubado de propósito; quando volta, o
  peer precisa **re-entrar na sala** (o socketId muda e o servidor já não o tem) —
  o teste valida o re-join pelo caminho funcional (mensagem entregue ao outro peer).
- acessibilidade: contraste WCAG AA e clipping das páginas públicas e da sala.

Nota: use `context.setOffline()` com cuidado em testes de queda — o cliente só
declara a conexão morta depois de `pingInterval + pingTimeout` (85s com a config
do backend), então o teste fecharia por timeout. Um proxy do próprio WebSocket
(rode o socket e feche-o quando quiser) torna o cenário deterministico e rápido.

## Comandos

```bash
# Desenvolvimento
npm run dev          # Frontend + backend em dev mode

# Qualidade
npm run lint         # ESLint em todos os workspaces
npm run build        # Build em todos os workspaces
npm run test         # Vitest unit/integration

# Docker
docker compose up --build              # Sobe tudo
docker compose down                    # Para tudo
docker compose logs -f                 # Logs em tempo real
docker compose --profile mcp up --build --abort-on-container-exit  # Com MCP

# Banco de dados
cd backend && npx prisma generate     # Gerar Prisma Client
cd backend && npx prisma db push      # Sincronizar schema
cd backend && npx prisma studio       # Interface visual do DB
```

## Documentacao

- [Branding — Identidade Visual](docs/branding.md) - Conceito, paleta e tipografia do Scale
- [Configuracao do tunel publico](docs/tunnel-setup.md) - Guia do tunel cloudflared (URL publica efemera)

## Convencoes

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`)
- **Branches**: `feat/nome-da-feature`, `fix/nome-do-fix`
- **PRs**: Descrever mudancas, anexar testes e screenshots
- **TypeScript**: Strict mode, sem `any`, validacao com Zod
- **Testes**: TDD, testes antes ou durante implementacao
- **UI**: sem emojis na interface; icones sao SVG internos de `apps/web/src/components/ui/Icon.tsx`, sem dependencia externa

## Licenca

Proprietario - Todos os direitos reservados.
