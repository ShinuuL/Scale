# LGPD — Assistente de moderação, verificação de idade e partilha de tela

Documento técnico-jurídico interno (equipe Mastersys) sobre os tratamentos de
dados pessoais introduzidos pelo assistente de moderação do Scale. Base: Lei
13.709/2018 (LGPD). Spec de origem:
`docs/superpowers/specs/2026-11-11-moderacao-assistente-design.md`.

Este documento **não** substitui parecer jurídico. Cita somente artigos da lei;
não cita jurisprudência nem orientações da ANPD que não tenham sido conferidas.

---

## 1. Contexto arquitetural (lido antes de qualquer análise)

- Áudio e tela trafegam **P2P via WebRTC** entre navegadores. O servidor faz
  apenas signaling: **nunca recebe áudio nem vídeo**.
- Chat de sala e mensagens privadas (DM) passam pelo servidor e são moderados
  **antes** de persistir ou retransmitir.
- Para a tela, o **próprio cliente de quem compartilha** envia ao servidor
  amostras de baixa resolução (JPEG até 200 KB, largura até 480 px, uma a cada
  `MODERATION_FRAME_INTERVAL_SEC`, default 20 s). O servidor classifica em
  memória e **descarta** o quadro. Só ocorre com `MODERATION_SCREEN=true` e
  provedor `claude`.
- Provedores (`MODERATION_PROVIDER`): `off`, `heuristic` (default; lista local
  de termos PT-BR e heurísticas, **nada sai do servidor**) e `claude` (Claude
  API da Anthropic; texto e imagem **saem do servidor**).

---

## 2. Inventário de tratamentos (a)

| # | Tratamento | Finalidade | Dados tratados | Base legal (Lei 13.709/2018) | Retenção | Compartilhamento | Medidas de segurança |
|---|---|---|---|---|---|---|---|
| T1 | **Verificação de idade** (`PUT /api/me/age`) | Garantir que só maiores de `SCREEN_SHARE_MIN_AGE` (default 18) compartilhem tela; proteção de crianças e adolescentes | `birthDate`, `ageVerifiedAt` (apenas usuário logado) | Art. 7, II (cumprimento de obrigação legal/regulatória do controlador quanto a conteúdo acessível a menores) e art. 7, V (execução de contrato: termo de uso da funcionalidade). Art. 14 orienta a proteção do melhor interesse do menor | Enquanto a conta existir ou até `DELETE /api/me/age`; exclusão de conta apaga (cascade) | Nenhum. `birthDate` **nunca** sai em DTO (só `ageVerified` e `isAdult`) | Autodeclaração sem documento; campo em SQLite com volume próprio; rota autenticada (JWT HttpOnly); balde `profile` 20/10 min |
| T2 | **Consentimento de partilha de tela** (`PUT|DELETE /api/me/screen-share-consent`) | Registrar que o titular leu e aceitou o termo de partilha (incl. aviso de que a tela pode ser analisada) | `screenShareConsentAt`, `screenShareConsentVersion` | Art. 7, I (consentimento), específico para a versão do termo (`SCREEN_SHARE_CONSENT_VERSION`); art. 8, §§ 5 e 6 (revogável, ônus da prova do controlador) | Até revogação (`DELETE`) ou exclusão da conta; nova versão do termo invalida a anterior e pede de novo | Nenhum | Enforcement no servidor (`signal:screen-share-state` recusado sem consentimento vigente); registro de versão e data |
| T3 | **Moderação de texto** (chat de sala, edição e DM) | Prevenir bullying, ódio, conteúdo sexual e violência; manter ambiente seguro | Conteúdo da mensagem (até 2000 chars); `ModerationEvent` com `userId` ou `guestId`, `roomId`, categoria, severidade, ação e `excerpt` ≤ 120 chars | Art. 7, IX (legítimo interesse; ver LIA na seção 3). Para convidado, o `guestId` é pseudônimo | `ModerationEvent`: `MODERATION_RETENTION_DAYS` (default 90), apagado pelo sweep | `heuristic`: nenhum. `claude`: **só o texto da mensagem** vai à Anthropic (sem nome, e-mail, id, sala ou histórico) — ver seção 2.1 | Minimização por desenho; `guestId` nunca em DTO; `reason` do veredito nunca copia o conteúdo; fail-open com log em falha do provedor |
| T4 | **Amostragem de tela** (`POST /api/rooms/:roomId/moderation/frame`) | Detectar conteúdo sexual/violento/ódio exibido em tela compartilhada | Quadro JPEG de baixa resolução, em memória, descartado após classificação; `ModerationEvent` (kind `frame`) **sem** excerpt | Art. 7, IX (legítimo interesse) **somado** a art. 7, I (consentimento específico, T2, porque o quadro sai para provedor externo). Só é ativado com `MODERATION_SCREEN=true` + `claude` | Quadro: **zero** (nunca persiste, nunca é logado). Evento: `MODERATION_RETENTION_DAYS` | `claude`: o quadro vai à Anthropic — ver 2.1 | Balde `moderationFrame` 6/min por sujeito do ticket; limite 200 KB; exige room ticket; resposta sempre `204` (sem oráculo) |
| T5 | **Denúncia** (`moderation:report`) | Permitir que participantes reportem condutas que o servidor não vê (inclusive áudio) e acionar o dono da sala | `reporterId` (null se convidado), `targetPeerId`, motivo, `details` ≤ 300 chars, `roomId` | Art. 7, IX (legítimo interesse; também interesse do próprio denunciante) | `MODERATION_RETENTION_DAYS` | Nenhum fora do servidor. O dono da sala recebe `moderation:notice` com `peerId` e categoria (sem o texto da denúncia) | Balde `moderationReport` 10/10 min por socket; só dentro da sala |
| T6 | **Exportação de dados** (`GET /api/me/privacy/export`) | Atender ao direito de acesso e portabilidade do titular | Perfil, flags de consentimento/idade (booleanos, não `birthDate`), eventos de moderação **do próprio** titular | Art. 18, II e V (acesso e portabilidade) — é exercício de direito, não tratamento novo | Não armazena; responde sob demanda | Nenhum | Rota autenticada; balde `profile` |

