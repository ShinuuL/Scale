# Plano — Comunidades (web + servidor) e desktop nativo em Rust

Data: 2026-11-09. Decisões do Arlindo:

- Desktop **nativo em Rust** (UI própria, não webview), instalável no Windows e no Linux.
- Comunidades são uma **camada nova**: as salas soltas (temporária, link, convidado) continuam como estão.
- Visual: **layout do Discord com a marca Scale** (trilho de comunidades, lista de canais,
  chat no centro, membros à direita), mantendo as cores azul-violeta e os ícones SVG próprios.
- O Electron (`apps/desktop`) continua até o nativo ter voz validada no Windows e no Linux.

Isso muda o `PRODUCT.md`, que dizia para não inventar comunidades nem canais. A
seção "Fatos e limites" passa a citar comunidades.

## Fase 1 — Servidor: comunidades, canais e convites

### Modelo (Prisma, só tabelas e colunas novas e anuláveis, por causa do `db push`)

- `Community { id uuid, name 1..50, ownerId → User, createdAt }`
- `CommunityMember { id, communityId, userId, role OWNER|ADMIN|MEMBER, joinedAt, @@unique(communityId, userId) }`
- `CommunityInvite { id uuid, communityId, codeHash unique (SHA-256 hex), createdById, expiresAt, maxUses?, uses, revokedAt?, createdAt }`
- `Room` ganha `communityId String?` (FK cascade), `channelKind String?` (`TEXT`|`VOICE`), `position Int @default(0)`.
  Canal = `Room` com `communityId` preenchido, `isPersistent=true`, `isPrivate=true`, `expiresAt=null`.
  Assim o chat persistente, os arquivos e o ticket existentes servem aos canais.

### Convite (padrão Vigia `tokens-uso-unico`, adaptado ao estilo Discord)

- Código: 16 bytes de `crypto.randomBytes`, base64url (22 caracteres). No banco, só o hash SHA-256.
  O código aparece **uma vez**, na resposta de criação.
- Validade: 1 h, 24 h ou 7 dias (padrão 7 dias, teto 7 dias). `maxUses` opcional (1..100).
- Multiuso, sem amarração a e-mail. Exceção ao padrão, justificada: é o comportamento de
  convite de comunidade pedido; o risco fica limitado pela validade de 7 dias, pela revogação e pelo `maxUses`.
- Aceite atômico: `updateMany where { codeHash, revokedAt: null, expiresAt > now, (maxUses null ou uses < maxUses) } data { uses: increment 1 }`;
  só segue com `count === 1`, e a criação do membro fica na mesma transação. Quem já é membro recebe 200 sem consumir uso.
- Rate limit por IP na prévia e no aceite (balde novo `communityInvite`: 30 / 10 min) contra enumeração.
- Link do convite: `/invite#<código>`. O código no fragmento não vai para logs nem para o Referer; a página o envia por POST.

### Permissões

| Ação | OWNER | ADMIN | MEMBER |
|---|---|---|---|
| Ver comunidade, canais, membros, histórico; falar no texto; entrar na voz | sim | sim | sim |
| Criar convite | sim | sim | sim |
| Listar e revogar convites; criar, renomear e apagar canal; expulsar MEMBER | sim | sim | não |
| Expulsar ADMIN; mudar cargo; renomear e apagar comunidade | sim | não | não |
| Sair da comunidade | não (apaga ou transfere) | sim | sim |

Não membro recebe **404** (não revela se a comunidade existe). Limites em `@scale/shared/limits`:
`COMMUNITY_NAME_MAX=50`, `CHANNEL_NAME_MAX=40`, `MAX_COMMUNITIES_OWNED=10`,
`MAX_CHANNELS_PER_COMMUNITY=50`, `MAX_COMMUNITY_MEMBERS=500`, `MAX_COMMUNITIES_JOINED=100`.

### REST (todas exigem login)

- `POST /api/communities {name}`: cria a comunidade, o OWNER e os canais padrão "geral" (TEXT) e "Sala de voz" (VOICE).
- `GET /api/communities`: minhas comunidades `{id, name, role}`.
- `GET /api/communities/:id`: `{community:{id,name,ownerId}, myRole, channels:[{id,name,kind,position}], members:[{userId,name,username|null,role}]}`.
- `PATCH /api/communities/:id {name}` (OWNER); `DELETE /api/communities/:id` (OWNER, emite `community:deleted` e despeja sockets dos canais).
- `POST /api/communities/:id/leave`.
- `DELETE /api/communities/:id/members/:userId` (expulsar); `PATCH /api/communities/:id/members/:userId {role: ADMIN|MEMBER}` (OWNER).
- `POST /api/communities/:id/channels {name, kind}`; `PATCH /api/channels/:id {name}`; `DELETE /api/channels/:id`.
- `GET /api/channels/:id/messages?cursor&limit` e `POST /api/channels/:id/messages {content}`:
  chat de canal de TEXTO, sem `join-room`. O DTO tem autor visível: `{id, channelId, author:{id,name,username|null}, content, createdAt, editedAt, deletedAt}`.
  O conteúdo segue `CHAT_MESSAGE_MAX` e o rate limit de chat existente, por usuário.
