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
├── apps/
│   ├── web/           # Next.js 15 App Router, export estatico (servido pelo Caddy)
│   ├── server/        # Fastify 5 + Socket.io + Prisma
│   └── desktop/       # Cliente Electron (Windows): abre a URL do servidor numa janela endurecida
├── packages/
│   └── shared/        # @scale/shared: schemas zod, tipos de eventos e limites
├── Caddyfile          # proxy: estaticos + /api + /socket.io + CSP
├── docker-compose.yml # Orquestração completa
├── AGENTS.md          # Este arquivo
└── docs/              # Documentação
```

### Interface (UI)
- **Sem emojis na interface**: texto renderizado, `aria-label`, `title`, `placeholder`
  e `alt` usam palavras, nunca emoji.
- Ícones são **SVG internos** de `apps/web/src/components/ui/Icon.tsx`
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

## Desktop (Electron)

`apps/desktop` (pacote `scale-desktop`) **nao empacota o frontend**: abre a origin
do servidor configurado (cookie HttpOnly SameSite=Strict, mesmo CSP, front
atualiza sem reinstalar). Guia: `docs/desktop.md`.

- Janelas: `contextIsolation`, `sandbox`, `webSecurity` ligados; `nodeIntegration`,
  `webviewTag`, `allowRunningInsecureContent` desligados; DevTools so com `--dev`
  fora do pacote.
- A pagina remota **nao tem preload**. So as telas locais (setup, seletor de tela),
  servidas por `scale-app://local`, tem preload com `contextBridge` minimo; o main
  revalida tudo com zod e confere o frame remetente.
- Navegacao: so a origin configurada; outra origin `https:` abre no navegador do
  sistema; o resto e bloqueado. `<webview>` sempre bloqueado.
- Permissoes: so `media` (apenas audio) e `display-capture` da origin configurada.
  Captura de tela passa pelo seletor proprio (`setDisplayMediaRequestHandler`).
- Erros de TLS nunca sao ignorados (sem handler `certificate-error`).
- Fuses: RunAsNode, NODE_OPTIONS, `--inspect` e privilegios extras de `file://`
  desligados; integridade do asar e OnlyLoadAppFromAsar ligados.
- Logica de seguranca pura em `apps/desktop/src/core/` com testes Vitest.

## Gates Obrigatórios

Antes de considerar qualquer tarefa completa, TODOS os gates devem passar:

```bash
# 1. Lint
npm run lint

# 2. Build
npm run build

# 3. Docker Compose config válido
docker compose config

# 4. Build e up dos containers (quando aplicável)
docker compose up --build -d
```

**Regra:** Se um gate falhar, corrigir e rodar novamente. Sem exceções.

## Segurança

### Autenticação
- JWT em cookie HttpOnly com SameSite=Strict
- Tokens de sala: UUID v4
- TTL de sala temporária: definido na criação

### Participação na sala (room ticket)
- Histórico (`GET /api/rooms/:id/messages`), download (`GET /api/files/:id`) e
  upload (`POST /api/rooms/:id/files`) exigem **participação efetiva**, inclusive
  em sala pública sem senha: só quem fez `join-room` com sucesso ou o **dono**
  (JWT) passa. Sem prova → 403.
- Prova = **room ticket**: JWT HS256 com segredo **derivado** do `JWT_SECRET`
  (HMAC com rótulo próprio — não vale como sessão nem o inverso), `aud`
  `scale:room-ticket`, escopo `{ roomId, sub }` (`u:<userId>` ou
  `g:<guestId>`), validade 12 h. Emitido no ack do `join-room` e no evento
  `room:ticket`; o cliente envia no header `X-Room-Ticket` (nunca em query
  string; redigido nos logs). Ticket `u:` só vale com a sessão do mesmo
  usuário. Ticket `g:` é a identidade do convidado no REST (autoria do upload,
  `isMine` do histórico) — é a mesma do socket que entrou; não é amarrado ao
  cookie porque handshakes simultâneos do primeiro acesso podem gerar cookies
  diferentes. Para convidado, portanto, o ticket é bearer (12 h, só header).
- Senha e convite valem **só** para o `join-room` (balde `roomAuthFail` lá).
- Escolha: ticket stateless em vez de `RoomMember` — não grava no SQLite a cada
  entrada, cobre convidado e logado igual, e não exige limpeza.
- Saiu/foi desconectado: o ticket continua válido até expirar (12 h). Sala
  `ENDED` ou expirada: negado na hora, para todos (inclusive o dono).
- `GET /api/rooms` ("Salas na rede", exige login): só salas públicas ATIVAS,
  com `{ id, name, participantCount, isPersistent, hasPassword }`.

