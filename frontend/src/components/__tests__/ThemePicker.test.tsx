import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemePicker } from '@/components/ui/ThemePicker';
import { PALETTE_BOOT_SCRIPT, PALETTE_STORAGE_KEY, readStoredPalette } from '@/lib/theme';

describe('temas de cor', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
  });

  it('troca o tema, grava a escolha e Jade volta ao :root puro', () => {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole('radio', { name: 'Tema Safira' }));
    expect(document.documentElement.getAttribute('data-palette')).toBe('safira');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('safira');
    expect(screen.getByRole('radio', { name: 'Tema Safira' }).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Tema Jade' }));
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false);
  });

  it('setas do teclado percorrem os temas', () => {
    render(<ThemePicker />);
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Tema Jade' }), { key: 'ArrowRight' });
    expect(document.documentElement.getAttribute('data-palette')).toBe('grafite');
  });

  it('valor desconhecido no storage cai no tema padrão (nunca vira atributo)', () => {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, '"><script>');
    expect(readStoredPalette()).toBe('jade');
    new Function(PALETTE_BOOT_SCRIPT)();
    expect(document.documentElement.hasAttribute('data-palette')).toBe(false);
  });

  it('script de boot aplica o tema salvo antes da hidratação', () => {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, 'grafite');
    new Function(PALETTE_BOOT_SCRIPT)();
    expect(document.documentElement.getAttribute('data-palette')).toBe('grafite');
  });
});
