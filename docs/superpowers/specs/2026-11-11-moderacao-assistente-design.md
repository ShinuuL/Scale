# Assistente de moderacao, LGPD e gate de partilha de tela

**Data:** 2026-11-11 · **Branch:** `feat/moderacao-assistente`

## 1. Objetivo

1. Um **assistente de moderacao** que ajude a evitar conteudo depreciativo e
   bullying nas salas (chat, DM e partilha de tela).
2. Conformidade com a **LGPD** (Lei 13.709/2018): base legal, minimizacao,
   transparencia, consentimento revogavel, retencao curta.
3. **Partilha de tela so com verificacao de idade e confirmacao explicita do
   usuario**, aplicada no servidor (nao so na UI).

## 2. Restricao de arquitetura (ler antes de tudo)

A midia (audio e tela) trafega **P2P via WebRTC** entre os navegadores. O
servidor so faz signaling. Ele **nunca** recebe audio nem video. Consequencias:

- O servidor **nao escuta** chamadas de voz. Nao ha transcricao de audio nesta
  entrega (e, sob a LGPD, gravar/transcrever voz exigiria consentimento
  especifico de todos os participantes). Audio e coberto por **denuncia**
  (`moderation:report`) e pela acao do dono da sala.
- Para a tela, quem **compartilha** envia ao servidor, por iniciativa do seu
  proprio cliente, **amostras de baixa resolucao** (uma a cada N segundos) da
  propria transmissao. O servidor classifica em memoria e **descarta** o
  quadro. Quem compartilha ja esta exibindo aquela imagem para a sala; a
  amostra nao e dado novo sobre terceiros. Isso so acontece com
  `MODERATION_SCREEN=true` e provedor `claude`.
- Chat de sala e DM passam pelo servidor e sao moderados **antes** de persistir
  ou retransmitir.

## 3. Provedores de classificacao (`apps/server/src/lib/moderation/`)

Interface unica:

```ts
export type ModerationVerdict = {
  flagged: boolean;
  category: 'bullying' | 'hate' | 'sexual' | 'violence' | 'none';
  severity: 'low' | 'medium' | 'high';
  reason: string;          // curto, sem copiar o conteudo
};
export interface ModerationProvider {
  classifyText(text: string, ctx: { lang: 'pt' }): Promise<ModerationVerdict>;
  classifyImage?(jpeg: Buffer): Promise<ModerationVerdict>; // so `claude`
}
```

| `MODERATION_PROVIDER` | Texto | Imagem | Dados saem do servidor? |
|---|---|---|---|
| `off` | nao | nao | nao |
| `heuristic` (**default**) | lista PT-BR de termos/padroes de ofensa + heuristicas (repeticao, caixa alta, alvo por `@mencao`) | nao | nao |
| `claude` | Claude API (`@anthropic-ai/sdk`), modelo `MODERATION_MODEL` (default `claude-opus-5-5`; `claude-haiku-5-5` e a opcao barata) | sim | **sim** (Anthropic; declarar na politica de privacidade e no termo) |

Regras do provedor `claude`:
- `output_config.format` com JSON schema do `ModerationVerdict` (structured
  output), `max_tokens` 256, `output_config.effort: 'low'`, timeout curto
  (8 s), 1 retry. Sem prefill, sem `tool_choice` forcado.
- Prompt do sistema fixo (cacheavel) descrevendo as categorias em PT-BR.
- Falha/timeout do provedor = **fail-open com log** (`verdict` `none`,
  `reason: 'provider_error'`); nunca derruba o chat. O frame **nunca** e
  gravado em disco nem logado.
- O texto enviado e **so a mensagem** (ate 2000 chars), sem nome, e-mail, id
  ou historico. Pseudonimizacao e minimizacao por desenho.

## 4. Acoes e eventos

### 4.1 Texto (sala e DM)
- `chat:message`, `chat:edit` e `POST /api/dm/:userId/messages` chamam
  `moderateText()` antes de gravar.
- `severity: 'high'` → **bloqueia** (ack `{ error: 'Mensagem bloqueada pela
  moderacao', code: 'MODERATED', category }`), grava `ModerationEvent`.
- `severity: 'medium'` → entrega, grava `ModerationEvent` e emite
  `moderation:warning` **so para o autor** (`{ roomId?, category, text }`).
- `low`/`none` → nada.

### 4.2 Tela
- Sharer envia `POST /api/rooms/:roomId/moderation/frame` (multipart, JPEG
  <= 200 KB, header `X-Room-Ticket`), a cada `MODERATION_FRAME_INTERVAL_SEC`
  (default 20) enquanto compartilha. Balde `moderationFrame`: 6 / min por
  sujeito do ticket. Rota responde `204` sempre que aceitou (o veredito vai
  por socket, nao na resposta, para nao dar oraculo a quem testa limites).
