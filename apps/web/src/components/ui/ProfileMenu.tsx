'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { PALETTES, usePalette } from '@/lib/theme';
import { Icon } from '@/components/ui/Icon';

interface ProfileMenuProps {
  /** Nome exibido (conta ou convidado). */
  name: string;
  /** E-mail da conta; ausente = convidado. */
  email?: string | null;
  /** true quando há sessão válida. */
  isAuthenticated: boolean;
  className?: string;
}

const ITEM_SELECTOR = '[role="menuitemradio"], [role="menuitem"]';

function initialOf(name: string): string {
  return (name.trim().charAt(0) || '?').toUpperCase();
}

/**
 * Menu de perfil: avatar + nome no gatilho; no painel, identidade, tema de cor
 * e ações de conta. Fecha com Esc, clique fora ou ao escolher; o foco volta ao
 * gatilho. Setas, Home e End percorrem os itens.
 */
export function ProfileMenu({ name, email, isAuthenticated, className }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const [palette, setPalette] = usePalette();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const themeLabelId = useId();

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Clique fora fecha (sem roubar o foco de onde o usuário clicou).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // Ao abrir, foco no tema selecionado (primeiro item útil).
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const checked = menu.querySelector<HTMLElement>('[aria-checked="true"]');
    (checked ?? menu.querySelector<HTMLElement>(ITEM_SELECTOR))?.focus();
  }, [open]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      close(false);
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      items[next].focus();
    }
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' && !open) {
      e.preventDefault();
      setOpen(true);
    }
  };

  const itemClass =
    'flex min-h-[40px] w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm text-slate-200 outline-none transition-colors hover:bg-white/[0.06] focus-visible:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-brand-400/60';

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        data-profile-trigger
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Perfil de ${name}`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className={clsx(
          'flex min-h-[40px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-1 pl-1 pr-1 sm:pr-3',
          'text-sm text-slate-200 transition-colors hover:border-white/20 hover:bg-white/[0.06]',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400',
          open && 'border-white/20 bg-white/[0.06]',
        )}
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600/30 text-xs font-semibold text-brand-200"
        >
          {initialOf(name)}
        </span>
        <span className="hidden max-w-[10rem] truncate font-medium sm:inline">{name}</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Menu do perfil"
          onKeyDown={onMenuKeyDown}
          className={clsx(
            'absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] origin-top-right',
            'rounded-xl border border-white/10 bg-forest-900 p-1.5 shadow-2xl shadow-black/40',
            'animate-menu-in motion-reduce:animate-fade-in-fast',
          )}
        >
          <div className="flex items-center gap-3 px-2.5 py-2.5">
            <span
              aria-hidden="true"
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-600/30 text-sm font-semibold text-brand-200"
            >
              {initialOf(name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">{name}</p>
              <p className="truncate text-xs text-slate-400">
                {isAuthenticated ? email || 'Conta conectada' : name === 'Convidado' ? 'Sem conta conectada' : 'Convidado'}
              </p>
            </div>
          </div>

          <div className="my-1 border-t border-white/[0.08]" role="separator" />

          <div role="group" aria-labelledby={themeLabelId} className="py-1">
            <p id={themeLabelId} className="px-2.5 pb-1 pt-1 text-xs font-medium text-slate-400">
              Tema
            </p>
            {PALETTES.map((p) => {
              const checked = palette === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={checked}
                  tabIndex={-1}
                  onClick={() => {
                    setPalette(p.id);
                    close(true);
                  }}
                  className={itemClass}
                >
                  <span
                    aria-hidden="true"
                    className={clsx(
                      'block h-4 w-4 flex-shrink-0 rounded-full border',
                      checked ? 'border-white ring-2 ring-white/30' : 'border-white/20',
                    )}
                    style={{ backgroundColor: p.swatch }}
                  />
                  <span className="flex-1">{p.label}</span>
                  {checked && <Icon name="check" size={16} className="text-brand-400" />}
                </button>
              );
            })}
          </div>

          {!isAuthenticated && (
            <>
              <div className="my-1 border-t border-white/[0.08]" role="separator" />
              <div className="py-1">
                <Link href="/login" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => close(false)}>
                  <Icon name="key" size={16} className="text-slate-400" />
                  Entrar
                </Link>
                <Link href="/register" role="menuitem" tabIndex={-1} className={itemClass} onClick={() => close(false)}>
                  <Icon name="users" size={16} className="text-slate-400" />
                  Criar conta
                </Link>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
