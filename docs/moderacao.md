# Assistente de moderação — guia operacional

Como funciona, como ligar, quanto custa e como diagnosticar o assistente de
moderação do Scale (chat, DM, partilha de tela e denúncia). A parte jurídica
(bases legais, ROPA, direitos do titular) está em `docs/lgpd-moderacao.md`.
Spec: `docs/superpowers/specs/2026-11-11-moderacao-assistente-design.md`.

---

## 1. Arquitetura

Regra que explica tudo: **áudio e tela são P2P (WebRTC)**. O servidor só faz
signaling e nunca recebe mídia. Então:

- **Texto** (chat de sala, edição, DM) passa pelo servidor e é classificado
  **antes** de gravar ou retransmitir.
- **Tela**: o cliente de quem compartilha tira amostras da própria transmissão
  e manda ao servidor, que classifica em memória e descarta.
- **Áudio**: não é analisado. Cobertura: denúncia + dono da sala.

```
TEXTO (chat:message / chat:edit / POST /api/dm/:userId/messages)
  cliente ──texto──> backend ── moderateText() ──┬─ high   → ack { code: 'MODERATED' }, grava ModerationEvent(blocked)
                                                 ├─ medium → grava + retransmite + moderation:warning (só ao autor)
                                                 └─ low/none → retransmite/grava normalmente

TELA (só MODERATION_SCREEN=true + provider claude; o cliente lê GET /api/moderation/config)
  sharer ──JPEG ≤200KB a cada N s──> POST /api/rooms/:roomId/moderation/frame (X-Room-Ticket)
          <── 204 sempre ──                │ classifyImage() em memória, quadro descartado
                                           ├─ high   → moderation:action { stop-screen-share, by: 'assistant' } ao sharer
                                           │          + moderation:notice { kind: 'frame' } ao dono da sala
                                           │          + ModerationEvent(kind frame, excerpt null, action stopped-share)
                                           └─ medium → moderation:warning ao sharer

DENÚNCIA (socket, dentro da sala)
  participante ──moderation:report { targetPeerId, reason, details? }──> backend
                                           ├─ ModerationEvent(kind report, action reported)
                                           └─ moderation:notice { kind: 'report' } ao dono da sala
  dono ──moderation:stop-share { targetPeerId }──> backend ──> moderation:action { by: 'owner' } ao alvo

GATE DE PARTILHA (servidor)
  join-room → socket.data.screenShare = { allowed, reason } (lido do User)
  signal:screen-share-state { isScreenSharing: true } → recusado se !allowed
      { code: 'SCREEN_SHARE_NOT_ALLOWED', reason: 'guest' | 'age' | 'consent' }
  PUT /api/me/age · PUT|DELETE /api/me/screen-share-consent → servidor emite me:screen-share ao socket logado

RETENÇÃO
  ModerationEvent apagado após MODERATION_RETENTION_DAYS pelo sweep de salas (mesmo intervalo).
```

Código: `apps/server/src/lib/moderation/` (provedores),
`apps/server/src/lib/screenShareGate.ts`, `apps/server/src/routes/moderation.ts`,
`apps/server/src/socket/handler.ts`; schemas e eventos em
`packages/shared/src/moderation.ts`.

---

## 2. Provedores

| `MODERATION_PROVIDER` | Texto | Imagem | Dados saem do servidor | Custo |
|---|---|---|---|---|
| `off` | não | não | não | zero |
| `heuristic` (**default**) | lista PT-BR de termos/padrões + heurísticas (repetição, caixa alta, alvo por `@menção`) | não | **não** | zero |
| `claude` | Claude API (`@anthropic-ai/sdk`), modelo `MODERATION_MODEL` | sim (só este) | **sim** (Anthropic) | por token |

Regras do provedor `claude`:

- Saída estruturada (JSON schema do `ModerationVerdict`), `max_tokens` 256,
  `effort: low`, timeout 8 s, 1 retry. Prompt do sistema fixo em PT-BR
  (cacheável).
- Falha ou timeout = **fail-open com log** (`category: none`,
  `reason: 'provider_error'`). O chat nunca cai por causa do provedor.
- Vai para a API **só o texto da mensagem** (até 2000 chars) ou **só o quadro**.
  Sem nome, e-mail, ids, sala ou histórico.
- O quadro nunca é gravado em disco nem logado.