### 2.1 Transferência internacional (modo `claude`)

Com `MODERATION_PROVIDER=claude`, o texto da mensagem (T3) e o quadro de tela
(T4) são enviados à **Anthropic**, operadora sediada fora do Brasil. Isso é
**transferência internacional de dados** (art. 33). A hipótese aplicável deve
ser documentada antes de ligar o modo em produção; as mais plausíveis são:

- art. 33, II — cláusulas contratuais / termos comerciais do provedor que
  assegurem nível de proteção adequado (verificar os termos comerciais e o
  acordo de processamento de dados — DPA — da Anthropic, incluindo a cláusula
  de **não uso dos dados para treinamento** nos termos comerciais da API);
- art. 33, VIII — consentimento específico e em destaque do titular, que o
  Scale colhe para a tela (T2) e informa na página `/privacy` para o texto.

No modo `heuristic` ou `off` **não há transferência**: nada sai do servidor.

O que é enviado é o **mínimo**: só o conteúdo analisado. Nunca vão nome,
e-mail, `userId`, `guestId`, `roomId`, IP ou histórico. A chave de API fica
só no `.env` (nunca no compose commitado, nunca em log).

---

## 3. Teste de balanceamento — legítimo interesse (LIA) para moderação (b)

Resumo do teste exigido para a base do art. 7, IX (ver também art. 10).

1. **Finalidade legítima e concreta (art. 10, I e II):** prevenir bullying,
   ódio, conteúdo sexual indevido e violência em salas de voz e chat. É o
   interesse do controlador (ambiente seguro) e do próprio titular e dos demais
   participantes (apoio e promoção de atividades do controlador; proteção do
   exercício regular de direitos e prestação de serviços que beneficiem o
   titular).
