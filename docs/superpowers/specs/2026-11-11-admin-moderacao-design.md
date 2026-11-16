# Painel de administracao da moderacao

**Data:** 2026-11-11 · **Branch:** `feat/admin-moderacao` (sobre `feat/moderacao-assistente`, PR #10)

## Objetivo

Admins do sistema (`ADMIN_EMAILS`) configuram a moderacao em tempo de
execucao, sem redeploy: provedor de IA, modelo, chave de API (cifrada no
servidor), analise de tela, intervalo de amostragem, retencao, idade minima e
contato do encarregado. Toda alteracao e auditada.

## Principio inegociavel: transparencia

O que o admin configura e **sempre** refletido para o usuario final:
`GET /api/moderation/config` (publico) devolve a configuracao efetiva, a pagina
`/privacy` e o termo do `ScreenShareGateDialog` leem dela. Nao existe modo
oculto. A pagina de admin exibe um aviso fixo lembrando isso (LGPD art. 6, VI e
art. 9).

## Resolucao da configuracao

`efetivo = override do banco ?? valor do .env`, campo a campo. Chave de API:
banco (cifrada) > `ANTHROPIC_API_KEY` do .env > nenhuma.

Validacoes no `PUT` (400 com `{ error, field }`):
- `screenEnabled: true` exige provedor efetivo `claude`;
- provedor efetivo `claude` exige chave efetiva;
- o boot continua validando so o **.env** (override do banco nao afeta o start).

## Dados

```prisma
model ModerationSettings {
  id                  String   @id @default("default")
  provider            String?
  model               String?
  screenEnabled       Boolean?
  frameIntervalSec    Int?
  retentionDays       Int?
  minAge              Int?
  privacyContactEmail String?
  // AES-256-GCM; chave derivada do JWT_SECRET por HMAC com rotulo
  // 'scale:settings-key:v1' (mesmo padrao do room ticket). Formato
  // `v1.<iv b64>.<tag b64>.<ct b64>`. Nunca sai em DTO nem em log.
  apiKeyCiphertext    String?
  updatedById         String?
  updatedAt           DateTime @updatedAt
}

model ModerationAuditLog {
  id        String   @id @default(uuid())
  adminId   String
  adminName String
  changes   String   // JSON { campo: { from, to } }; apiKey so 'set'|'cleared'
  createdAt DateTime @default(now())
  @@index([createdAt])
}
```

## Rotas (logado + `isSystemAdmin`; senao 403; balde `adminSettings` 30 / 10 min por usuario)

- `GET /api/admin/moderation` → `AdminModerationState` (shared).
- `PUT /api/admin/moderation` body `AdminModerationUpdate` → `AdminModerationState`.
  Grava `ModerationAuditLog` com o diff (chave so como `set`). Invalida o cache
  de settings e o provedor em memoria. Emite `moderation:config` (socket,
  broadcast para todos) com o `ModerationConfig` publico novo, para quem esta
  em chamada atualizar o intervalo de amostragem.
- `DELETE /api/admin/moderation/api-key` → `AdminModerationState` (auditoria `cleared`).
- `POST /api/admin/moderation/test` `{ text }` → `ModerationVerdict` do provedor
  efetivo, **sem** gravar `ModerationEvent`. Serve para validar chave/modelo.
  Erro do provedor → 502 `{ error: 'provider_error', detail }` (detail sem chave).
- `GET /api/admin/moderation/audit?limit=50` → `{ entries: ModerationAuditEntry[] }`.
- `GET /api/auth/me` (e demais `toMe`) ganha `isAdmin: boolean`.

## Pontos que passam a ler a configuracao efetiva (async, com cache em memoria)

`getModerationConfig()`, `isScreenModerationEnabled()`, `getModerationProvider()`
(modelo + chave), `sweepModerationEvents()` (retencao), `computeScreenShareGate`
(o chamador passa `minAge` efetivo), rota de frame. Env continua sendo o default
de cada campo.

## Frontend

- Pagina `/admin/moderation` (so `me.isAdmin`; senao redireciona para `/` com
  aviso). Secoes: Provedor (select off/heuristic/claude, modelo, chave em campo
  tipo password e estado "chave configurada (banco|.env)" + Remover), Tela
  (toggle, intervalo), Retencao, Idade minima, Contato do encarregado, Testar
  (texto + veredito), Auditoria (tabela). Cada campo mostra "usando .env
  (valor)" quando sem override, com acao "Voltar ao .env".
- Aviso fixo no topo: "Tudo aqui e exibido aos usuarios em /privacy e no termo
  de partilha de tela. Nao ha monitoramento oculto."
- Entrada "Administracao" no menu de perfil quando `isAdmin`.
- `useSocket`: escuta `moderation:config` e atualiza o config em memoria
  (RoomSession/useScreenModeration usam o novo intervalo).