- `POST /api/communities/:id/invites {expiresIn: '1h'|'24h'|'7d', maxUses?}` → `{invite:{id, code, expiresAt, maxUses}}`.
- `GET /api/communities/:id/invites` (ADMIN+, sem código); `DELETE /api/invites/:id` (ADMIN+ ou o criador).
- `POST /api/invites/preview {code}` → `{community:{id,name,memberCount}, alreadyMember}`; `POST /api/invites/accept {code}` → `{communityId}`.
- CORS ganha `PATCH` e `PUT` em `methods`.

### Socket

- `community:subscribe {communityId}` (ack): confere a membership e entra na sala do socket `community:<id>`.
  Recebe `channel:message`, `channel:message-edit`, `channel:message-delete`, `community:changed`,
  `community:deleted`, `community:voice-state {channelId, members:[{userId,name}]}`.
  O ack devolve o estado inicial: `{success:true, voiceStates:[{channelId, members:[{userId,name}]}]}`
  (todos os canais de voz com alguém dentro).
- Edição e exclusão de mensagem de canal (REST, mesmas regras do chat de sala):
  `PATCH /api/channels/:id/messages/:messageId {content}` (só o autor, mesma janela de edição do chat de sala)
  e `DELETE /api/channels/:id/messages/:messageId` (autor ou ADMIN+, soft delete). Emitem em `community:<id>`:
  `channel:message-edit {channelId, messageId, content, editedAt}` e `channel:message-delete {channelId, messageId, deletedAt}`.
  DTOs desses eventos e do ack em `packages/shared/src/communities.ts`.
- `community:unsubscribe {communityId}`.
- Expulsão ou saída: o servidor tira os sockets do usuário de `community:<id>` e dos canais de voz, e emite `community:removed` na sala pessoal.
- `join-room` com `room.communityId`: exige usuário logado e membro; ignora convite e senha;
  canal TEXT recusa (`Not a voice channel`). Entrar ou sair emite `community:voice-state`.
- `roomParticipant` (histórico, arquivos, TURN): em sala de comunidade, além do ticket, confere a membership atual (expulso perde acesso na hora).
- `GET /api/rooms/:id`, `rotate-invite` e `DELETE /api/rooms/:id`: sala de comunidade responde 404 (gerida pelas rotas de canal).

### Testes (Vitest, padrão `social.test.ts`)

Criação com canais padrão; não membro recebe 404; convite expirado, revogado ou no limite de usos falha;
aceite concorrente não passa de `maxUses`; já membro não consome uso; código não aparece em listagem nem no banco;
matriz de permissões; expulso perde `join-room`, histórico e socket; TEXT recusa `join-room`; `voice-state` em entrada e saída.

## Fase 2 — Web: layout de comunidades

- Rota `/communities?c=<id>&ch=<channelId>` (export estático, query string como `/room`) e `/invite` (lê `#código`, mostra prévia e aceita; sem login vai para `/login?next=`).
- `AppShell` ganha a seção "Comunidades".
- Layout de 4 colunas: trilho de comunidades (iniciais em quadrado arredondado, `+` criar, entrar por convite);
  canais (texto com ícone `#` em SVG, voz com alto-falante e quem está nela); chat do canal; membros por cargo.
  Abaixo de 1024px, canais e membros vão para gavetas, como hoje.
- Canal de voz abre `/room?id=<roomId>&c=<communityId>` (a chamada continua na página da sala, que ganha "Voltar à comunidade").
- Menus: convidar (gera o link e copia), configurações da comunidade (renomear, canais, convites, membros e cargos), sair.
- Tokens de `globals.css` / `DESIGN.md`; ícones novos em `Icon.tsx`; sem emoji e sem biblioteca nova. Revisão `revisor-motion` antes de entregar.

## Fase 3 — Desktop nativo Rust (`apps/desktop-native`, crate `scale-desktop`)

Stack: `eframe/egui` (UI), `tokio`, `reqwest` (rustls), cliente Socket.IO v4 sobre `tokio-tungstenite`
(Engine.IO 4, só websocket), `keyring` (token), `serde`. Pacote: `cargo-packager` →
`.msi`/NSIS no Windows, `.deb`/AppImage no Linux. Build Windows pelo GitHub Actions (`windows-latest`) ou `cargo-xwin`.

- **R1 — texto:** tela "Conectar ao servidor" (origin https, ou http só para localhost) + login por e-mail/senha
  (o JWT sai do `Set-Cookie token=` e vai para o keyring; REST com `Authorization: Bearer`, socket com `auth.token`),
  layout Discord, comunidades, canais de texto em tempo real, convites (aceitar e gerar), membros, DMs, instaladores.
- **R2 — voz:** `webrtc` (webrtc-rs) + `cpal` + Opus, mesh compatível com o navegador. Regras de iniciativa idênticas:
  `myId < remoteId` oferece e é o polite; answerer sem transceiver prévio; fmtp Opus do web; TURN de `room:ice-servers`
  e `/api/turn/credentials`; renegociação e ICE restart.
- **R3 — assistir tela:** decodificar VP8 do transceiver de vídeo e mostrar a textura no egui.
- **R4 — compartilhar tela:** captura (`xcap`) + encoder VP8, transceiver `sendonly` e `signal:screen-share-state`.

Riscos: interoperabilidade do webrtc-rs com o Chrome (glare/rollback limitado), echo cancellation fora do navegador
(o webrtc-rs não tem AEC; avaliar `webrtc-audio-processing`), captura de tela no Wayland (exige portal),
login OAuth fica fora do nativo na R1. Assinatura de código no Windows (SmartScreen) exige certificado.
