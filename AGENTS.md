# Scale — Constituição do Projeto

## Visão Geral

Sistema de videochamadas P2P (mesh) com escamas de dragão — sala de voz e tela compartilhada, com acesso remoto por túnel cloudflared. Suporta 2-8 participantes, salas temporárias e persistentes, com wizard de onboarding.

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

### Interface (UI)
- **Sem emojis na interface**: texto renderizado, `aria-label`, `title`, `placeholder`
  e `alt` usam palavras, nunca emoji.
- Ícones são **SVG internos** de `frontend/src/components/ui/Icon.tsx`
  (`viewBox 0 0 24 24`, `stroke="currentColor"`, `strokeWidth 1.75`,
  tamanho default 16).
- **Proibido adicionar biblioteca de ícones** (lucide, heroicons, react-icons e
  afins) — o componente interno existe para evitar a dependência.
- Glifos tipográficos usados como UI (setas de navegação, check, x) também viram
  SVG; setas em comentários de código, Markdown de documentação e logs do
  backend são texto comum e não contam.
- Ícone decorativo: `aria-hidden`. Ícone que carrega informação: prop `title`
  (o componente renderiza `role="img"` com `aria-label`). Botão só-ícone
  precisa de nome acessível próprio, em qualquer breakpoint.

## Gates Obrigatórios

Antes de considerar qualquer tarefa completa, TODOS os gates devem passar:

```bash
# 1. Lint
npm run lint

# 2. Build
npm run build

# 3. Docker Compose config válido (profile mcp)
docker compose --profile mcp config

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
- Acesso remoto: tunel cloudflared (URL publica efemera); rate limit e autenticacao sao a protecao

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
- Guia de configuração do túnel cloudflared
- MCP server para integração

### Não incluído (por agora)
- Gravação de chamadas
- Suporte a múltiplos dispositivos por usuário
- Escalabilidade além de 8 peers

### Já incluído (implementado e testado)
- Chat de texto em sala (persistente e temporária) com menções `@`, edição
  (janela de 15 min) e exclusão pelo autor
- Partilha de arquivos no chat: até 5 por mensagem, 15 MB por arquivo,
  allowlist de MIME (`image/*`, `application/pdf`, `text/plain`, `audio/*`,
  `application/zip`), validação por magic bytes e quota de 200 MB por sala
- Upload bloqueado em sala temporária (apenas persistente aceita arquivos)
- Sistema de ícones internos: UI sem emojis, `frontend/src/components/ui/Icon.tsx`
  com 29 ícones (SVG vetorial, `stroke="currentColor"`), sem dependência externa

## Requisitos de Infra

### Docker Compose
- Serviços: frontend, backend, mcp, proxy, cloudflared
- `proxy`: roteador interno HTTP (Caddy, profile default) que distribui por path
  — `/socket.io/*` → `backend:4000` (os rewrites do Next.js **não** fazem upgrade
  de WebSocket) e todo o resto → `frontend:3000`. Fica atrás do túnel.
- `cloudflared`: túnel rápido (profile `tunnel`) com `--url http://proxy:8080`,
  sem token/conta; gera URL efêmera `*.trycloudflare.com` a cada start.
- Volumes para SQLite persistente
- Health checks para todos os serviços
- Profile `mcp` para habilitar MCP server
- Profile `tunnel` para habilitar o túnel cloudflared

### Acesso remoto (tunel)
- Tunel publico via cloudflared (URL efemera `*.trycloudflare.com`)
- Sem necessidade de port forwarding
- Guia de configuração em `docs/tunnel-setup.md`

### Rede e exposicao
- Publicacao (default, endurecida): o `proxy` publica `${PROXY_PORT:-8080}` em
  todas as interfaces (e a entrada do app, usada pelo tunel e pelo navegador
  local); `backend` (`${BACKEND_PORT}`) e `frontend` (`3000`) ficam **so no
  loopback** (`127.0.0.1`). Publicados em `0.0.0.0`, `:3000`/`:4100` deixam
  qualquer host da rede forjar `X-Forwarded-For` e furar TODOS os baldes por IP.
  Para acesso direto na LAN, descomente a variante `0.0.0.0` no
  `docker-compose.yml` — ciente de que isso **reintroduz** a superficie.
  - Residuo conhecido: no loopback, `localhost:4100` e seguro (o peer e o
    gateway, fora do `TRUST_PROXY`), mas `localhost:3000` ainda fura — o rewrite
    `/api` do Next repassa o `X-Forwarded-For` recebido e o container do
    `frontend` precisa continuar confiavel. Exige processo JA no host (a LAN e
    recusada); ver `docs/tunnel-setup.md`.
- Túnel rápido `*.trycloudflare.com`: URL efêmera, **sem WAF nem Access** — a
  proteção é autenticação (JWT/cookie) + rate limit por IP real do cliente.
- Modelo de confiança (hops confiáveis, nunca a subnet inteira nem `true`):
  - Backend: `TRUST_PROXY=172.28.0.3/32,172.28.0.4/32,172.28.0.5/32` — apenas
    `frontend` (rewrites `/api`), `proxy` (`/socket.io` direto) e `cloudflared`
    (hop do tunel), cada um com `ipv4_address` fixo na rede `scale`. O gateway
    `172.28.0.1` NÃO entra: e o peer de quem alcanca porta publicada e confiar
    nele reabre o spoof. `TRUST_PROXY=true` ou `172.28.0.0/16` = spoof.
  - Caddy: bloco global `servers { trusted_proxies static 172.28.0.5/32 }` no
    `Caddyfile`. Sem ele o Caddy substitui o `X-Forwarded-For` pelo IP do
    `cloudflared` e TODO o trafego do tunel compartilha um unico balde (ex.: 5
    cadastros/hora para o mundo inteiro).
  - `NODE_ENV=production` no container (sem isencao de loopback nos baldes).
  - Teste (`docs/tunnel-setup.md`): 15 logins com `X-Forwarded-For` rotativo →
    o 11º deve dar 429; e o log do backend, para request pelo tunel, deve
    mostrar o SEU IP publico (nunca `172.28.x.x`).

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
- **Docs**: manter atualizado, especialmente setup e troubleshooting

---

**Status:** v1.0  
**Última atualização:** 2026-10-17
