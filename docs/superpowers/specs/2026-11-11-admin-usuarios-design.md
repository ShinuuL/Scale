# Gestao de administradores e acesso pelas Configuracoes

**Data:** 2026-11-11 · **Branch:** `feat/admin-usuarios` (sobre `feat/admin-moderacao`, PR #13)

## Objetivo

1. Admin chega as telas de administracao pela interface (Configuracoes e menu
   de perfil), sem digitar URL: Moderacao, Metricas e Administradores.
2. Admin ve os usuarios cadastrados e concede ou remove o papel de admin.

## Modelo de papel

- **Raiz (`env`)**: e-mails em `ADMIN_EMAILS` / `METRICS_ADMIN_EMAILS`. Nao
  podem ser removidos pela UI (so editando o `.env`). Garante que sempre ha
  como recuperar o acesso.
- **Concedido (`db`)**: tabela `AdminGrant`. Qualquer admin (raiz ou
  concedido) concede ou remove.
- Ninguem remove o proprio papel pela UI (400 `cannot_revoke_self`): evita
  ficar sem admin por engano.
- Remover um admin raiz: 409 `env_admin`. Conceder a quem ja e admin: 200
  idempotente sem nova auditoria.

```prisma
model AdminGrant {
  userId      String   @id
  grantedById String
  createdAt   DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model AdminRoleAudit {
  id         String   @id @default(uuid())
  actorId    String
  actorName  String
  targetId   String
  targetName String
  action     String   // 'grant' | 'revoke'
  createdAt  DateTime @default(now())
  @@index([createdAt])
}
```

## Checagem unica de admin

`isAdminUser({ userId, email })` async em `apps/server/src/lib/adminRole.ts`:
raiz pelo e-mail OU linha em `AdminGrant`. Substitui `isSystemAdmin` em
metrics, rooms, adminModeration. `toMe` continua sincrono: `meSelect` inclui
`adminGrant: { select: { userId: true } }` e `isAdmin = raiz || !!adminGrant`.
`/api/auth/me` ganha tambem `adminSource: 'env' | 'db' | null`.

## Rotas (admin; senao 403; balde `adminSettings`)

- `GET /api/admin/users?q=&filter=all|admins&cursor=&limit=25` →
  `AdminUsersPage` (shared). Ordem: admins primeiro? Nao: ordem por `createdAt`
  desc, `id` como desempate; cursor opaco. `q` busca em nome, @nome e e-mail
  (contem, case-insensitive). E-mail sai **mascarado** (`ga***@gmail.com`:
  2 primeiros caracteres do local + `***` + `@dominio`; local com 2 ou menos
  caracteres vira `*` + `***`). `filter=admins` inclui raiz (por e-mail) e
  concedidos.
- `PUT /api/admin/users/:userId/admin` → `AdminUserRow` atualizado (grava
  `AdminGrant` + `AdminRoleAudit` grant). 404 usuario inexistente.
- `DELETE /api/admin/users/:userId/admin` → `AdminUserRow` (apaga grant +
  auditoria revoke). 409 `{ error: 'env_admin' }`, 400 `{ error:
  'cannot_revoke_self' }`, 404.
- `GET /api/admin/users/audit?limit=50` → `{ entries: AdminRoleAuditEntry[] }`.
- Apos grant/revoke: emitir `me:admin` `{ isAdmin, adminSource }` para a sala
  `user:<targetId>` (as abas do alvo atualizam o menu sem recarregar).

## Frontend

- `/admin` (hub): cartoes Moderacao (`/admin/moderation`), Metricas
  (`/metrics`), Administradores (`/admin/users`). So admin; senao flash + `/`.
- `/admin/users`: busca (debounce 300 ms), filtro Todos/Admins, tabela com
  nome, @nome, e-mail mascarado, desde, papel ("Raiz (.env)", "Admin",
  "Usuario"), concedido por. Acoes: "Tornar admin" e "Remover admin" com
  AppModal de confirmacao; raiz e o proprio usuario sem acao de remover
  (com dica explicando o motivo, via `aria-disabled` + Tooltip). Paginacao
  "Carregar mais". Secao de auditoria abaixo.
- **Configuracoes** (`SettingsDialog`): secao "Administracao" so para admin,
  com tres links (Moderacao, Metricas, Administradores). Menu de perfil:
  item "Administracao" passa a abrir `/admin`.
- `/metrics` e `/admin/moderation` ganham link "Voltar a Administracao".
- `useUserEvents`/socket: escutar `me:admin` e atualizar o usuario em memoria.

## LGPD

Lista de usuarios e tratamento novo: finalidade administracao do servico,
base legitimo interesse, minimizacao (e-mail mascarado, sem dados de
moderacao na lista), auditoria de quem concedeu. Registrar no ROPA.
