'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DeleteRoomDialogProps {
  roomId: string;
  roomName: string;
  /** Chamado depois que o servidor confirmou a exclusao. */
  onDeleted: () => void;
  /** Cancelar (botao, Esc ou clique fora). O foco volta ao gatilho. */
  onCancel: () => void;
  /** Opcional: a requisicao de exclusao comecou / falhou. */
  onDeleteStart?: () => void;
  onDeleteError?: () => void;
}

function errorMessage(err: unknown): string {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? (err as { status?: unknown }).status
      : undefined;
  if (status === 403) return 'Você não tem permissão para apagar esta sala.';
  if (status === 404) return 'Esta sala já não existe.';
  if (status === 429) return 'Muitas exclusões seguidas. Tente de novo em alguns minutos.';
  if (status === 401) return 'Sua sessão expirou. Entre de novo para apagar a sala.';
  return 'Não foi possível apagar a sala. Tente de novo.';
}

/**
 * Confirmacao de exclusao definitiva de sala (role="alertdialog"): foco preso,
 * Esc cancela e o foco volta ao elemento que abriu o dialogo. Nunca usa
 * window.confirm (o desktop Electron e o padrao do projeto pedem UI propria).
 */
export function DeleteRoomDialog({
  roomId,
  roomName,
  onDeleted,
  onCancel,
  onDeleteStart,
  onDeleteError,
}: DeleteRoomDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Foco inicial no "Cancelar": acao destrutiva nunca e o default.
    dialogRef.current?.querySelector<HTMLButtonElement>('[data-autofocus]')?.focus();
    return () => {
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  const cancel = useCallback(() => {
    if (!deleting) onCancel();
  }, [deleting, onCancel]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        cancel();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [cancel],
  );

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    onDeleteStart?.();
    try {
      await api.deleteRoom(roomId);
      onDeleted();
    } catch (err) {
      onDeleteError?.();
      setError(errorMessage(err));
      setDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-forest-950/80 p-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-room-title"
        aria-describedby="delete-room-desc"
        onKeyDown={handleKeyDown}
        className="w-full max-w-md space-y-4 rounded-2xl border border-white/10 bg-forest-900 p-6 shadow-2xl shadow-black/40"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400"
          >
            <Icon name="trash" size={20} />
          </span>
          <div className="min-w-0">
            <h2 id="delete-room-title" className="break-words text-base font-semibold text-white">
              Apagar a sala {roomName}?
            </h2>
            <p id="delete-room-desc" className="mt-1 text-sm text-slate-400">
              Todos saem da chamada e as mensagens e arquivos são apagados para sempre.
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button data-autofocus variant="secondary" onClick={cancel} disabled={deleting}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={deleting} aria-busy={deleting}>
            {deleting ? 'Apagando...' : 'Apagar sala'}
          </Button>
        </div>
      </div>
    </div>
  );
}