### 2.1 Custos aproximados

Preços de referência (por 1 milhão de tokens, US$):

| Modelo | Entrada | Saída | Papel |
|---|---|---|---|
| `claude-opus-5-5` | 4,00 | 20,00 | **default** de `MODERATION_MODEL` (qualidade máxima) |
| `claude-haiku-5-5` | 0,10 | 0,50 | alternativa barata: `MODERATION_MODEL=claude-haiku-5-5` |

Estimativa por chamada (ordem de grandeza; prompt de sistema ~400 tokens, que
o cache de prompt barateia ainda mais quando ativo):

| Chamada | Tokens (aprox.) | Opus | Haiku |
|---|---|---|---|
| Mensagem de texto média (~200 chars) | ~500 entrada + ~60 saída | ~US$ 0,003 | ~US$ 0,0001 |
| Mensagem máxima (2000 chars) | ~1.000 entrada + ~60 saída | ~US$ 0,005 | ~US$ 0,0001 |
| Quadro de tela (480 px de largura, ~480×270) | ~600 entrada + ~60 saída | ~US$ 0,004 | ~US$ 0,0001 |

Projeções (intervalo default de 20 s = 3 quadros/min por sharer):

| Cenário | Opus | Haiku |
|---|---|---|
| 1 hora de tela compartilhada (180 quadros) | ~US$ 0,70 | ~US$ 0,02 |
| 1.000 mensagens de chat | ~US$ 3 a 5 | ~US$ 0,10 |

Conclusão prática: com `MODERATION_SCREEN=true`, o custo é dominado pelos
quadros; aumente `MODERATION_FRAME_INTERVAL_SEC` (até 120) ou use Haiku. Os
preços mudam: confira a tabela oficial antes de orçar.

---

## 3. Variáveis de ambiente (backend)

| Var | Default | Nota |
|---|---|---|
| `MODERATION_PROVIDER` | `heuristic` | `off` / `heuristic` / `claude` |
| `MODERATION_MODEL` | `claude-opus-5-5` | só com `claude`; `claude-haiku-5-5` é a opção barata |
| `ANTHROPIC_API_KEY` | — | obrigatória se `claude` (em produção o backend recusa subir sem ela); nunca logar |
| `MODERATION_SCREEN` | `false` | amostragem de tela; exige `claude` |
| `MODERATION_FRAME_INTERVAL_SEC` | `20` | 10..120 |
| `MODERATION_RETENTION_DAYS` | `90` | 1..365 |
| `SCREEN_SHARE_MIN_AGE` | `18` | 13..21 |
| `PRIVACY_CONTACT_EMAIL` | `''` | exibido em `/privacy` via `GET /api/moderation/config` |

`docker-compose.yml` repassa todas com `${VAR:-default}`; `.env.example`
documenta. Nenhuma delas precisa de override no `docker-compose.prod.yml`.

---

## 4. Ligar o modo `claude` com segurança

1. Gere a chave no console da Anthropic com uma conta da organização (não
   pessoal) e, se possível, com limite de gasto mensal.
2. Coloque **só no `.env`** (na VPS: `/opt/scale/.env`, permissão 600, nunca
   versionado):

   ```
   MODERATION_PROVIDER=claude
   MODERATION_MODEL=claude-haiku-5-5   # ou deixe o default opus
   ANTHROPIC_API_KEY=<chave>
   MODERATION_SCREEN=false             # ligue só depois de revisar o termo e a LGPD
   ```

3. **Nunca** escreva a chave no `docker-compose.yml`, no overlay de produção,
   em Dockerfile, em script de deploy ou em log. O compose só repassa
   `ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}`.
4. Antes de `MODERATION_SCREEN=true`: checklist da seção 9 de
   `docs/lgpd-moderacao.md` (DPA, `/privacy`, versão do termo).
5. Suba (`docker compose up -d --build` ou `deploy/enviar.ps1`) e confira
   `GET /api/moderation/config`.
6. Se a chave vazar: revogue no console, gere outra, atualize o `.env` e
   reinicie o backend.

---

## 4.1 Painel de administração

