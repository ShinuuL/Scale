# Concord — Design Specification

**Data:** 2026-09-09  
**Status:** v1.0 — Especificação Inicial

---

## 1. Overview

Concord é um sistema de videochamadas P2P (mesh) com sala de voz e tela compartilhada via Tailscale. Projetado para 2-8 participantes, suporta salas temporárias (com TTL) e persistentes, com wizard de onboarding para nova configuração.

### Objetivos
- Comunicação P2P de baixa latência via WebRTC
- Configuração simplificada via Tailscale (rede mesh privada)
- UX limpa e intuitiva com wizard de onboarding
- MCP server para integração com ferramentas externas

### Não-Objetivos
- Gravação de chamadas
- Chat de texto
- Partilha de arquivos
- Suporte a múltiplos dispositivos
- Escalabilidade além de 8 peers

---

## 2. Arquitetura

### Diagrama de Alto Nível

```
┌─────────────────────────────────────────────────────────────┐
│                      Tailscale Mesh                          │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │ Peer 1  │  │ Peer 2  │  │ Peer 3  │  │ Peer N  │       │
│  │(Frontend│  │(Frontend│  │(Frontend│  │(Frontend│       │
│  │   +     │  │   +     │  │   +     │  │   +     │       │
│  │WebRTC)  │  │WebRTC)  │  │WebRTC)  │  │WebRTC)  │       │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘       │
│       │            │            │            │              │
│       └────────────┴────────────┴────────────┘              │
│                          │                                   │
│                   ┌──────┴──────┐                           │
│                   │   Backend   │                           │
│                   │  (Fastify)  │                           │
│                   │  + Socket.io│                           │
│                   └──────┬──────┘                           │
│                          │                                   │
│                   ┌──────┴──────┐                           │
│                   │   SQLite    │                           │
│                   │  (Prisma)   │                           │
│                   └─────────────┘                           │
│                                                             │
│                   ┌─────────────┐                           │
│                   │  MCP Server │ (Docker profile)          │
│                   └─────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### Fluxo de Dados

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Frontend│────▶│  Backend │────▶│ Socket.io│────▶│ WebRTC   │
│ (Next.js)│     │ (Fastify)│     │ Signaling│     │ (P2P)    │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
     │                │                │                │
     │                │                │                │
     └────────────────┴────────────────┴────────────────┘
                          │
                   ┌──────┴──────┐
                   │   SQLite    │
                   │  (Prisma)   │
                   └─────────────┘
```

---

## 3. Componentes

### 3.1 Frontend (Next.js 15 App Router)

**Responsabilidades:**
- Interface do usuário (UI/UX)
- Gerenciamento de estado da sala
- Captura de mídia (áudio/vídeo/tela)
- Conexão WebRTC
- Integração com Socket.io para signaling

**Rotas Principais:**
```
/                     — Landing page / wizard
/room/[id]           — Sala de chamada
/room/[id]/settings  — Configurações da sala
```

**Componentes Chave:**
- `Room` — Container principal da sala
- `VideoGrid` — Grid de vídeos dos participantes
- `Controls` — Botões de mute/camera/screenshare
- `OnboardingWizard` — Setup inicial via Tailscale
- `RoomCreator` — Criação de sala (temp/persis)

### 3.2 Backend (Fastify 5 + Socket.io 4)

**Responsabilidades:**
- REST API para CRUD de salas
- WebSocket signaling para WebRTC
- Autenticação JWT
- Rate limiting
- Validação Zod

**Endpoints:**
```
POST   /api/rooms          — Criar sala
GET    /api/rooms/:id      — Detalhes da sala
DELETE /api/rooms/:id      — Encerrar sala (owner/admin)
POST   /api/auth/login     — Autenticação (simplificada)
GET    /api/health         — Health check
```

**Eventos Socket.io:**
```
join-room      — Participante entra na sala
leave-room     — Participante sai da sala
offer          — WebRTC offer
answer         — WebRTC answer
ice-candidate  — ICE candidate
screen-share   — Toggle screen sharing
```

### 3.3 MCP Server (Docker Profile)

**Responsabilidades:**
- Consulta de estado das salas
- Autenticação via token
- Integração com ferramentas externas

