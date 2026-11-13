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
- Primitivos interativos: `react-aria-components` (menu de perfil, diálogos,
  seletores, tema) e `@floating-ui/react-dom` (`ui/Tooltip.tsx`), ambos
  com versão exata. Links do react-aria navegam pelo roteador do Next via
  `components/AriaRouter.tsx` (sem recarregar a página: a chamada não cai).
  Estados de animação pelo atributo: `data-[entering]:`, `data-[focused]:`.
  Modal novo usa `components/ui/AppModal.tsx` (título, fechar, foco, Esc,
  clique fora, `locked` enquanto salva). Botão que precisa de dica quando
  inativo usa `aria-disabled`, não `disabled` (desabilitado não recebe ponteiro).
- Chamada persistente: a sessão da sala vive no `RoomHost` do layout raiz;
  fora de `/room` a tela fica oculta e a `MiniCallBar` mostra a chamada.

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
- Permissoes: `media` (apenas audio), `display-capture` e `speaker-selection`
  da origin configurada; selecao de saida somente no frame principal.
  `notifications` exige frame principal, confirmacao nativa explicita e
  consentimento por origin valido somente na sessao atual.
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
- Logoff: `POST /api/auth/logout` expira o cookie `token` (mesmos atributos da
  criação; 204, idempotente). Menu de perfil > "Sair da conta"; em chamada pede
  confirmação e encerra a chamada (`scale:end-call`). JWT é stateless: o logoff
  encerra o navegador atual, não revoga cópias do token.
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

### Login com GitHub (OAuth App)
- Opcional: liga com `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` e `PUBLIC_URL`
  (callback `<PUBLIC_URL>/api/auth/github/callback`). Sem os três, o botão some
  (`GET /api/auth/providers`) e as rotas mandam para `/login?github=desligado`.
- `state` anti-CSRF em cookie HttpOnly `SameSite=Lax` (o callback é navegação
  vinda do github.com), `__Host-` em produção (site irmão não planta cookie),
  uso único, 10 min. `code`/`state` são redigidos nos logs.
- Escopos `read:user user:email`; o access token não é gravado.
- Conta: regras comuns em "Contas vinculadas" abaixo; e-mail usado é o
  primário **verificado** do GitHub.
- Balde `githubOAuth`: 20 / 10 min por IP; criação também conta no `register`.
- Erros voltam como `/login?github=<cancelado|falhou|outra_conta|sem_email|limite|desligado>`.