2. **Necessidade e minimização (art. 10, § 1):** moderar apenas o que o servidor
   já recebe por desenho (chat/DM) e, para tela, apenas amostras de baixa
   resolução já exibidas à sala, por iniciativa de quem compartilha. Nada de
   áudio. Excerpt truncado a 120 chars, quadro nunca persistido, `reason` sem
   cópia do conteúdo.
3. **Expectativa razoável do titular:** quem usa chat em plataforma de salas
   espera moderação; a página `/privacy` e o termo de partilha explicam o
   mecanismo, o provedor e a retenção (transparência, art. 10, § 2).
4. **Impacto sobre o titular:** bloqueio de mensagem (`high`), aviso só ao
   autor (`medium`), interrupção da partilha de tela (`high`). Não há sanção
   permanente, banimento automático nem perfilamento. Falso positivo custa uma
   mensagem bloqueada; o fail-open evita que falha do provedor derrube o
   serviço.
5. **Salvaguardas:** retenção curta (`MODERATION_RETENTION_DAYS`), evento
   acessível ao titular via export, `guestId` pseudônimo, rate limits, logs sem
   conteúdo, chave só em `.env`, possibilidade de desligar o provedor externo.
6. **Conclusão:** o interesse prevalece desde que (i) o provedor externo seja
   declarado na política, (ii) a amostragem de tela tenha consentimento
   específico adicional (T2) e (iii) a retenção não ultrapasse o default.

---

## 4. Por que o áudio NÃO é monitorado (c)

- O áudio é **P2P**: o servidor nunca o recebe. Não há como classificar o que
  não passa pelo servidor sem mudar a arquitetura.
- Ainda que fosse tecnicamente possível, gravar ou transcrever voz é tratamento
  de dado de **todos** os participantes de uma vez, com maior sensibilidade
  (voz pode revelar dados sensíveis, art. 5, II). O legítimo interesse não
  sustentaria isso com a facilidade do texto.
- Cobertura atual do áudio: **denúncia** (`moderation:report`) e ação do dono
  da sala (`moderation:stop-share`, expulsão/encerramento existentes).

Para mudar isso seria preciso, **cumulativamente**:

1. Trocar mesh P2P por **SFU** (o servidor passa a receber a mídia) —
   mudança de escopo travado no `AGENTS.md`.
2. **Consentimento específico e destacado de todos os participantes** da sala
   (art. 7, I; art. 8, § 4), por sessão, com aviso visível de que a chamada é
   analisada; convidado sem conta teria de consentir também.
3. Novo LIA e, provavelmente, **relatório de impacto** (art. 38).
4. Novo tratamento no ROPA, nova versão do termo e da página `/privacy`.
5. Se houver provedor externo de transcrição: nova transferência
   internacional (art. 33) e DPA.

---

## 5. Minimização por desenho (d)

| Regra | Onde é garantida |
|---|---|
| Quadro de tela nunca persiste nem é logado | `apps/server/src/routes/moderation.ts` (classifica em memória e descarta); `ModerationEvent.excerpt` é `null` para `kind='frame'` |
| `excerpt` de texto ≤ 120 chars | Gravação do `ModerationEvent` |
| `birthDate` nunca em DTO | `meSelect` devolve só `screenShare.{ageVerified,isAdult}`; export devolve booleanos |
| Só a mensagem vai ao provedor | Provider `claude`: `classifyText(text)` recebe apenas o texto (sem nome, e-mail, id, sala, histórico) |
| `guestId` nunca sai do servidor | DTOs públicos e export |
| `reason` do veredito não copia conteúdo | Schema `moderationVerdictSchema` (máx. 200 chars) e prompt do sistema |
| Chave de API nunca em log/compose | `.env` apenas; `ANTHROPIC_API_KEY` redigida |
| Rota de frame não dá oráculo | Resposta `204` sempre; veredito só por socket ao sharer |

---

## 6. Direitos do titular e como atendê-los (e)

