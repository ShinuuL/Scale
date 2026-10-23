'use client';

import { clsx } from 'clsx';
import { PALETTES, usePalette } from '@/lib/theme';

/** Seletor de tema de cor: três amostras em grupo de rádio (setas trocam). */
export function ThemePicker({ className }: { className?: string }) {
  const [palette, setPalette] = usePalette();

  return (
    <div role="radiogroup" aria-label="Tema de cor" className={clsx('flex items-center gap-1', className)}>
      {PALETTES.map((p, index) => {
        const checked = palette === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={`Tema ${p.label}`}
            title={`Tema ${p.label}`}
            tabIndex={checked ? 0 : -1}
            onClick={() => setPalette(p.id)}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
              e.preventDefault();
              const step = e.key === 'ArrowRight' ? 1 : -1;
              const next = PALETTES[(index + step + PALETTES.length) % PALETTES.length];
              setPalette(next.id);
              const group = e.currentTarget.parentElement;
              group?.querySelector<HTMLButtonElement>(`[data-palette-id="${next.id}"]`)?.focus();
            }}
            data-palette-id={p.id}
            className="flex h-11 w-9 items-center justify-center rounded-md hover:bg-white/5"
          >
            <span
              aria-hidden="true"
              className={clsx(
                'block h-4 w-4 rounded-full border transition-shadow duration-150 motion-reduce:transition-none',
                checked ? 'border-white ring-2 ring-white/40' : 'border-white/20',
              )}
              style={{ backgroundColor: p.swatch }}
            />
          </button>
        );
      })}
    </div>
  );
}
