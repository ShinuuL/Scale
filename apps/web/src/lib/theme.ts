'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';

/** Temas de cor (valores em app/globals.css, por `data-palette`). */
export const PALETTES = [
  { id: 'jade', label: 'Íris', swatch: '#a5aaff' },
  { id: 'grafite', label: 'Grafite', swatch: '#c0c5e9' },
  { id: 'safira', label: 'Safira', swatch: '#9ebaff' },
] as const;

export type PaletteId = (typeof PALETTES)[number]['id'];

export const PALETTE_STORAGE_KEY = 'scale:palette';
const DEFAULT_PALETTE: PaletteId = 'jade';
const paletteSchema = z.enum(['jade', 'grafite', 'safira']);

/** A chave legada jade preserva a preferência; sua apresentação agora é Íris. */
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
 * Caminho do script de boot do tema (public/theme-boot.js), carregado de forma
 * sincrona no <head> para aplicar o tema salvo antes da primeira pintura. E um
 * arquivo estatico (nao inline) para a CSP dispensar 'unsafe-inline'.
 */
export const PALETTE_BOOT_SRC = '/theme-boot.js';

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
