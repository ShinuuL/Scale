# Scale — Constituição do Projeto

## Visão Geral

Sistema de videochamadas P2P (mesh) com escamas de dragão — sala de voz e tela compartilhada via Tailscale. Suporta 2-8 participantes, salas temporárias e persistentes, com wizard de onboarding.

## Stack

| Camada | Tecnologia |
|--------|------------|
| Frontend | Next.js 15 (App Router) |
| Backend | Fastify 5 |
| WebSocket | Socket.io 4 |
| ORM | Prisma 6 |
| Database | SQLite |
| Containerização | Docker Compose |
| Testes | Vitest (unit/integration) + Playwright (e2e) |

## Regras de Código

### TypeScript
- **strict mode** em todos os pacotes
- Sem `any` — usar tipos adequados
- Usar `zod` para validação de inputs

### Qualidade
- ESLint + Prettier configurados e obrigatórios
- TDD: testes antes ou durante implementação
- Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`)

### Estrutura
```
/
├── frontend/          # Next.js 15 App Router
├── backend/           # Fastify 5 + Socket.io + Prisma
├── mcp/               # MCP server config (Docker profile)
├── docker-compose.yml # Orquestração completa
├── AGENTS.md          # Este arquivo
└── docs/              # Documentação
```

## Gates Obrigatórios

Antes de considerar qualquer tarefa completa, TODOS os gates devem passar:

```bash
# 1. Lint
npm run lint

# 2. Build
npm run build

# 3. Docker Compose config válido (profile mcp)
docker compose config --profile mcp

# 4. Build e up dos containers (quando aplicável)
docker compose --profile mcp up --build --abort-on-container-exit
```

**Regra:** Se um gate falhar, corrigir e rodar novamente. Sem exceções.

## Segurança

### Autenticação
- JWT em cookie HttpOnly com SameSite=Strict
- Tokens de sala: UUID v4
- TTL de sala temporária: definido na criação

### Validação
- **Zod** em todos os inputs do frontend e backend
- Validação server-side obrigatória

### Rate Limiting
- Máximo 30 mensagens/segundo por conexão
- Rejeitar excedentes com erro claro

### Rede
- CORS: whitelist de origens permitidas
- Content Security Policy (CSP) habilitada
- Tailscale: rede privada, sem exposição pública

### WebRTC
- **TURN server**: opcional (configurável)
- STUN público: `stun:stun.l.google.com:19302`
- ICE candidates: coletar e trocar via signaling

## Escopo Travado

### Incluído
- Mesh network 2-8 participantes
- Salas temporárias (com TTL) e persistentes
- Tela compartilhada via WebRTC
- Wizard de onboarding
- Guia de configuração Tailscale
- MCP server para integração

### Não incluído (por agora)
- Gravação de chamadas
- Chat de texto
- Partilha de arquivos
- Suporte a múltiplos dispositivos por usuário
- Escalabilidade além de 8 peers

## Requisitos de Infra

### Docker Compose
- Serviços: frontend, backend, mcp
- Volumes para SQLite persistente
- Health checks para todos os serviços
- Profile `mcp` para habilitar MCP server

### Tailscale
- Rede mesh privada entre dispositivos
- Sem necessidade de port forwarding
- Guia de configuração em `docs/tailscale-setup.md`

### MCP Server
- Endpoints para consulta de estado das salas
- Autenticação via token
- Integração com ferramentas externas

## Comandos Úteis

```bash
# Desenvolvimento local
npm run dev          # Inicia frontend + backend em dev mode

# Testes
npm run test         # Vitest unit/integration
npm run test:e2e     # Playwright end-to-end

# Docker
docker compose up --build    # Sobe tudo
docker compose down          # Para tudo
docker compose logs -f       # Logs em tempo real
```

## Convenções

- **Branches**: `feat/nome-da-feature`, `fix/nome-do-fix`
- **PRs**: descrever mudanças, anexar testes, screenhots quando relevante
- **Commits**: conventional commits, mensagens claras e concisas
- **Docs**: manter atualizado,特别是 setup e troubleshooting

---

**Status:** v1.0  
**Última atualização:** 2026-09-09
