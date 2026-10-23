'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

/** Temas de cor (valores em app/globals.css, por `data-palette`). */
export const PALETTES = [
  { id: 'jade', label: 'Jade', swatch: '#34d399' },
  { id: 'grafite', label: 'Grafite', swatch: '#97a3af' },
  { id: 'safira', label: 'Safira', swatch: '#60a5fa' },
] as const;

export type PaletteId = (typeof PALETTES)[number]['id'];

export const PALETTE_STORAGE_KEY = 'scale:palette';
const DEFAULT_PALETTE: PaletteId = 'jade';
const paletteSchema = z.enum(['jade', 'grafite', 'safira']);

/** Jade não leva atributo: é o `:root` puro. */
export function applyPalette(id: PaletteId): void {
  const root = document.documentElement;
  if (id === DEFAULT_PALETTE) root.removeAttribute('data-palette');
  else root.setAttribute('data-palette', id);
}

export function readStoredPalette(): PaletteId {
  try {
    const parsed = paletteSchema.safeParse(window.localStorage.getItem(PALETTE_STORAGE_KEY));
    return parsed.success ? parsed.data : DEFAULT_PALETTE;
  } catch {
    // Storage bloqueado (aba anônima, política do navegador): tema padrão.
    return DEFAULT_PALETTE;
  }
}

/**
 * Script inline do <head>: aplica o tema salvo ANTES da primeira pintura, para
 * a página não piscar em verde. Texto estático (sem dado do usuário) e com
 * allowlist — o valor do storage nunca vira atributo sem passar por ela.
 */
export const PALETTE_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem('${PALETTE_STORAGE_KEY}');if(p==='grafite'||p==='safira')document.documentElement.setAttribute('data-palette',p);}catch(e){}})();`;

export function usePalette(): [PaletteId, (id: PaletteId) => void] {
  const [palette, setPaletteState] = useState<PaletteId>(DEFAULT_PALETTE);

  useEffect(() => {
    setPaletteState(readStoredPalette());
  }, []);

  const setPalette = useCallback((id: PaletteId) => {
    setPaletteState(id);
    applyPalette(id);
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, id);
    } catch {
      // Sem storage: o tema vale só nesta aba.
    }
  }, []);

  return [palette, setPalette];
}