- Veredito `high` → servidor emite `moderation:action` `{ roomId, action:
  'stop-screen-share', category }` para o socket do sharer (o cliente para a
  transmissao e mostra o aviso) e `moderation:notice` para o **dono** da sala
  (`{ roomId, peerId, category }`). `medium` → so `moderation:warning` ao
  sharer.
- Se `MODERATION_SCREEN` estiver desligado ou o provedor nao classificar
  imagem, a rota devolve `204` e descarta (o cliente nem envia: le a flag em
  `GET /api/moderation/config`).

### 4.3 Denuncia e dono da sala
- `moderation:report` (socket, dentro da sala): `{ roomId, targetPeerId,
  reason: 'bullying'|'hate'|'sexual'|'violence'|'other', details?: <=300 }`.
  Grava `ModerationEvent` (kind `report`), notifica o dono via
  `moderation:notice`. Balde `moderationReport`: 10 / 10 min por socket.
- Dono da sala pode `moderation:stop-share` `{ roomId, targetPeerId }` → o
  servidor emite `moderation:action stop-screen-share` para o alvo.

### 4.4 `GET /api/moderation/config` (publico)
`{ provider, screen: boolean, minAge, consentVersion, frameIntervalSec }`.

## 5. Gate de partilha de tela (servidor + cliente)

- **Convidado nao compartilha tela** (sem identidade verificavel).
- Usuario logado precisa de **ambos**: `ageVerifiedAt` com idade >=
  `SCREEN_SHARE_MIN_AGE` (default 18, calculado de `birthDate`) **e**
  `screenShareConsentAt` com `screenShareConsentVersion ===
  SCREEN_SHARE_CONSENT_VERSION` (constante em `@scale/shared`, hoje `'2026-11'`;
  mudar o termo = mudar a versao = pedir de novo).
- Enforcement: `signal:screen-share-state` com `isScreenSharing: true` e
  recusado (`{ error: 'Partilha de tela nao liberada', code:
  'SCREEN_SHARE_NOT_ALLOWED', reason: 'guest'|'age'|'consent' }`) quando o
  socket nao cumpre. O handler le o estado do usuario **no join-room** e guarda
  em `socket.data.screenShare = { allowed, reason }` (nao consulta o banco a
  cada sinal). Atualizacao de consentimento/idade reemite via REST, e o cliente
  reconecta a sala (ou o servidor emite `me:screen-share` ao socket logado
  apos o PATCH — preferir isto: busca sockets em `user:<userId>`).
- REST (logado, balde `profile`):
  - `PUT /api/me/age` `{ birthDate: 'YYYY-MM-DD' }` → grava `birthDate` e
    `ageVerifiedAt = now()`. Data futura, idade > 120 ou formato invalido =
    400. Resposta `{ ageVerified: true, isAdult: boolean }`.
  - `PUT /api/me/screen-share-consent` `{ version }` → `version` tem de ser a
    atual; grava `screenShareConsentAt`, `screenShareConsentVersion`.
  - `DELETE /api/me/screen-share-consent` → revoga (zera os dois campos). Idem
    `DELETE /api/me/age` → apaga `birthDate`/`ageVerifiedAt`.
  - `GET /api/auth/me` e demais `meSelect` passam a devolver
    `screenShare: { ageVerified, isAdult, consentVersion | null, allowed,
    reason }` (**nunca** devolve `birthDate` nos DTOs; so o booleano).
- Cliente: antes de `getDisplayMedia`, se `!me.screenShare.allowed`, abre
  `ScreenShareGateDialog` (AppModal) com passo 1 data de nascimento (se faltar)
  e passo 2 termo (checkbox "Li e concordo" + texto resumido + link para
  `/privacy`). Convidado ve aviso "Entre com uma conta para compartilhar a
  tela". Sempre que for compartilhar (mesmo liberado), mostra uma confirmacao
  curta "Confirmar partilha" com lembrete de que a tela pode ser analisada
  pelo assistente (quando `screen: true`) — e a "confirmacao do usuario".
- Apos liberar, o cliente chama `toggleScreenShare` normalmente.

## 6. Dados e retencao (LGPD)

Prisma:

