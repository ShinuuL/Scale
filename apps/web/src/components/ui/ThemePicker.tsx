'use client';

import { Radio, RadioGroup } from 'react-aria-components';
import { clsx } from 'clsx';
import { PALETTES, usePalette, type PaletteId } from '@/lib/theme';

/**
 * Seletor de tema de cor (react-aria `RadioGroup`): amostras redondas; setas
 * trocam o tema, o anel de foco só aparece no teclado.
 */
export function ThemePicker({ className }: { className?: string }) {
  const [palette, setPalette] = usePalette();

  return (
    <RadioGroup
      aria-label="Tema de cor"
      orientation="horizontal"
      value={palette}
      onChange={(value) => setPalette(value as PaletteId)}
      className={clsx('flex items-center gap-1', className)}
    >
      {PALETTES.map((p) => (
        <Radio
          key={p.id}
          value={p.id}
          aria-label={`Tema ${p.label}`}
          className="group flex h-11 w-11 cursor-pointer items-center justify-center rounded-full outline-none transition-colors hover:bg-white/5 data-[focus-visible]:ring-2 data-[focus-visible]:ring-accent"
        >
          {({ isSelected }) => (
            <span
              aria-hidden="true"
              title={`Tema ${p.label}`}
              className={clsx(
                'block h-5 w-5 rounded-full border transition-[box-shadow,transform] duration-150 motion-reduce:transition-none',
                isSelected
                  ? 'scale-110 border-white ring-2 ring-white/40 ring-offset-2 ring-offset-surface-secondary'
                  : 'border-white/20 group-hover:scale-105',
              )}
              style={{ backgroundColor: p.swatch }}
            />
          )}
        </Radio>
      ))}
    </RadioGroup>
  );
}
