'use client';

import { useId, useState, type ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  requiredName,
  onConfirm,
  onClose,
}: {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  requiredName?: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setError(
        status === 401
          ? 'Sua sessão expirou. Entre novamente.'
          : status === 429
            ? 'Muitas tentativas. Aguarde alguns minutos.'
            : 'Não foi possível concluir a ação. Tente novamente.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <ModalOverlay
      isOpen
      isDismissable={!busy}
      isKeyboardDismissDisabled={busy}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 data-[entering]:animate-fade-in motion-reduce:animate-none"
    >
      <Modal className="w-full max-w-md rounded-2xl border border-line bg-surface-secondary p-6 shadow-2xl shadow-black/40 data-[entering]:animate-menu-in motion-reduce:animate-none">
        <Dialog
          role="alertdialog"
          aria-describedby={descriptionId}
          className="space-y-4 outline-none"
        >
          <Heading slot="title" className="text-base font-semibold text-ink-primary">
            {title}
          </Heading>
          <div id={descriptionId} className="break-words text-sm text-ink-muted">
            {description}
          </div>
          {requiredName && (
            <Input
              label={`Digite ${requiredName} para confirmar`}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          )}
          {error && <Banner variant="error">{error}</Banner>}
          <div className="flex justify-end gap-2">
            <Button autoFocus variant="secondary" disabled={busy} onClick={onClose}>
              Cancelar
            </Button>
            <Button
              variant="danger"
              disabled={busy || (!!requiredName && name !== requiredName)}
              aria-busy={busy}
              onClick={() => void confirm()}
            >
              {busy ? 'Aguarde...' : confirmLabel}
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
