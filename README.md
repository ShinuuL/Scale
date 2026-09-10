# Scale 🐉 — Escamas de Dragão

**P2P mesh 2-8 via Tailscale** — Sistema de videochamadas P2P com escamas de dragão. Sala de voz e tela compartilhada via Tailscale. Suporta 2-8 participantes, salas temporárias e persistentes, com wizard de onboarding.

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
cd backend && npx prisma generate && cd ..

# Rodar migrations
cd backend && npx prisma db push && cd ..

# Iniciar em modo dev
npm run dev
```

O frontend estara em `http://localhost:3000` e o backend em `http://localhost:4000`.

### Docker Compose

```bash
# Sobe frontend + backend
docker compose up --build

# Sobe com MCP validator (profile mcp)
docker compose --profile mcp up --build --abort-on-container-exit

# Sobe com servidor TURN (profile turn)
docker compose --profile turn up --build

# Todos os profiles
docker compose --profile mcp --profile turn up --build
```

### Variaveis de Ambiente

Copie `.env.example` para `.env` e configure:

```env
JWT_SECRET=sua-chave-secreta-aqui
DATABASE_URL=file:./data.db
ALLOWED_ORIGINS=http://localhost:3000
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
ENABLE_TURN=false
# Scale — TAILSCALE_IP (IP Tailscale do servidor para rede mesh)
TAILSCALE_IP=
PORT=4000
NODE_ENV=development
```

| Variavel | Descricao | Padrao |
|----------|-----------|--------|
| `JWT_SECRET` | Chave secreta para JWT (min 8 chars) | `change-me-in-production` |
| `DATABASE_URL` | URL do SQLite | `file:./data.db` |
| `ALLOWED_ORIGINS` | Origens CORS permitidas | `http://localhost:3000` |
| `NEXT_PUBLIC_BACKEND_URL` | URL publica do backend | `http://localhost:4000` |
| `ENABLE_TURN` | Habilitar servidor TURN | `false` |
| `TAILSCALE_IP` | IP Tailscale do servidor | vazio |
| `PORT` | Porta do backend | `4000` |
| `NODE_ENV` | Ambiente (`development`, `production`, `test`) | `development` |

## Arquitetura

```
/
├── frontend/          # Next.js 15 App Router
│   ├── src/
│   │   ├── app/       # Pages (App Router)
│   │   ├── components/# React components
│   │   ├── hooks/     # Custom hooks (useSocket, useWebRTC)
│   │   └── lib/       # Utilities (api, validation)
│   └── Dockerfile
├── backend/           # Fastify 5 + Socket.io + Prisma
│   ├── src/
│   │   ├── lib/       # Auth, env, prisma, rateLimit
│   │   ├── plugins/   # Fastify plugins (cors, helmet, auth)
│   │   ├── routes/    # HTTP routes (auth, rooms, tailscale)
│   │   └── socket/    # Socket.io handlers
│   ├── prisma/        # Prisma schema
│   └── Dockerfile
├── mcp/               # MCP server (Docker profile mcp)
│   ├── src/
│   │   └── index.ts   # MCP validator
│   └── Dockerfile
├── docs/
│   ├── branding.md    # Identidade visual Scale
│   └── tailscale-setup.md
├── docker-compose.yml
├── AGENTS.md
└── README.md
```

## Servicos

### Frontend (porta 3000)

- Interface de videochamadas com WebRTC
- Wizard de onboarding para Tailscale
- Salas com grid de video e controles

### Backend (porta 4000)

- API REST (Fastify 5) para autenticacao e salas
- WebSocket (Socket.io 4) para signaling WebRTC
- Prisma 6 com SQLite para persistencia
- Rate limiting (30 msg/s por conexao)
- JWT em cookie HttpOnly

### MCP Validator (profile `mcp`)

- Verifica health do backend e frontend
- Testa conectividade Socket.io + join-room
- Reporta JSON com pass/fail

### COTURN (profile `turn`)

- Servidor TURN para WebRTC
- Uso quando NAT traversal direto nao funciona

## Observabilidade

### GET /api/metrics (backend)

Endpoint publico (sem auth) que expoe metricas de operacao em JSON:

```json
{
  "uptimeSeconds": 3600,
  "rooms": { "total": 12, "active": 5, "withPeers": 2 },
  "peers": { "total": 4, "byRoom": { "room-uuid": 2 } },
  "memory": { "rss": 41943040, "heapTotal": 33554432, "heapUsed": 20971520, "external": 1048576 },
  "version": "0.1.0"
}
```

- `rooms.total` / `rooms.active`: contagens via Prisma.
- `rooms.withPeers` e `peers`: snapshot do signaling (Socket.io) — salas com participantes conectados agora.
- `memory`: `process.memoryUsage()` em bytes.
- `version`: versao do pacote backend.

### GET /metrics (frontend)

Dashboard simples em `http://localhost:3000/metrics` com cards (uptime, salas, peers, memoria) e auto-refresh a cada 10s. Consome `/api/metrics` via proxy same-origin do Next.js.

### GET /mcp/metrics (MCP server, profile `mcp`)

Proxy do backend: `curl -H "Authorization: Bearer $MCP_TOKEN" http://localhost:4001/mcp/metrics`.

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
- [Configuracao do Tailscale](docs/tailscale-setup.md) - Guia completo de instalacao e configuracao

## Convencoes

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`)
- **Branches**: `feat/nome-da-feature`, `fix/nome-do-fix`
- **PRs**: Descrever mudancas, anexar testes e screenshots
- **TypeScript**: Strict mode, sem `any`, validacao com Zod
- **Testes**: TDD, testes antes ou durante implementacao

## Licenca

Proprietario - Todos os direitos reservados.
