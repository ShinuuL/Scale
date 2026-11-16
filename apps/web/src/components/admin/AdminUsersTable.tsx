'use client';

import type { AdminUserRow } from '@scale/shared';
import { Tooltip } from '@/components/ui/Tooltip';

export interface AdminUsersTableProps {
  users: AdminUserRow[];
  /** id da linha com acao em andamento. */
  busyId?: string | null;
  onGrant: (row: AdminUserRow) => void;
  onRevoke: (row: AdminUserRow) => void;
}

export const ROLE_LABELS = { env: 'Raiz (.env)', db: 'Admin', none: 'Usuário' } as const;

export const ENV_ADMIN_REASON = 'Admin raiz: só pode ser removido no .env';
export const SELF_REVOKE_REASON = 'Você não pode remover o seu próprio acesso';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(d);
}

/** Motivo de "Remover admin" estar inativo; null = pode remover. */
export function revokeBlockReason(row: AdminUserRow): string | null {
  if (row.admin === 'env') return ENV_ADMIN_REASON;
  if (row.isSelf) return SELF_REVOKE_REASON;
  return null;
}

const actionClass =
  'whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

interface RowActionProps {
  row: AdminUserRow;
  busy: boolean;
  onGrant: () => void;
  onRevoke: () => void;
}

function RowAction({ row, busy, onGrant, onRevoke }: RowActionProps) {
  if (row.admin === null) {
    return (
      <button
        type="button"
        onClick={onGrant}
        disabled={busy}
        aria-label={`Tornar ${row.name} admin`}
        className={`${actionClass} border-brand-400/40 text-brand-200 hover:bg-brand-500/10`}
      >
        Tornar admin
      </button>
    );
  }
  const reason = revokeBlockReason(row);
  if (reason) {
    const hintId = `revoke-hint-${row.id}`;
    // aria-disabled (e nao `disabled`): o botao continua recebendo ponteiro e
    // foco, entao a dica explica por que nao ha como remover.
    return (
      <Tooltip label={reason}>
        <button
          type="button"
          aria-disabled="true"
          aria-label={`Remover admin de ${row.name}`}
          aria-describedby={hintId}
          className={`${actionClass} border-line text-ink-muted`}
        >
          Remover admin
          <span id={hintId} className="sr-only">
            {reason}
          </span>
        </button>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      onClick={onRevoke}
      disabled={busy}
      aria-label={`Remover admin de ${row.name}`}
      className={`${actionClass} border-red-500/40 text-red-300 hover:bg-red-500/10`}
    >
      Remover admin
    </button>
  );
}

const roleClass = {
  env: 'rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-200',
  db: 'rounded-full bg-brand-500/15 px-2 py-0.5 text-xs font-medium text-brand-200',
  none: 'text-xs text-ink-muted',
} as const;

/**
 * Usuarios cadastrados. Em tela estreita a tabela rola na horizontal dentro do
 * proprio conteiner (a pagina nao ganha rolagem lateral).
 */
export function AdminUsersTable({ users, busyId = null, onGrant, onRevoke }: AdminUsersTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-ink-muted">
            <th scope="col" className="py-2 pr-4 font-medium">Nome</th>
            <th scope="col" className="py-2 pr-4 font-medium">@nome</th>
            <th scope="col" className="py-2 pr-4 font-medium">E-mail</th>
            <th scope="col" className="py-2 pr-4 font-medium">Desde</th>
            <th scope="col" className="py-2 pr-4 font-medium">Papel</th>
            <th scope="col" className="py-2 pr-4 font-medium">Concedido por</th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map((row) => {
            const role = row.admin ?? 'none';
            return (
              <tr key={row.id} className="border-b border-line/60 align-middle">
                <td className="py-3 pr-4 text-ink-primary">
                  {row.name}
                  {row.isSelf && <span className="ml-1.5 text-xs text-ink-muted">(você)</span>}
                </td>
                <td className="py-3 pr-4 text-ink-secondary">{row.username ? `@${row.username}` : '-'}</td>
                <td className="py-3 pr-4 text-ink-secondary">{row.emailMasked}</td>
                <td className="whitespace-nowrap py-3 pr-4 tabular-nums text-ink-secondary">
                  <time dateTime={row.createdAt}>{formatDate(row.createdAt)}</time>
                </td>
                <td className="whitespace-nowrap py-3 pr-4">
                  <span className={roleClass[role]}>{ROLE_LABELS[role]}</span>
                </td>
                <td className="py-3 pr-4 text-ink-secondary">{row.grantedBy?.name ?? '-'}</td>
                <td className="py-3 text-right">
                  <RowAction
                    row={row}
                    busy={busyId === row.id}
                    onGrant={() => onGrant(row)}
                    onRevoke={() => onRevoke(row)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
