'use client';

import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Button } from '@/components/ui/Button';

/**
 * Confirmação de saída da chamada (react-aria `Modal`): foco preso, Escape e
 * clique fora cancelam, e o foco volta ao controle que abriu ao fechar.
 */
export function LeaveRoomDialog({
  onCancel,
  onLeave,
}: {
  onCancel: () => void;
  onLeave: () => void;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 data-[entering]:animate-fade-in"
    >
      <Modal className="w-full max-w-md rounded-2xl border border-line bg-surface-secondary p-6 text-ink-primary shadow-2xl shadow-black/40 data-[entering]:animate-menu-in">
        <Dialog aria-describedby="leave-room-description" className="outline-none">
          <Heading slot="title" className="text-xl font-semibold">
            Sair da sala?
          </Heading>
          <p id="leave-room-description" className="mt-3 text-sm leading-6 text-ink-secondary">
            Ao sair, seu microfone e o compartilhamento de tela serão encerrados. Você pode entrar
            na sala novamente pelo link.
          </p>
          <div className="mt-6 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onCancel} autoFocus>
              Continuar na sala
            </Button>
            <Button variant="danger" onClick={onLeave}>
              Sair da sala
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