**Endpoints:**
```
GET /mcp/rooms              — Listar salas ativas
GET /mcp/rooms/:id          — Estado da sala
POST /mcp/rooms/:id/kick   — Remover participante (admin)
```

---

## 4. Data Flow

### 4.1 Criar Sala

```
1. Usuário inicia wizard → seleciona "Criar Sala"
2. Frontend → POST /api/rooms {type: "temporary"|"persistent", ttl?: number}
3. Backend → Valida JWT → Cria sala no SQLite → Retorna room ID
4. Frontend → Redireciona para /room/[id]
5. Socket.io → join-room (usuário entra na sala)
```

### 4.2 Join Sala

```
1. Usuário acessa link da sala → /room/[id]
2. Frontend → GET /api/rooms/:id (verifica existência/autorização)
3. Socket.io → join-room
4. Backend → Broadcast para participantes existentes
5. Peer discovery via Socket.io → Inicia WebRTC handshake
```

### 4.3 WebRTC Signaling

```
┌─────────┐                    ┌─────────┐
│ Peer A  │                    │ Peer B  │
└────┬────┘                    └────┬────┘
     │                              │
     │  1. ICE Candidates           │
     │  (via Socket.io)             │
     │──────────────────────────────▶
     │                              │
     │  2. WebRTC Offer             │
     │  (via Socket.io)             │
     │──────────────────────────────▶
     │                              │
     │  3. WebRTC Answer            │
     │  (via Socket.io)             │
     │◀──────────────────────────────
     │                              │
     │  4. ICE Candidates           │
     │  (via Socket.io)             │
     │◀──────────────────────────────
     │                              │
     │  5. P2P Media Stream         │
     │  (via WebRTC)                │
     │◀═════════════════════════════▶
     │                              │
```

### 4.4 Screen Sharing

```
1. Usuário clica "Share Screen"
2. Frontend → navigator.mediaDevices.getDisplayMedia()
3. Frontend → Adiciona track ao PeerConnection existente
4. Backend → Broadcast screen-share event
5. Outros peers → Atualizam grid para mostrar tela compartilhada
```

---

## 5. Segurança

### 5.1 Autenticação
- JWT em cookie HttpOnly com SameSite=Strict
- Tokens de sala: UUID v4
- TTL de sala temporária: definido na criação
- Sem autenticação por enquanto (simplificada para MVP)

### 5.2 Validação
- **Zod** em todos os inputs (frontend e backend)
- Validação server-side obrigatória
- Rate limiting: máximo 30 mensagens/segundo por conexão

### 5.3 Rede
- CORS: whitelist de origens permitidas
- Content Security Policy (CSP) habilitada
- Tailscale: rede mesh privada, sem exposição pública

### 5.4 WebRTC
- TURN server: opcional (configurável)
- STUN público: `stun:stun.l.google.com:19302`
- ICE candidates: coletar e trocar via signaling

---

## 6. Docker / Tailscale / MCP

### 6.1 Docker Compose
```yaml
services:
  frontend:
    build: ./frontend
    ports:
      - "3000:3000"
    depends_on:
      backend:
        condition: service_healthy
    volumes:
      - ./frontend:/app
      - /app/node_modules

  backend:
    build: ./backend
    ports:
      - "4000:4000"
    volumes:
      - ./backend:/app
      - /app/node_modules
      - sqlite-data:/app/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  mcp:
    build: ./mcp
    profiles: ["mcp"]
    ports:
      - "4001:4001"
    environment:
      - MCP_TOKEN=${MCP_TOKEN}

volumes:
  sqlite-data:
```

### 6.2 Tailscale
- Rede mesh privada entre dispositivos
- Sem necessidade de port forwarding
- Guia de configuração: `docs/tailscale-setup.md`
- Todos os peers na mesma rede Tailscale

### 6.3 MCP Server
- Endpoints para consulta de estado das salas
- Autenticação via token Bearer
- Integração com ferramentas externas
- Profile `mcp` no Docker Compose

---

## 7. Onboarding Wizard

### Passos do Wizard

