# Administração — papéis, telas e auditoria

Spec: `docs/superpowers/specs/2026-11-11-admin-usuarios-design.md`.

## Onde acessar

Só para administradores (`isAdmin` em `GET /api/auth/me`):

- **Menu de perfil > "Administração"**: abre o hub `/admin`.
- **Configurações > seção "Administração"**: links diretos para Moderação,
  Métricas e Administradores. Os links navegam pelo roteador (sem recarregar a
  página), então uma chamada em andamento não cai.
- Hub `/admin`: cartões para `/admin/moderation`, `/metrics` e `/admin/users`.
  Cada tela tem o link "Voltar à Administração".

Quem não é admin e abre qualquer tela `/admin*` volta para a home com aviso;
sem sessão vai para `/login`. O backend repete a checagem (403) em toda rota.

## Papéis

| Papel | Origem | Quem concede | Como remover |
|---|---|---|---|
| **Raiz** (`adminSource: 'env'`) | E-mail em `ADMIN_EMAILS` / `METRICS_ADMIN_EMAILS` no `.env` | Quem administra o servidor | Só editando o `.env` e reiniciando o backend. A UI recusa (409 `env_admin`) |
| **Concedido** (`adminSource: 'db'`) | Linha em `AdminGrant` | Qualquer admin (raiz ou concedido), em `/admin/users` | Qualquer admin, em `/admin/users` |
| Usuário (`adminSource: null`) | - | - | - |

Os dois papéis têm o mesmo poder dentro do app (moderação, métricas e gestão
de administradores). A raiz existe para que sempre haja como recuperar o
acesso, mesmo que todos os concedidos sejam removidos.

## Regras

- Ninguém remove o **próprio** papel pela UI (400 `cannot_revoke_self`): evita
  ficar sem admin por engano. Peça a outro admin.
- Admin raiz não sai pela UI (409 `env_admin`).
- Conceder a quem já é admin: 200 idempotente, sem nova linha de auditoria.
- Na tabela, "Remover admin" fica inativo (com dica explicando o motivo) para
  a raiz e para a própria conta.
- Ao conceder ou remover, o servidor emite `me:admin` `{ isAdmin, adminSource }`
  para as abas do usuário alvo: o menu e as Configurações mudam sem recarregar,
  e quem perdeu o papel numa tela `/admin*` volta para a home.

## Tela `/admin/users`

- Busca por nome, @nome ou e-mail (debounce 300 ms) e filtro Todos/Admins
  (admins inclui raiz e concedidos).
- Colunas: nome, @nome, e-mail **mascarado** (`ga***@gmail.com`), data de
  cadastro, papel ("Raiz (.env)", "Admin", "Usuário") e quem concedeu.
- Ações "Tornar admin" / "Remover admin" sempre com confirmação.
- Paginação por "Carregar mais" (cursor opaco, 25 por página).

## Rotas (só admin; senão 403; balde `adminSettings`)

| Rota | Retorno |
|---|---|
| `GET /api/admin/users?q=&filter=all\|admins&cursor=&limit=25` | `{ users: AdminUserRow[], nextCursor }` |
| `PUT /api/admin/users/:userId/admin` | `AdminUserRow` atualizado (404 se não existe) |
| `DELETE /api/admin/users/:userId/admin` | `AdminUserRow` (409 `env_admin`, 400 `cannot_revoke_self`, 404) |
| `GET /api/admin/users/audit?limit=50` | `{ entries: AdminRoleAuditEntry[] }` |

Schemas em `packages/shared/src/admin.ts`.

## Auditoria

Toda concessão e remoção grava `AdminRoleAudit` (quem fez, nome do alvo,
ação, data) e aparece abaixo da tabela em `/admin/users`. Os nomes são
copiados no momento da ação, então o registro continua legível mesmo se a
conta mudar de nome ou for excluída.

## LGPD

A lista de usuários é tratamento próprio (finalidade: administração do
serviço; base: legítimo interesse; e-mail mascarado; sem dados de moderação
na lista). Registro no ROPA: `docs/lgpd-moderacao.md`, seção 8.