### Convidado (guestId)
- O servidor emite um `guestId` (UUID v4) no cookie `scale_guest` — HttpOnly,
  SameSite=Strict, Secure em produção, 180 dias, assinado (HMAC,
  `GUEST_COOKIE_SECRET`, mínimo 32 caracteres, **obrigatório em produção**: sem
  ele o backend não sobe).
- Emissão automática e única: no handshake do Socket.io (`initial_headers` do
  engine), na mesma resposta que abre o socket — o cookie existe antes de
  qualquer mensagem e o cliente não chama nada. O socket lê e **verifica** a
  assinatura; cookie inválido é ignorado (vira convidado novo, sem autoria).
- Dev (`next dev`, StrictMode monta o socket duas vezes): no PRIMEIRO acesso
  dois handshakes simultâneos podem emitir dois guestIds; vale o do socket que
  ficou. Em produção há um socket por página.
- Autoria de convidado (`chat:edit`, `chat:delete`, `isMine`, upload) é por
  `guestId`; de logado, por `authorId`. O `guestName` (zod 1..40) é só exibição
  e **nunca** concede permissão. Mensagem de convidado sem `guestId` (anterior a
  esta regra): nenhum convidado edita/apaga (o dono da sala ainda apaga).
- O `guestId` nunca sai do servidor nos DTOs públicos.

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
- Sistema de ícones internos: UI sem emojis, `apps/web/src/components/ui/Icon.tsx`
  com 29 ícones (SVG vetorial, `stroke="currentColor"`), sem dependência externa

## Requisitos de Infra

### Docker Compose
- Serviços: backend, proxy, cloudflared (não existe mais container de
  frontend: o web é `output: 'export'`, sem servidor Next)
- `proxy`: imagem própria (`apps/web/Dockerfile`: build estático + Caddy) que
  serve o `out/` do Next e encaminha `/api/*` e `/socket.io/*` → `backend:4000`.
  Aplica CSP (sha256 dos scripts inline gerados no build por
  `apps/web/scripts/csp.mjs`, sem `'unsafe-inline'` em `script-src`), nosniff,
  `Referrer-Policy no-referrer`, `Permissions-Policy` e cache imutável em
  `/_next/static/*`. Links antigos `/room/<id>` → 302 para `/room?id=<id>`.
  Fica atrás do túnel.
- Dev no host (`npm run dev`): `next dev` reescreve `/api` para o backend (só na
  fase de dev) e o socket conecta direto via `NEXT_PUBLIC_DEV_WS_URL`; o build
  de produção usa sempre caminhos relativos no mesmo origin.
- `cloudflared`: túnel rápido (profile `tunnel`) com `--url http://proxy:8080`,
  sem token/conta; gera URL efêmera `*.trycloudflare.com` a cada start.
- Volumes para SQLite persistente
- Health checks para todos os serviços
- Profile `tunnel` para habilitar o túnel cloudflared

### Acesso remoto (tunel)
- Tunel publico via cloudflared (URL efemera `*.trycloudflare.com`)
- Sem necessidade de port forwarding
- Guia de configuração em `docs/tunnel-setup.md`

### Rede e exposicao
- Publicacao (default, endurecida): o `proxy` publica `${PROXY_PORT:-8080}` em
  todas as interfaces (e a entrada do app, usada pelo tunel e pelo navegador
  local); `backend` (`${BACKEND_PORT}`) fica **so no loopback** (`127.0.0.1`).
  Publicado em `0.0.0.0`, `:4100` deixa qualquer host da rede forjar
  `X-Forwarded-For` e furar TODOS os baldes por IP.
  Para acesso direto na LAN, descomente a variante `0.0.0.0` no
  `docker-compose.yml` — ciente de que isso **reintroduz** a superficie.
  - No loopback, `localhost:4100` e seguro (o peer e o gateway, fora do
    `TRUST_PROXY`). O antigo residuo de `localhost:3000` (rewrite `/api` do Next
    repassando `X-Forwarded-For`) deixou de existir junto com o container do
    frontend.
- Túnel rápido `*.trycloudflare.com`: URL efêmera, **sem WAF nem Access** — a
  proteção é autenticação (JWT/cookie) + rate limit por IP real do cliente.
- Modelo de confiança (hops confiáveis, nunca a subnet inteira nem `true`):
  - Backend: `TRUST_PROXY=172.28.0.4/32,172.28.0.5/32` — apenas `proxy`
    (Caddy, único hop HTTP: `/api` e `/socket.io`) e `cloudflared` (hop do
    tunel), cada um com `ipv4_address` fixo na rede `scale`. O gateway
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
