'use client';

import type { ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { clsx } from 'clsx';
import { Icon, type IconName } from '@/components/ui/Icon';

export interface AppModalProps {
  /** Título visível; também é o nome acessível do diálogo. */
  title: ReactNode;
  /** Ícone decorativo ao lado do título. */
  icon?: IconName;
  onClose: () => void;
  children: ReactNode;
  /** Nome acessível do botão de fechar. Sem ele, o modal não mostra o botão. */
  closeLabel?: string;
  /** Impede fechar por Esc/clique fora (ex.: enquanto salva). */
  locked?: boolean;
  size?: 'sm' | 'md' | 'lg';
  role?: 'dialog' | 'alertdialog';
  /** id de um texto que descreve o diálogo. */
  describedBy?: string;
  className?: string;
}

const SIZES = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg' } as const;

/**
 * Base dos modais do app (react-aria): portal no <body>, foco preso, Esc e
 * clique fora fecham (salvo `locked`) e o foco volta a quem abriu. Mesmo
 * visual em todos os diálogos: cantos 2xl, sombra, animação de entrada.
 */
export function AppModal({
  title,
  icon,
  onClose,
  children,
  closeLabel,
  locked = false,
  size = 'md',
  role = 'dialog',
  describedBy,
  className,
}: AppModalProps) {
  return (
    <ModalOverlay
      isOpen
      isDismissable={!locked}
      isKeyboardDismissDisabled={locked}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm data-[entering]:animate-fade-in"
    >
      <Modal
        className={clsx(
          'max-h-[calc(100dvh-2rem)] w-full overflow-y-auto rounded-2xl border border-line bg-surface-secondary p-6 text-ink-primary shadow-2xl shadow-black/40 data-[entering]:animate-menu-in',
          SIZES[size],
          className,
        )}
      >
        <Dialog role={role} aria-describedby={describedBy} className="outline-none">
          {({ close }) => (
            <>
              <div className="mb-5 flex items-center justify-between gap-3">
                <Heading
                  slot="title"
                  className="flex min-w-0 items-center gap-2 text-lg font-semibold"
                >
                  {icon && <Icon name={icon} size={18} className="shrink-0 text-ink-muted" />}
                  <span className="min-w-0 break-words">{title}</span>
                </Heading>
                {closeLabel && (
                  <button
                    type="button"
                    onClick={close}
                    disabled={locked}
                    aria-label={closeLabel}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40"
                  >
                    <Icon name="close" />
                  </button>
                )}
              </div>
              {children}
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