```
┌─────────────────┐
│ 1. Boas-vindas  │
│    Instalar     │
│   Tailscale?    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 2. Configurar   │
│   Dispositivo   │
│   (Tailscale)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 3. Criar/Join   │
│     Sala        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 4. Testar       │
│   Mídia         │
│   (Audio/Video) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ 5. Iniciar      │
│   Chamada       │
└─────────────────┘
```

### Lógica do Wizard
- Salvar progresso no localStorage
- Pular etapas opcionais (ex: Tailscale já instalado)
- Validação em cada etapa antes de avançar
- Possibilidade de voltar a qualquer etapa

---

## 8. Testes

### 8.1 Unit/Integration (Vitest)
- Componentes React (frontend)
- API endpoints (backend)
- Prisma queries
- Zod schemas
- Socket.io handlers

### 8.2 End-to-End (Playwright)
- Fluxo completo de criação de sala
- WebRTC connection test
- Screen sharing flow
- Rate limiting behavior
- Error handling

### 8.3 Cobertura Mínima
- 80% code coverage em unit tests
- 100% coverage em critical paths (auth, room creation, signaling)

### 8.4 Gates de Verificação
```bash
# Todos devem passar antes de commit
npm run lint
npm run build
docker compose config --profile mcp
docker compose --profile mcp up --build --abort-on-container-exit
```

---

## 9. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|-------|---------|-----------|
| WebRTC nat traversal falha | Alto | TURN server como fallback, testes em diferentes redes |
| Tailscale config complexo | Médio | Wizard guiado, documentação clara, validação em tempo real |
| Limitação 8 peers | Baixo | Design escalável para futuro, documentar limitação |
| SQLite concorrência | Médio | WAL mode, pragmas otimizados, testes de carga |
| Browser compatibility | Médio | Polyfills WebRTC, testes cross-browser, fallback graceful |
| Security vulnerabilities | Alto | OWASP checklist, code review, dependency scanning |

---

## 10. Critérios de Aceite por Etapa

### Etapa 1: Fundação
- [ ] Next.js 15 App Router configurado
- [ ] Fastify 5 + Socket.io 4 configurado
- [ ] Prisma 6 + SQLite funcionando
- [ ] Docker Compose com health checks
- [ ] ESLint + Prettier configurados
- [ ] Estrutura de pastas conforme AGENTS.md

### Etapa 2: Backend
- [ ] CRUD de salas (create, read, delete)
- [ ] Rate limiting implementado (30msg/s)
- [ ] JWT auth simplificado (cookie)
- [ ] Validação Zod em todos os inputs
- [ ] Socket.io signaling (join/leave/offer/answer)
- [ ] Health check endpoint

### Etapa 3: Frontend
- [ ] Wizard de onboarding (5 passos)
- [ ] Criação de sala (temp/persis)
- [ ] Join sala via link
- [ ] Grid de vídeo funcional
- [ ] Controles (mute/camera/screenshare)
- [ ] Responsividade mobile

### Etapa 4: WebRTC
- [ ] Peer discovery via Socket.io
- [ ] ICE candidates exchange
- [ ] P2P audio/video streaming
- [ ] Screen sharing funcional
- [ ] Fallback graceful (TURN opcional)

### Etapa 5: Tailscale
- [ ] Guia de setup completo
- [ ] Validação de conexão
- [ ] Testes em rede mesh
- [ ] Troubleshooting documentado

### Etapa 6: MCP Server
- [ ] Endpoints de consulta
- [ ] Autenticação via token
- [ ] Integração testada
- [ ] Documentação da API

### Etapa 7: Qualidade
- [ ] 80% coverage unit tests
- [ ] E2E tests passando
- [ ] Todos os gates verificados
- [ ] Documentation atualizada
- [ ] Performance audit (Lighthouse > 90)

### Etapa 8: Release
- [ ] Deploy staging testado
- [ ] Monitoring configurado
- [ ] Rollback plan documentado
- [ ] Release notes preparadas

---

**Próximos Passos:**
1. Implementar Etapa 1 (Fundação)
2. Configurar CI/CD com gates obrigatórios
3. Configurar testes automatizados

---

**Última atualização:** 2026-09-09