| Direito (art. 18) | Como o Scale atende |
|---|---|
| Confirmação e acesso (I, II) | `GET /api/me/privacy/export` (JSON com perfil, flags e eventos de moderação próprios) |
| Correção (III) | `PATCH /api/me` (nome), `PUT /api/me/age` (corrigir data) |
| Anonimização/bloqueio/eliminação de dados desnecessários (IV) | `DELETE /api/me/age` apaga `birthDate`/`ageVerifiedAt`; eventos de moderação expiram sozinhos em `MODERATION_RETENTION_DAYS` |
| Portabilidade (V) | Mesmo export em JSON |
| Eliminação dos dados tratados com consentimento (VI) | `DELETE /api/me/screen-share-consent` + exclusão de conta (cascade em `ModerationEvent`) |
| Informação sobre compartilhamento (VII) | Página `/privacy` informa o provedor ativo (`GET /api/moderation/config` expõe `provider`) |
| Informação sobre não consentir e consequências (VIII) | Diálogo de gate: sem consentimento, não compartilha tela; o resto do app continua |
| Revogação do consentimento (IX) | `DELETE /api/me/screen-share-consent` (Configurações > Privacidade) |
| Canal com o encarregado (art. 41) | `PRIVACY_CONTACT_EMAIL` exibido em `/privacy` (vem do env, nunca hardcoded) |

Pedidos manuais (por e-mail ao encarregado) que o produto ainda não automatiza:
revisão de decisão automatizada (art. 20) — hoje a resposta é humana, pelo dono
da sala ou pela equipe, com base no `ModerationEvent`.

Prazo: a lei fala em "prazos e termos" definidos em regulamento; adotar
internamente 15 dias para resposta.

---

## 7. Decisões de produto registradas (f)

1. **Menor de `SCREEN_SHARE_MIN_AGE` não compartilha tela.** O art. 14 trata
   do tratamento de dados de crianças e adolescentes no melhor interesse
   deles; aqui a regra é uma decisão de produto (limitar exposição de tela de
   menores e evitar tratar a imagem de tela de menor no provedor externo), e
   não uma obrigação direta da LGPD. O mínimo é configurável (13..21).
2. **Verificação é autodeclarada.** Não há conferência de documento, biometria
   nem terceiro verificador. Limitação explícita: o controle é de
   responsabilização (quem declarar falsamente responde pelo termo), não
   de certeza. Coletar documento criaria tratamento mais invasivo do que o
   risco que se quer mitigar.
3. **Convidado não compartilha tela** (sem identidade verificável para T1/T2).
4. **Fail-open** na falha do provedor: disponibilidade do chat prevalece sobre
   a moderação; a falha fica em log.
5. **Default `heuristic`**: sem transferência internacional por padrão. O modo
   `claude` é decisão explícita de quem implanta.

---

## 8. Registro de operações de tratamento — ROPA (g)

| Operação | Controlador | Operador | Categorias de titulares | Categorias de dados | Base legal | Retenção | Transferência internacional | Medidas |
|---|---|---|---|---|---|---|---|---|
| Verificação de idade | Mastersys (instância Scale) | — | Usuários logados | Data de nascimento, data da verificação | Art. 7, II e V | Até revogação/exclusão | Não | Rota autenticada, sem DTO, SQLite em volume |
| Consentimento de partilha | Mastersys | — | Usuários logados | Data e versão do aceite | Art. 7, I | Até revogação/exclusão | Não | Enforcement no servidor, versionado |
| Moderação de texto | Mastersys | Anthropic (só modo `claude`) | Usuários e convidados | Conteúdo de mensagem; evento (categoria, severidade, excerpt ≤ 120) | Art. 7, IX | `MODERATION_RETENTION_DAYS` (90) | Sim, só modo `claude` (art. 33) | Minimização, pseudônimo, rate limit, fail-open |
| Amostragem de tela | Mastersys | Anthropic | Usuários logados maiores que compartilham | Quadro JPEG (transitório); evento sem excerpt | Art. 7, IX + 7, I | Quadro: 0; evento: 90 dias | Sim (art. 33) | Nunca persiste, 204 sem oráculo, balde 6/min |
| Denúncia | Mastersys | — | Usuários e convidados (denunciante e denunciado) | Motivo, detalhes ≤ 300, ids internos | Art. 7, IX | 90 dias | Não | Balde 10/10 min, só na sala |
| Export de privacidade | Mastersys | — | Usuários logados | Perfil e eventos próprios | Art. 18 | Não armazena | Não | Rota autenticada |
| Configuração e auditoria de moderação | Mastersys | — | Administradores do sistema | Id e nome do admin, data, diff da configuração (chave de API só como `set`/`cleared`) | Art. 7, IX (legítimo interesse: segurança e prestação de contas) | Indefinida (a definir) | Não | Só admin (`ADMIN_EMAILS`), balde `adminSettings`, chave cifrada (AES-256-GCM) |

