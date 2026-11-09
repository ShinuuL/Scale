'use client';

import { useCallback, useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';

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
 * Confirmacao de exclusao definitiva de sala (react-aria, role="alertdialog"):
 * foco preso, Esc e clique fora cancelam e o foco volta ao elemento que abriu. Nunca usa
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
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(() => {
    if (!deleting) onCancel();
  }, [deleting, onCancel]);

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
    <ModalOverlay
      isOpen
      isDismissable={!deleting}
      isKeyboardDismissDisabled={deleting}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 data-[entering]:animate-fade-in"
    >
      <Modal className="w-full max-w-md rounded-2xl border border-line bg-surface-secondary p-6 shadow-2xl shadow-black/40 data-[entering]:animate-menu-in">
        <Dialog
          role="alertdialog"
          aria-describedby="delete-room-desc"
          className="space-y-4 outline-none"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-400"
            >
              <Icon name="trash" size={20} />
            </span>
            <div className="min-w-0">
              <Heading slot="title" className="break-words text-base font-semibold text-white">
                Apagar a sala {roomName}?
              </Heading>
              <p id="delete-room-desc" className="mt-1 text-sm text-ink-muted">
                Todos saem da chamada e as mensagens e arquivos são apagados para sempre.
              </p>
            </div>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300"
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button autoFocus variant="secondary" onClick={cancel} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              onClick={() => void confirm()}
              disabled={deleting}
              aria-busy={deleting}
            >
              {deleting ? 'Apagando...' : 'Apagar sala'}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
