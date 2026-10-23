# Scale

![Scale logo](./apps/web/public/logo.png)

**P2P mesh 2-8 com acesso remoto por túnel cloudflared** — Sistema de videochamadas P2P com escamas de dragão. Sala de voz e tela compartilhada, expostas por um túnel rápido `*.trycloudflare.com`. Suporta 2-8 participantes, salas temporárias e persistentes, com wizard de onboarding.

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 15 (App Router), export estatico |
| Desktop | Electron 44 (Windows; abre o servidor configurado) |
| Backend | Fastify 5 |
| WebSocket | Socket.io 4 |
| ORM | Prisma 6 |
| Database | SQLite |
| Proxy | Caddy 2 (estaticos + `/api` + `/socket.io`) |
| Compartilhado | `@scale/shared` (schemas zod, tipos, limites) |
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

Copie `.env.example` para `.env` e preencha. Os segredos marcados como
obrigatorios fazem o servico **recusar o start** em producao se estiverem
ausentes ou curtos: isso e intencional. Gere valores aleatorios, por exemplo:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

| Variavel | Descricao | Padrao |
|----------|-----------|--------|
| `JWT_SECRET` | Chave dos JWT de sessao (deriva tambem a chave do room ticket) | `change-me-in-production` |
| `GUEST_COOKIE_SECRET` | Assina o cookie `guestId` do convidado. **Obrigatorio em producao, >= 32 caracteres.** Trocar o valor faz convidados perderem a autoria das mensagens antigas | derivado do `JWT_SECRET` so em dev/teste |
| `METRICS_ADMIN_EMAILS` | E-mails (CSV) que podem ver `/api/metrics` e o painel `/metrics` | vazio = ninguem |
| `METRICS_SERVICE_TOKEN` | Token de servico (>= 32) que o MCP usa em `/api/metrics` | vazio |
| `MCP_TOKEN` | Token de quem chama o MCP. **Obrigatorio para o profile `mcp`, >= 32 caracteres** | — |
| `DATABASE_URL` | URL do SQLite | `file:./data.db` |
| `ALLOWED_ORIGINS` | Origens CORS permitidas (CSV) | `http://localhost:3000,http://localhost:8080` |
| `ENABLE_TURN` | Habilitar servidor TURN | `false` |
| `PROXY_PORT` | Porta do proxy (Caddy) no host: e a entrada do app | `8080` |
| `PORT` | Porta do backend em dev no host (container sempre 4000) | `4100` |
| `BACKEND_PORT` | Porta do backend publicada no host (so loopback) | `4100` |
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
│   ├── desktop/       # Electron: src/core (logica pura testada), main, preload,
│   │                  # renderer (setup e seletor de tela), electron-builder.yml
│   └── mcp/           # MCP server (Docker profile mcp)
├── packages/
│   └── shared/        # @scale/shared: schemas zod, tipos de eventos, limites
├── release/           # instaladores gerados (ignorado pelo git), ex. release/desktop/
├── e2e/               # Playwright
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
- Sala em `/room?id=<id>` no estilo canal de voz: lateral com quem fala, palco
  de transmissao de tela (Go Live) com foco, miniaturas e tela cheia
- Temas Jade, Grafite e Safira (menu de perfil), lembrados no navegador

### Desktop (Electron, `apps/desktop`)

- Abre a URL do servidor Scale configurada na primeira execucao (so `https://`,
  ou `localhost` em dev); o login por cookie HttpOnly funciona igual ao navegador
- Janela endurecida (sandbox, contextIsolation, sem Node na pagina, navegacao
  presa a origin, so microfone e captura de tela liberados) e fuses aplicados
- Seletor proprio de tela/janela para o compartilhamento
- Instalador: `npm run dist:desktop` gera `release/desktop/Scale-Setup-<versao>-x64.exe`
  (sem assinatura de codigo por enquanto: o SmartScreen alerta)
- Guia: `docs/desktop.md`

### Backend (porta 4100 no host em dev; 4000 no container)

- API REST (Fastify 5) para autenticacao e salas
- WebSocket (Socket.io 4) para signaling WebRTC
- Prisma 6 com SQLite para persistencia
- Rate limiting (30 msg/s por conexao)
- JWT em cookie HttpOnly (nunca no corpo da resposta)

## Seguranca

Regra geral: **nada do servidor e consultavel pelo front sem a prova certa**.

- **Participacao efetiva:** historico, download e upload de arquivos exigem
  ter entrado na sala, inclusive em sala publica. O `join-room` bem-sucedido
  emite um *room ticket* (JWT curto, 12 h, escopo da sala) enviado no header
  `X-Room-Ticket`. O dono da sala nao precisa de ticket; sala encerrada ou
  expirada nega a todos.
