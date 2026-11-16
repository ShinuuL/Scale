'use client';

import type { ModerationAuditEntry } from '@scale/shared';
import { fieldLabel, formatFieldValue } from './moderationLabels';

export interface ModerationAuditTableProps {
  entries: ModerationAuditEntry[] | null;
  error: string | null;
  onRetry: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(d);
}

/** "Provedor: Heurística local para Claude API"; apiKey so "definida"/"removida". */
export function describeChange(field: string, change: { from?: unknown; to?: unknown }): string {
  if (field === 'apiKey') return `${fieldLabel(field)}: ${formatFieldValue(field, change.to)}`;
  return `${fieldLabel(field)}: ${formatFieldValue(field, change.from)} para ${formatFieldValue(field, change.to)}`;
}

/** Ultimas alteracoes feitas pelo painel (quem, quando, o que). */
export function ModerationAuditTable({ entries, error, onRetry }: ModerationAuditTableProps) {
  return (
    <section className="glass p-5 sm:p-6" aria-labelledby="admin-audit-title">
      <h3 id="admin-audit-title" className="text-base font-semibold text-ink-primary">
        Auditoria
      </h3>
      <p className="mt-1 text-sm text-ink-muted">Toda alteração fica registrada com o administrador que a fez.</p>
      {error && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
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
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-4 font-medium">Data</th>
                <th scope="col" className="py-2 pr-4 font-medium">Administrador</th>
                <th scope="col" className="py-2 font-medium">Mudanças</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-line/60 align-top">
                  <td className="whitespace-nowrap py-3 pr-4 tabular-nums text-ink-secondary">
                    <time dateTime={entry.createdAt}>{formatDate(entry.createdAt)}</time>
                  </td>
                  <td className="py-3 pr-4 text-ink-primary">{entry.admin.name}</td>
                  <td className="py-3">
                    <ul className="space-y-1 text-ink-primary">
                      {Object.entries(entry.changes).map(([field, change]) => (
                        <li key={field}>{describeChange(field, change)}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
