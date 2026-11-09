import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Tooltip } from '@/components/ui/Tooltip';

function renderTooltip() {
  render(
    <Tooltip label="Silenciar microfone">
      <button type="button" aria-label="Silenciar microfone">
        x
      </button>
    </Tooltip>,
  );
  return screen.getByRole('button', { name: 'Silenciar microfone' });
}

describe('Tooltip', () => {
  it('abre com hover após o atraso e fecha ao sair', () => {
    vi.useFakeTimers();
    try {
      const button = renderTooltip();
      fireEvent.pointerEnter(button.parentElement as HTMLElement, { pointerType: 'mouse' });
      expect(screen.queryByText('Silenciar microfone', { selector: 'span' })).toBeNull();
      act(() => {
        vi.advanceTimersByTime(400);
      });
      expect(screen.getByText('Silenciar microfone', { selector: 'span' })).toBeTruthy();
      fireEvent.pointerLeave(button.parentElement as HTMLElement);
      expect(screen.queryByText('Silenciar microfone', { selector: 'span' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('texto da dica fica fora da árvore acessível e fecha com Escape', () => {
    vi.useFakeTimers();
    try {
      const button = renderTooltip();
      fireEvent.pointerEnter(button.parentElement as HTMLElement, { pointerType: 'mouse' });
      act(() => {
        vi.advanceTimersByTime(400);
      });
      const tip = screen.getByText('Silenciar microfone', { selector: 'span' });
      expect(tip.getAttribute('aria-hidden')).toBe('true');
      // O nome acessível continua vindo só do aria-label do botão.
      expect(screen.getAllByRole('button', { name: 'Silenciar microfone' })).toHaveLength(1);
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByText('Silenciar microfone', { selector: 'span' })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