- **Convidado:** o servidor emite um `guestId` em cookie HttpOnly assinado. A
  autoria (editar, apagar, `isMine`) compara por `guestId` ou pelo usuario
  logado, nunca pelo nome exibido.
- **Credenciais fora da URL:** senha e convite da sala vao em header
  (`X-Room-Password`, `X-Room-Invite`), redigidos nos logs. 10 falhas em 15 min
  por IP e sala -> 429.
- **Respostas minimas:** DTOs publicos sem caminho de disco, ids internos ou
  e-mails; mensagem apagada nao devolve texto antigo nem arquivos; arquivo
  apagado -> 410; listagem `GET /api/rooms` so com nome e contagem de salas
  publicas ativas.
- **Cabecalhos e erros:** CSP sem `unsafe-inline` em scripts, `X-Frame-Options:
  DENY`, `no-store` em respostas privadas, erros 5xx sem detalhes internos.
- Modelo de confianca de proxy (`TRUST_PROXY`) e demais regras: `AGENTS.md`.

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

- `MCP_TOKEN`: quem chama o MCP (`curl -H "Authorization: Bearer $MCP_TOKEN" http://127.0.0.1:4001/mcp/metrics`). Obrigatorio, minimo 32 caracteres (o MCP aborta o start sem ele), comparado em tempo constante. O MCP so e publicado em `127.0.0.1:4001`, nao tem CORS e valida `:id` como UUID.
- `METRICS_SERVICE_TOKEN`: token de servico (>= 32 caracteres) que o MCP usa para chamar `/api/metrics`; o backend le o mesmo valor do `.env` e compara em tempo constante. Sem ele, `/mcp/metrics` responde **503** com instrucao. Usuarios logados so leem `/api/metrics` se o email estiver em `METRICS_ADMIN_EMAILS` (vazio = ninguem; demais recebem 403).

## Testes

### Vitest (unit/integration)

`npm run test` na raiz compila o `@scale/shared` e roda todos os workspaces:
**345 testes**.

| Workspace | Testes | Cobre |
|---|---|---|
| `scale-backend` (`apps/server`) | 148 (13 arquivos) | chat socket, REST paginado, uploads (magic bytes, quota, GC, sandbox), hardening (auth/CORS/Helmet/trust proxy), salas e senha, signaling, metricas; `securityAudit.test.ts` (um caso por item da auditoria) e `participation.test.ts` (room ticket e `guestId`) |
| `scale-frontend` (`apps/web`) | 87 | chat e upload, `useSocket`, `useWebRTC` (audio nos dois sentidos, glare), palco Go Live, temas, menu de perfil, aviso de desconexao, `Icon` |
| `scale-desktop` (`apps/desktop`) | 99 | URL do servidor, config, navegacao permitida/bloqueada, permissoes, IPC, protocolo local |
| `scale-mcp` (`apps/mcp`) | 6 | token obrigatorio, comparacao em tempo constante, validacao de `:id` |
| `@scale/shared` | 5 | schemas compartilhados |

Os testes do backend usam o SQLite local `apps/server/prisma/data.db`. Depois
de mudar o schema, sincronize-o:
`cd apps/server && DATABASE_URL=file:./data.db npx prisma db push`.

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
npm run test:e2e     # Playwright

# Desktop
npm run dev:desktop  # Electron em dev (se ELECTRON_RUN_AS_NODE estiver definida:
                     # env -u ELECTRON_RUN_AS_NODE npm run dev:desktop)
npm run dist:desktop # Instalador Windows em release/desktop/

# Docker
docker compose up --build              # Sobe tudo
docker compose down                    # Para tudo
docker compose logs -f                 # Logs em tempo real
docker compose --profile mcp up --build --abort-on-container-exit  # Com MCP

# Banco de dados
cd apps/server && npx prisma generate     # Gerar Prisma Client
cd apps/server && npx prisma db push      # Sincronizar schema
cd apps/server && npx prisma studio       # Interface visual do DB
```

## Documentacao

- [Branding — Identidade Visual](docs/branding.md) - Conceito, paleta e tipografia do Scale
- [Configuracao do tunel publico](docs/tunnel-setup.md) - Guia do tunel cloudflared (URL publica efemera)
- [Cliente desktop](docs/desktop.md) - Electron: rodar, gerar instalador, trocar servidor, seguranca

## Convencoes

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`)
- **Branches**: `feat/nome-da-feature`, `fix/nome-do-fix`
- **PRs**: Descrever mudancas, anexar testes e screenshots
- **TypeScript**: Strict mode, sem `any`, validacao com Zod
- **Testes**: TDD, testes antes ou durante implementacao
- **UI**: sem emojis na interface; icones sao SVG internos de `apps/web/src/components/ui/Icon.tsx`, sem dependencia externa

## Licenca

Proprietario - Todos os direitos reservados.