Página `/admin/moderation` (menu de perfil > "Administração" > Moderação, ou
Configurações > Administração), visível só para admin do sistema (raiz em
`ADMIN_EMAILS` ou concedido; ver `docs/administracao.md`; `GET /api/auth/me`
devolve `isAdmin` e `adminSource`).
Quem não é admin é mandado para a home com aviso; o backend repete a checagem
(403) em toda rota. Spec: `docs/superpowers/specs/2026-11-11-admin-moderacao-design.md`.

- **O que dá para mudar** sem redeploy: provedor (`off`/`heuristic`/`claude`),
  modelo, chave de API, análise de tela, intervalo das amostras (10..120 s),
  retenção (1..365 dias), idade mínima (13..21) e contato do encarregado.
- **Precedência**: `banco > .env`, campo a campo. Cada campo mostra
  "Usando .env: <valor>" quando não há override; "Voltar ao .env" envia
  `null`. O boot continua validando só o `.env`.
- **Validações** (400 `{ error, field }`): análise de tela exige provedor
  efetivo `claude`; `claude` exige chave efetiva.
- **Chave de API**: gravada cifrada (AES-256-GCM, chave derivada do
  `JWT_SECRET` por HMAC com rótulo `scale:settings-key:v1`). Nunca volta ao
  cliente (só `hasApiKey`/`apiKeySource`) nem vai para log. **Trocar o
  `JWT_SECRET` invalida a chave guardada**: cadastre-a de novo no painel.
  Remover (`DELETE /api/admin/moderation/api-key`) pede confirmação e volta à
  chave do `.env`, se houver.
- **Testar**: `POST /api/admin/moderation/test { text }` classifica com o
  provedor efetivo sem gravar evento (502 `provider_error` mostra o detalhe,
  sem a chave).
- **Auditoria**: toda alteração grava `ModerationAuditLog` (admin, data, diff
  `{ campo: { from, to } }`; a chave aparece só como `set`/`cleared`). A
  tabela fica no próprio painel (`GET /api/admin/moderation/audit?limit=50`).
- **Tempo real**: após salvar, o servidor emite `moderation:config` (broadcast)
  com a config pública nova; quem está em chamada passa a usar o novo
  intervalo/estado da amostragem sem sair da sala.
- Rotas: `GET|PUT /api/admin/moderation`, `DELETE .../api-key`,
  `POST .../test`, `GET .../audit`. Balde `adminSettings`: 30 / 10 min por
  usuário.
- **Transparência obrigatória**: tudo o que se configura aqui aparece para o
  usuário em `/privacy` e no termo de partilha de tela (via
  `GET /api/moderation/config`). Não existe modo oculto; o painel exibe esse
  aviso fixo no topo.

---

## 5. Como testar

### Configuração ativa

```bash
# Docker local (proxy)
curl -s http://localhost:8080/api/moderation/config | jq .
# dev no host
curl -s http://localhost:4100/api/moderation/config | jq .
```

Esperado:

```json
{
  "provider": "heuristic",
  "screen": false,
  "minAge": 18,
  "consentVersion": "2026-11",
  "frameIntervalSec": 20,
  "privacyContactEmail": null
}
```

`provider` tem de refletir o `.env`; `screen` só é `true` com
`MODERATION_SCREEN=true` **e** `provider: "claude"`.

### Chat bloqueado (modo `heuristic`)

1. Crie uma sala e entre com dois navegadores (ou dois contextos).
2. No primeiro, envie uma mensagem com ofensa direta a alguém mencionado
   (`@nome` + termo da lista PT-BR) em caixa alta e repetida.
3. Esperado: o ack do `chat:message` volta com
   `{ error: 'Mensagem bloqueada pela moderacao', code: 'MODERATED', category }`,
   o segundo navegador **não** recebe a mensagem, e o banco ganha um
   `ModerationEvent` com `action = 'blocked'` e `excerpt` ≤ 120 chars.
4. Mensagem de severidade média: entregue nos dois lados e o autor recebe
   `moderation:warning` (toast no cliente).

### Gate de partilha

1. Convidado: o botão de tela abre o aviso "Entre com uma conta para
   compartilhar a tela". No socket, `signal:screen-share-state` com
   `isScreenSharing: true` devolve `SCREEN_SHARE_NOT_ALLOWED` / `guest`.
2. Logado sem data de nascimento: diálogo pede a data; `PUT /api/me/age`
   com data futura ou idade > 120 → 400.
