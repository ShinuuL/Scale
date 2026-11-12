'use client';

import type { AdminRoleAuditEntry } from '@scale/shared';

export interface AdminRoleAuditTableProps {
  entries: AdminRoleAuditEntry[] | null;
  error: string | null;
  onRetry: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

/** Quem concedeu ou removeu o papel de admin de quem, e quando. */
export function AdminRoleAuditTable({ entries, error, onRetry }: AdminRoleAuditTableProps) {
  return (
    <section className="glass p-5 sm:p-6" aria-labelledby="admin-role-audit-title">
      <h3 id="admin-role-audit-title" className="text-base font-semibold text-ink-primary">
        Auditoria de administradores
      </h3>
      <p className="mt-1 text-sm text-ink-muted">Toda concessão e remoção fica registrada com quem a fez.</p>
      {error && (
        <div
          className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
          role="alert"
        >
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2">
            Tentar novamente
          </button>
        </div>
      )}
      {entries && entries.length === 0 && (
        <p className="mt-4 text-sm text-ink-muted">Nenhuma alteração registrada ainda.</p>
      )}
      {entries && entries.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Data</th>
                <th scope="col" className="py-2 pr-4 font-medium">Administrador</th>
                <th scope="col" className="py-2 pr-4 font-medium">Ação</th>
                <th scope="col" className="py-2 font-medium">Usuário</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line/60">
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums text-ink-secondary">
                    <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                  </td>
                  <td className="py-3 pr-4 text-ink-primary">{entry.actor.name}</td>
                  <td className="py-3 pr-4 text-ink-secondary">
                    {entry.action === 'grant' ? 'Tornou admin' : 'Removeu admin'}
                  </td>
                  <td className="py-3 text-ink-primary">{entry.target.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
