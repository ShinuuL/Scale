import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemePicker } from '@/components/ui/ThemePicker';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PALETTES, PALETTE_BOOT_SRC, PALETTE_STORAGE_KEY, readStoredPalette } from '@/lib/theme';

// Script de boot real servido em public/ (o mesmo arquivo que o <head> carrega).
// (vitest roda com cwd = apps/web, a raiz do workspace.)
const PALETTE_BOOT_SCRIPT = readFileSync(path.resolve(process.cwd(), 'public', PALETTE_BOOT_SRC.slice(1)), 'utf8');

describe('temas de cor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
  });

  it('troca o tema, grava a escolha e Íris volta ao :root puro', () => {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole('radio', { name: 'Tema Safira' }));
    expect(document.documentElement.getAttribute('data-palette')).toBe('safira');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('safira');
    expect(screen.getByRole('radio', { name: 'Tema Safira' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Tema Íris' }));
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false);
  });

  it('setas do teclado percorrem os temas', () => {
    render(<ThemePicker />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Tema Íris' }), { key: 'ArrowRight' });
    expect(document.documentElement.getAttribute('data-palette')).toBe('grafite');
  });

  it('valor desconhecido no storage cai no tema padrão (nunca vira atributo)', () => {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, '"><script>');
    expect(readStoredPalette()).toBe('jade');
    new Function(PALETTE_BOOT_SCRIPT)();
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false);
  });

  it('script de boot usa a mesma chave e os mesmos temas de lib/theme', () => {
    expect(PALETTE_BOOT_SCRIPT).toContain(`'${PALETTE_STORAGE_KEY}'`);
    for (const { id } of PALETTES.filter((p) => p.id !== 'jade')) {
      expect(PALETTE_BOOT_SCRIPT).toContain(`p === '${id}'`);
    }
  });

  it('script de boot aplica o tema salvo antes da hidratação', () => {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'grafite');
    new Function(PALETTE_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute('data-palette')).toBe('grafite');
  });
});