A configuração da moderação feita pelo painel de administração **nunca é
oculta ao titular**: o estado efetivo é público (`GET /api/moderation/config`)
e é o que a página `/privacy` e o termo de partilha de tela exibem. Não existe
modo de monitoramento oculto (art. 6, VI e art. 9).

---

## 9. Checklist de implantação (h)

- [ ] Definir `PRIVACY_CONTACT_EMAIL` no `.env` (canal do encarregado,
      art. 41). Nunca no código nem no compose.
- [ ] Revisar o texto de `/privacy` (`apps/web/src/app/privacy/page.tsx`):
      provedor, retenção, direitos, canal de contato, aviso de que áudio não
      é monitorado.
- [ ] Decidir `MODERATION_PROVIDER`. Default `heuristic` = sem transferência.
- [ ] Se `claude`: aceitar os termos comerciais da Anthropic, obter e arquivar
      o DPA, confirmar a cláusula de não treinamento com os dados da API,
      registrar a hipótese do art. 33 adotada, e informar na política.
- [ ] Se `MODERATION_SCREEN=true`: conferir que o termo de partilha
      (`SCREEN_SHARE_CONSENT_VERSION`) menciona a análise de tela por
      provedor externo; mudou o texto, mude a versão.
- [ ] Definir `MODERATION_RETENTION_DAYS` (não ultrapassar 90 sem justificar
      no LIA).
- [ ] Confirmar `SCREEN_SHARE_MIN_AGE` (default 18).
- [ ] Guardar `ANTHROPIC_API_KEY` só no `.env` (600 na VPS); rotacionar se vazar.
- [ ] Atualizar este ROPA e o `AGENTS.md` quando mudar qualquer tratamento.

---

## 10. Pendências e riscos aceitos (i)

| Item | Tipo | Nota |
|---|---|---|
| Verificação de idade autodeclarada | Risco aceito | Sem documento; menor pode mentir. Mitigação: termo, denúncia, dono da sala |
| Fail-open | Risco aceito | Em falha do provedor a mensagem passa sem análise; fica em log |
| Falsos positivos (heurística e modelo) | Risco aceito | Bloqueio de mensagem legítima; não há recurso automatizado (art. 20 é atendido manualmente) |
| Áudio sem monitoramento | Limitação de arquitetura | Só denúncia; ver seção 4 |
| Transferência internacional no modo `claude` | Pendência | Hipótese do art. 33 e DPA têm de ser formalizados antes de ligar em produção |
| Ticket de convidado é bearer (12 h) | Herdado | Já documentado no `AGENTS.md`; afeta a rota de frame (só logado compartilha, então o impacto é só no rate limit por sujeito) |
| Relatório de impacto (art. 38) | Pendência | Não elaborado; recomendado se `MODERATION_SCREEN=true` em produção |
| Revisão de decisão automatizada (art. 20) | Pendência | Sem fluxo no produto; atendimento manual pelo canal do encarregado |
| Página `/privacy` e termo | Pendência | Texto final depende de revisão da equipe antes do deploy |
| Dados de menores já cadastrados | Observação | Conta pode existir sem `birthDate`; o gate só bloqueia a partilha de tela, não o uso do app |