### Login com Google (OAuth/OIDC)
- Opcional: liga com `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `PUBLIC_URL`
  (callback `<PUBLIC_URL>/api/auth/google/callback`). `GET /api/auth/providers`
  devolve `{ github, google }`.
- Mesmo desenho do GitHub: `state` em cookie HttpOnly `SameSite=Lax`
  (`__Host-` em produção), uso único, 10 min; escopos `openid email profile`;
  access token descartado; balde `googleOAuth` 20 / 10 min por IP.
- Conta: vínculo pelo `sub` (tabela `GoogleAccount`); e-mail só com
  `email_verified`. Regras comuns em "Contas vinculadas".
- Erros: `/login?google=<cancelado|falhou|outra_conta|sem_email|limite|desligado>`.

### Contas vinculadas (GitHub e Google)
- Rotas numa fábrica só: `apps/server/src/routes/oauthAuth.ts`; regras de conta
  em `apps/server/src/lib/oauthAccount.ts`.
- Login: id do provedor já vinculado → entra. Senão, e-mail **verificado** pelo
  provedor que já existe → **vincula automaticamente** e entra (decisão de
  produto; fica no log). Se essa conta já tem OUTRA conta do mesmo provedor →
  `outra_conta`. Senão cria a conta.
  - Risco aceito: o cadastro por senha não confirma e-mail; quem tivesse
    pré-cadastrado o e-mail de outra pessoa continuaria entrando com a senha.
- Vínculo pela sessão (Configurações > Contas vinculadas, vale para e-mail
  diferente): `GET /api/auth/<p>/link` (logado) → provedor → callback →
  `/?vinculo=<p>.<ok|outra_conta|ja_vinculado|cancelado|falhou|limite>`.
  Como o cookie de sessão é `SameSite=Strict` e não vem na volta do provedor,
  a intenção `state → userId` fica **na memória do servidor** (10 min, uso
  único), nunca em cookie editável. Vincular não troca a sessão.
- `GET /api/me/links` (logado): `{ github: { login } | null, google }`.

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

### Moderação, LGPD e gate de partilha de tela
- Guia operacional: `docs/moderacao.md`. Base legal, LIA, ROPA e direitos do
  titular: `docs/lgpd-moderacao.md`. Spec:
  `docs/superpowers/specs/2026-11-11-moderacao-assistente-design.md`.
- **Áudio e tela são P2P**: o servidor nunca recebe mídia. Áudio **não é
  monitorado** (só denúncia e dono da sala); mudar isso exigiria SFU +
  consentimento específico de todos. Chat de sala, edição e DM passam pelo
  servidor e são moderados **antes** de persistir/retransmitir.
- Provedores (`MODERATION_PROVIDER`): `off`, `heuristic` (default, lista PT-BR
  local, nada sai do servidor) e `claude` (Claude API, `MODERATION_MODEL`
  default `claude-opus-5-5`, `claude-haiku-5-5` é a opção barata; texto e
  imagem **saem** do servidor → transferência internacional, art. 33 LGPD:
  declarar em `/privacy` e formalizar DPA). Só a mensagem (até 2000 chars) ou
  só o quadro vai ao provedor: sem nome, e-mail, ids, sala ou histórico.
  Falha/timeout = **fail-open com log** (`reason: 'provider_error'`).
  `ANTHROPIC_API_KEY` só no `.env` (nunca no compose, nunca em log); em
  produção com `claude` sem chave o backend recusa subir.
- Texto: `severity high` bloqueia (ack `{ code: 'MODERATED', category }`) e
  grava `ModerationEvent`; `medium` entrega, grava e emite
  `moderation:warning` só ao autor; `low`/`none` nada.
- Tela: só com `MODERATION_SCREEN=true` + `claude` (o cliente lê
  `GET /api/moderation/config`). O sharer envia `POST
  /api/rooms/:roomId/moderation/frame` (multipart JPEG ≤ 200 KB, ≤ 480 px,
  header `X-Room-Ticket`) a cada `MODERATION_FRAME_INTERVAL_SEC` (default
  20). Balde `moderationFrame`: 6 / min por sujeito do ticket. A rota responde
  `204` sempre (sem oráculo); o veredito vai por socket: `high` →
  `moderation:action { action: 'stop-screen-share', by: 'assistant' }` ao
  sharer e `moderation:notice { kind: 'frame' }` ao dono; `medium` →
  `moderation:warning`. O quadro é classificado em memória e **descartado**:
  nunca persiste, nunca é logado.
- Denúncia: `moderation:report { roomId, targetPeerId, reason, details? ≤ 300 }`
  (socket, dentro da sala) grava `ModerationEvent` (kind `report`) e notifica
  o dono (`moderation:notice`). Balde `moderationReport`: 10 / 10 min por
  socket. Dono: `moderation:stop-share { roomId, targetPeerId }` →
  `moderation:action { by: 'owner' }` ao alvo.
- `GET /api/moderation/config` (público): `{ provider, screen, minAge,
  consentVersion, frameIntervalSec, privacyContactEmail }`.
- Gate de partilha de tela (enforcement no servidor): **convidado não
  compartilha**. Logado precisa de idade ≥ `SCREEN_SHARE_MIN_AGE` (default 18,
  de `birthDate`) **e** consentimento com `screenShareConsentVersion ===
  SCREEN_SHARE_CONSENT_VERSION` (`@scale/shared`, hoje `'2026-11'`; mudar o
  termo = mudar a versão = pedir de novo). `signal:screen-share-state` com
  `isScreenSharing: true` é recusado com `{ code: 'SCREEN_SHARE_NOT_ALLOWED',
  reason: 'guest'|'age'|'consent' }`. O estado é lido no `join-room` para
  `socket.data.screenShare`; após `PUT`/`DELETE` o servidor emite
  `me:screen-share` aos sockets em `user:<userId>`.
- REST (logado, balde `profile`): `PUT /api/me/age { birthDate }` (futura,
  > 120 anos ou formato inválido = 400), `PUT /api/me/screen-share-consent
  { version }`, `DELETE` em ambos (revogação), `GET /api/me/privacy/export`
  (perfil, flags e eventos de moderação próprios). `/api/auth/me` e demais
  `meSelect` devolvem `screenShare: { ageVerified, isAdult, consentVersion,
  allowed, reason }`.
- Nunca sai em DTO: `birthDate` (só `isAdult`), `guestId`, `excerpt` de
  terceiros, quadro de tela, chave de API.
- Retenção: `ModerationEvent` apagado após `MODERATION_RETENTION_DAYS`
  (default 90) pelo sweep de salas; `excerpt` ≤ 120 chars (frame: sempre
  `null`); `birthDate`/consentimento até revogação ou exclusão da conta
  (cascade).
- Bases legais: idade = art. 7, II e V; consentimento de partilha = art. 7, I;
  moderação e denúncia = art. 7, IX (LIA em `docs/lgpd-moderacao.md`);
  amostragem de tela = IX + I. Verificação de idade é **autodeclarada** (sem
  documento, limitação explícita). Encarregado: `PRIVACY_CONTACT_EMAIL` (env,
  exibido em `/privacy`; nunca hardcodar e-mail real).
- Env (todas repassadas pelo compose com `${VAR:-default}`):
  `MODERATION_PROVIDER`, `MODERATION_MODEL`, `ANTHROPIC_API_KEY`,
  `MODERATION_SCREEN`, `MODERATION_FRAME_INTERVAL_SEC` (10..120),
  `MODERATION_RETENTION_DAYS` (1..365), `SCREEN_SHARE_MIN_AGE` (13..21),
  `PRIVACY_CONTACT_EMAIL`.
- Painel de admin (`/admin/moderation`, só `isAdmin` em `/api/auth/me`):
  `GET|PUT /api/admin/moderation`, `DELETE /api/admin/moderation/api-key`,
  `POST /api/admin/moderation/test`, `GET /api/admin/moderation/audit`
  (não-admin = 403; balde `adminSettings` 30 / 10 min por usuário).
  Override no banco > `.env`, campo a campo; `null` volta ao `.env`. Toda
  mudança vai para `ModerationAuditLog` e emite `moderation:config`.
- Administradores (guia `docs/administracao.md`): papel **raiz** (`env`, e-mail
  em `ADMIN_EMAILS`/`METRICS_ADMIN_EMAILS`, só sai pelo `.env`) ou
  **concedido** (`db`, tabela `AdminGrant`). `GET /api/auth/me` devolve
  `isAdmin` e `adminSource: 'env'|'db'|null`. Rotas (só admin, balde
  `adminSettings`): `GET /api/admin/users?q=&filter=all|admins&cursor=&limit=`
  (e-mail mascarado), `PUT|DELETE /api/admin/users/:userId/admin` (409
  `env_admin`, 400 `cannot_revoke_self`), `GET /api/admin/users/audit`
  (`AdminRoleAudit`). Após grant/revoke o servidor emite `me:admin`
  `{ isAdmin, adminSource }` em `user:<targetId>`; o front atualiza o usuário
  em memória (`useSocket`/`useUserEvents`) sem recarregar.
- Telas: hub `/admin` (Moderação, Métricas, Administradores), menu de perfil
  "Administração" abre `/admin`; Configurações tem seção "Administração" (só
  admin). Guarda única: `components/admin/useAdminGuard.ts`.
- Chave de API do painel: AES-256-GCM com chave derivada do `JWT_SECRET`
  (HMAC, rótulo `scale:settings-key:v1`); nunca em DTO/log. Trocar o
  `JWT_SECRET` exige recadastrar a chave.
- **Não existe modo oculto**: toda configuração efetiva é exibida em
  `/privacy` e no termo de partilha de tela.

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
- Anexos em mensagem privada (DM) — planejado
- Escalabilidade além de 8 peers

### Já incluído (implementado e testado)
- Chat de texto em sala (persistente e temporária) com menções `@`, edição
  (janela de 15 min) e exclusão pelo autor
- Partilha de arquivos no chat: até 5 por mensagem, 250 MB por arquivo,
  allowlist de MIME (`image/*`, `application/pdf`, `text/plain`, `audio/*`,
  `application/zip`), validação por magic bytes e quota de 2 GB por sala
  (`ROOM_FILE_QUOTA_BYTES`). O upload grava por **stream** direto no disco
  (nunca o arquivo inteiro na memória); recusa no meio apaga o que já foi
  gravado. Soma da quota em SQL cru (64 bits: passa de 2^31).
  - Pelo túnel `*.trycloudflare.com` a Cloudflare corta requisições acima de
    100 MB (limite do plano gratuito): arquivos maiores só sobem pelo acesso
    direto ao proxy (localhost/LAN)
- Upload bloqueado em sala temporária (apenas persistente aceita arquivos)
- Imagens nos canais de texto da comunidade: mesma rota `POST /api/rooms/:id/files`
  (até 5 por mensagem, quota da sala). No canal de texto ser **membro** é a prova
  de participação (não há `join-room`); só `image/*` é aceito. A mensagem sai
  como `channel:message` para a comunidade, com `files` no DTO.
- Cargos personalizados de comunidade (tabela `CommunityCustomRole`, até 20):
  nome, cor e permissões (`manageChannels`, `manageInvites`, `manageMessages`,
  `kickMembers`). Um por membro (`CommunityMember.customRoleId`, anulável).
  Só **somam** ao cargo base (OWNER/ADMIN já têm tudo); expulsar ADMIN segue
  exclusivo do OWNER. Só o OWNER cria, edita, apaga e atribui. Rotas checam
  `permissionsOf()` (`lib/communityAccess.ts`). A cor pinta o nome no chat.
- Sistema de ícones internos: UI sem emojis, `apps/web/src/components/ui/Icon.tsx`
  com 38 ícones (SVG vetorial, `stroke="currentColor"`), sem dependência externa
- Configurações (menu de perfil, ícone `settings`): nome de usuário
  (`PATCH /api/me`, reemite o JWT), foto de perfil (`PUT|GET|DELETE
  /api/me/avatar`, até 32 MB, PNG/JPEG/WebP por magic bytes, em
  `uploads/avatars`) e tema. Balde `profile`: 20 / 10 min por usuário
- Amizades e mensagens privadas (página `/friends`, só logado):
  - @nome único (`PUT /api/me/username`, `[a-z0-9_]` 3..20, minúsculo) na
    tabela `Username` — tabela própria porque o `prisma db push` do container
    recusa `@unique` novo em tabela existente sem `--accept-data-loss`.
  - Pedido pelo @nome (`POST /api/friends/requests`; pedido cruzado vira
    aceite), aceitar/recusar/cancelar, desfazer amizade. Balde
    `friendRequest`: 30 / hora por usuário.
  - DM só texto, só entre amigos (`GET|POST /api/dm/:userId/messages`, até
    2000 caracteres, paginado por `before`). Balde `dm`: 20 / 10 s por
    usuário. Anexos ficam para depois, em tabela própria.
  - Tempo real: socket logado entra em `user:<userId>`; eventos
    `friends:changed` e `dm:message`. DTO público sem e-mail.
  - Foto de amigo: `GET /api/users/:userId/avatar` (amigo ou si mesmo; sem
    amizade = 404 igual a "sem foto")
- Comunidades, presença e indicadores de voz: `community:presence`
  (online = algum socket logado; estado inicial em `onlineUserIds` do ack de
  `community:subscribe`), lista "Online — N"/"Offline — N"; membros da voz com
  `muted`/`deafened`/`screenSharing` e `community:voice-speaking` (cliente manda
  `peer:voice-flags`, "falando" só em transições, no máximo 1 a cada 400 ms)
- Não lidas em comunidades: tabela `ChannelReadState`, contagem por canal (teto 100, "99+") em `GET /api/communities[/:id]`, `POST /api/channels/:id/read` e `/api/communities/:id/read`; outras comunidades via evento leve `community:activity` em `user:<id>` + recarga ao focar
- Foto na chamada (cartões do canal de voz): a própria via `/api/me/avatar`; a
  dos outros via `GET /api/rooms/:roomId/peers/:peerId/avatar` — exige room
  ticket (ou dono) e só serve peer logado que está NA sala agora. O `userId`
  continua sem trafegar (o cliente só conhece o `peerId`). Convidado, peer fora
  da sala ou sem foto = mesmo 404. O cliente busca com o ticket no header e usa
  URL `blob:`; sem foto, a inicial do nome.
- Assistente de moderação (chat, DM, tela e denúncia) com provedores `off` /
  `heuristic` / `claude`, eventos `moderation:*`, `ModerationEvent` com
  retenção configurável e `GET /api/moderation/config`. Regras em "Moderação,
  LGPD e gate de partilha de tela".
- Gate de partilha de tela no servidor: convidado não compartilha; logado
  precisa de idade mínima autodeclarada (`PUT /api/me/age`) e termo versionado
  (`PUT /api/me/screen-share-consent`), ambos revogáveis por `DELETE`;
  `ScreenShareGateDialog` no cliente, confirmação curta a cada partilha.
- LGPD: página `/privacy` (encarregado via `PRIVACY_CONTACT_EMAIL`),
  `GET /api/me/privacy/export`, `docs/lgpd-moderacao.md` (inventário, LIA,
  ROPA, checklist) e `docs/moderacao.md` (operação e custos).

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

### Produção (VPS)
- `https://scale.nexushosts.tech:8443`. Overlay `docker-compose.prod.yml` +
  `deploy/`. Guia e comandos de atualização: `docs/vps-deploy.md`.
- VPS compartilhada: 80/443 são do Nexus. O Scale tem Caddy próprio (`edge`,
  `172.28.0.6`) na 8443, com TLS por DNS-01 delegado ao acme-dns.
- Produção = commit: atualizar só com `deploy/enviar.ps1` (recusa árvore suja).

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
**Última atualização:** 2026-11-11
