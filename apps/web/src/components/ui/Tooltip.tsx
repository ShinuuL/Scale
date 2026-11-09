'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
  type Placement,
} from '@floating-ui/react-dom';

export interface TooltipProps {
  /** Texto curto. Deve repetir o nome acessível do controle (aria-label). */
  label: string;
  placement?: Placement;
  children: ReactNode;
}

const OPEN_DELAY_MS = 350;
// Fora do componente: array estável, sem recalcular a posição a cada render.
const TOOLTIP_MIDDLEWARE = [offset(8), flip({ padding: 8 }), shift({ padding: 8 })];

/**
 * Dica visual para botões só-ícone. Abre com hover (após um atraso curto) ou
 * foco de teclado e fecha com Escape. O texto fica `aria-hidden`: o nome
 * acessível já vem do `aria-label` do controle, então leitores de tela não o
 * ouvem duas vezes. Posicionamento por `@floating-ui/react-dom` (vira de lado
 * perto da borda da tela).
 */
export function Tooltip({ label, placement = 'top', children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refs, floatingStyles } = useFloating({
    open,
    placement,
    strategy: 'fixed',
    middleware: TOOLTIP_MIDDLEWARE,
    whileElementsMounted: autoUpdate,
  });

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (delay: number) => {
    clear();
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <span
      ref={refs.setReference}
      className="inline-flex"
      onPointerEnter={(event) => {
        if (event.pointerType !== 'touch') show(OPEN_DELAY_MS);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={(event) => {
        if ((event.target as HTMLElement).matches(':focus-visible')) show(0);
      }}
      onBlur={hide}
    >
      {children}
      {open && (
        <span
          ref={refs.setFloating}
          style={floatingStyles}
          aria-hidden="true"
          className="pointer-events-none z-50 whitespace-nowrap rounded-lg border border-line bg-surface-tertiary px-2.5 py-1.5 text-xs font-medium text-ink-primary shadow-xl"
        >
          {label}
        </span>
      )}
    </span>
  );
}