```prisma
model User {
  // ...
  birthDate                 DateTime?
  ageVerifiedAt             DateTime?
  screenShareConsentAt      DateTime?
  screenShareConsentVersion String?
  moderationEvents          ModerationEvent[]
}

model ModerationEvent {
  id         String   @id @default(uuid())
  kind       String   // 'text' | 'frame' | 'report'
  source     String   // 'chat' | 'dm' | 'screen' | 'user'
  roomId     String?
  userId     String?  // autor logado (null = convidado)
  guestId    String?  // convidado (nunca sai em DTO)
  reporterId String?  // denuncia: quem denunciou (userId) — null se convidado
  category   String
  severity   String
  action     String   // 'blocked' | 'warned' | 'stopped-share' | 'reported' | 'none'
  excerpt    String?  // texto: ate 120 chars; frame: SEMPRE null
  createdAt  DateTime @default(now())
  user       User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([roomId, createdAt])
  @@index([userId, createdAt])
}
```

- **Retencao:** `ModerationEvent` apagado apos `MODERATION_RETENTION_DAYS`
  (default 90) pelo sweep existente de salas (`roomSweep`), mesmo intervalo.
- **Minimizacao:** frame nunca persiste; `excerpt` truncado; so a mensagem vai
  ao provedor; `birthDate` nunca sai em DTO.
- **Direitos do titular:** `GET /api/me/privacy/export` (JSON com perfil,
  flags de consentimento e eventos de moderacao proprios), revogacao por
  `DELETE` acima. Exclusao de conta ja remove em cascata.
- **Transparencia:** pagina `/privacy` no web (estatica, texto em
  `apps/web/src/app/privacy/page.tsx`) + `docs/lgpd-moderacao.md` com base
  legal por tratamento:
  - verificacao de idade: **obrigacao legal / cumprimento** (ECA e Marco
    Civil quanto a conteudo para menores) + execucao de contrato;
  - moderacao de texto e tela: **legitimo interesse** (art. 7, IX) com teste
    de balanceamento documentado, mais **consentimento** (art. 7, I) para a
    amostragem de tela quando o provedor e externo;
  - denuncia: legitimo interesse;
  - menor de 18 nao compartilha tela (art. 14 trata de criancas; aqui e
    decisao de produto registrada).
  - encarregado (DPO): placeholder `PRIVACY_CONTACT_EMAIL` (env, exibido na
    pagina). Nunca hardcodar e-mail real.

## 7. Variaveis de ambiente (backend)

| Var | Default | Nota |
|---|---|---|
| `MODERATION_PROVIDER` | `heuristic` | `off` / `heuristic` / `claude` |
| `MODERATION_MODEL` | `claude-opus-5-5` | so com `claude` |
| `ANTHROPIC_API_KEY` | — | obrigatoria se `claude`; nunca logar |
| `MODERATION_SCREEN` | `false` | amostragem de tela; exige `claude` |
| `MODERATION_FRAME_INTERVAL_SEC` | `20` | 10..120 |
| `MODERATION_RETENTION_DAYS` | `90` | 1..365 |
| `SCREEN_SHARE_MIN_AGE` | `18` | 13..21 |
| `PRIVACY_CONTACT_EMAIL` | `''` | exibido em `/privacy` via config |

`docker-compose.yml` passa todas (com `${VAR:-default}`); `.env.example`
documenta. Em producao com `claude` sem chave: backend recusa subir.

## 8. Divisao de trabalho (agentes)

| Frente | Arquivos (propriedade exclusiva) |
|---|---|
| **Backend** | `apps/server/src/lib/moderation/**`, `apps/server/src/lib/screenShareGate.ts`, `apps/server/src/routes/moderation.ts`, `apps/server/src/routes/profile.ts` (novas rotas), `apps/server/src/routes/social.ts` (hook DM), `apps/server/src/socket/handler.ts` (gate + eventos), `apps/server/src/lib/env.ts` (novas vars), `apps/server/src/lib/rateLimit.ts` (baldes), `apps/server/src/server.ts` (registro), sweep, testes em `apps/server/src/__tests__/moderation*.test.ts`, `screenShareGate.test.ts` |
| **Frontend** | `apps/web/src/components/room/ScreenShareGateDialog.tsx`, `ReportDialog.tsx`, `apps/web/src/hooks/useScreenModeration.ts`, `useWebRTC.ts`/`useSocket.ts`/`RoomSession.tsx`/`RoomControls.tsx`/`ParticipantList.tsx` (encaixes), `apps/web/src/lib/api.ts`, `SettingsDialog.tsx` (secao Privacidade: idade, consentimento, exportar), `apps/web/src/app/privacy/page.tsx`, testes |
| **LGPD/docs/infra** | `docs/lgpd-moderacao.md`, `docs/moderacao.md`, `AGENTS.md` (secao nova), `README.md`, `.env.example`, `docker-compose.yml`, `docker-compose.prod.yml` se preciso |

Fundacao ja aplicada antes dos agentes: `schema.prisma`, `@scale/shared`
(`moderation.ts` com schemas/eventos/constantes), este documento.
