'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';

/** O dialog nativo mantém o foco na confirmação e torna o restante da página inerte. */
export function LeaveRoomDialog({
  onCancel,
  onLeave,
}: {
  onCancel: () => void;
  onLeave: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef(
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  useEffect(() => {
    const previous = previousFocus.current;
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    return () => {
      dialog?.close?.();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby="leave-room-title"
      aria-describedby="leave-room-description"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-line bg-surface-secondary p-6 text-ink-primary backdrop:bg-black/70"
    >
      <h2 id="leave-room-title" className="text-xl font-semibold">
        Sair da sala?
      </h2>
      <p id="leave-room-description" className="mt-3 text-sm leading-6 text-ink-secondary">
        Ao sair, seu microfone e o compartilhamento de tela serão encerrados. Você pode entrar na
        sala novamente pelo link.
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} autoFocus>
          Continuar na sala
        </Button>
        <Button variant="danger" onClick={onLeave}>
          Sair da sala
        </Button>
      </div>
    </dialog>
  );
}