3. Logado menor que `minAge`: `reason: 'age'`; não há como prosseguir.
4. Logado maior sem termo: `reason: 'consent'`; aceitar grava
   `PUT /api/me/screen-share-consent { version }`, o servidor emite
   `me:screen-share` e a partilha libera sem recarregar.
5. `DELETE /api/me/screen-share-consent` → próxima tentativa pede o termo de
   novo.

### Export

```bash
curl -s -b "token=<cookie de sessao>" http://localhost:8080/api/me/privacy/export | jq .
```

Deve conter perfil, `screenShare` (booleanos, **sem** `birthDate`) e eventos
de moderação próprios (sem `guestId` de ninguém).

### Frame (só com `screen: true`)

Com a tela compartilhada, o cliente envia `POST
/api/rooms/:roomId/moderation/frame` a cada `frameIntervalSec`. Com
`docker compose logs -f backend` você vê a chamada ao provedor (sem o
conteúdo). A sétima chamada no mesmo minuto por sujeito do ticket recebe 429.

---

## 6. Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Log `moderation provider_error` repetido; mensagens passam sem análise | Chave inválida, sem crédito, timeout (8 s) ou rede bloqueando `api.anthropic.com` | Confira `ANTHROPIC_API_KEY` no `.env`, saldo da conta e saída HTTPS do container. É **fail-open**: o chat continua; corrija sem pressa |
| Backend não sobe em produção com `claude` | `ANTHROPIC_API_KEY` vazia com `NODE_ENV=production` | Defina a chave ou volte para `heuristic` |
| `429` em `POST .../moderation/frame` | Balde `moderationFrame` (6/min por sujeito do ticket) ou cliente mandando mais rápido que `frameIntervalSec` | Confira o intervalo lido de `/api/moderation/config`; dois sharers com o mesmo usuário contam juntos |
| `403` em `POST .../moderation/frame` | Sem `X-Room-Ticket` válido, sala encerrada ou não é o próprio sharer | Entrar na sala de novo (`join-room`) renova o ticket |
| `screen: false` mesmo com `MODERATION_SCREEN=true` | Provedor não é `claude` | Só o `claude` classifica imagem |
| Gate recusa (`SCREEN_SHARE_NOT_ALLOWED`) depois de aceitar o termo | Socket ainda com `socket.data.screenShare` antigo (não recebeu `me:screen-share`) ou versão do termo mudou | Reentrar na sala; conferir `consentVersion` em `/api/moderation/config` vs. `screenShare.consentVersion` em `/api/auth/me` |
| `reason: 'age'` para quem é maior | Data gravada errada | `DELETE /api/me/age` e informar de novo |
| `429` em `moderation:report` | 10 denúncias / 10 min por socket | Esperar; é intencional |
| Muitos falsos positivos no `heuristic` | Lista de termos é simples por desenho | Ajustar a lista em `apps/server/src/lib/moderation/` ou usar `claude` |
| Custo alto | Opus + tela ligada | `MODERATION_MODEL=claude-haiku-5-5` e/ou `MODERATION_FRAME_INTERVAL_SEC` maior |

Logs: nunca contêm o texto analisado, o quadro nem a chave. Com
`provider_error`, o log traz o tipo do erro (timeout, status HTTP), não o
payload.

---

## 7. Limitações

- **Áudio não é monitorado**: é P2P. Só denúncia e dono da sala. Mudar isso
  exigiria SFU e consentimento específico de todos (ver
  `docs/lgpd-moderacao.md`, seção 4).
- **Falsos positivos e negativos**: a heurística é uma lista; o modelo erra
  também. Severidade `high` bloqueia sem recurso automático; o dono da sala e
  o canal do encarregado são o caminho de revisão.
- **Fail-open**: sem provedor, a mensagem passa. É deliberado (disponibilidade
  > moderação), mas significa que uma indisponibilidade longa da API deixa o
  chat sem análise. Monitore o log.
- **Tela**: só amostras (1 a cada 10–120 s, ≤ 480 px). Conteúdo breve entre
  amostras passa. Quem compartilha pode parar o cliente de enviar amostras
  (é o próprio cliente que envia); a denúncia cobre esse caso.
- **Verificação de idade autodeclarada**: sem documento.
- **Convidado não compartilha tela** e tem autoria por `guestId` (bearer
  12 h no ticket).
- **Idioma**: prompt e heurística em PT-BR; outros idiomas têm cobertura menor.
