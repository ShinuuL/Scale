import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon, ICONS, type IconName } from '@/components/ui/Icon';

// Contrato do componente de ícones: acessibilidade (decorativo vs rótulo),
// forma consistente do SVG e catálogo fechado de nomes.
describe('Icon', () => {
  it('sem `title` é decorativo: aria-hidden + focusable=false, sem role', () => {
    const { container } = render(<Icon name="mic" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
    expect(svg).not.toHaveAttribute('role');
    expect(svg).not.toHaveAttribute('aria-label');
  });

  it('com `title` vira rótulo em PT-BR: role=img + aria-label, sem aria-hidden', () => {
    render(<Icon name="micOff" title="Mudo" />);
    const img = screen.getByRole('img', { name: 'Mudo' });
    expect(img.tagName.toLowerCase()).toBe('svg');
    expect(img).not.toHaveAttribute('aria-hidden');
  });

  it('default 16px; `size` sobrescreve largura e altura juntas', () => {
    const { container: a } = render(<Icon name="check" />);
    expect(a.querySelector('svg')).toHaveAttribute('width', '16');
    expect(a.querySelector('svg')).toHaveAttribute('height', '16');

    const { container: b } = render(<Icon name="users" size={48} />);
    expect(b.querySelector('svg')).toHaveAttribute('width', '48');
    expect(b.querySelector('svg')).toHaveAttribute('height', '48');
  });

  it('desenha na mesma grade: viewBox 24x24, strokeWidth 1.75, currentColor', () => {
    const { container } = render(<Icon name="link" />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svg).toHaveAttribute('stroke-width', '1.75');
    expect(svg).toHaveAttribute('stroke', 'currentColor');
    expect(svg).toHaveAttribute('stroke-linecap', 'round');
    expect(svg).toHaveAttribute('stroke-linejoin', 'round');
  });

  it('só os ícones de estado "ligado" (mic, speaker) e a marca do GitHub usam preenchimento sólido', () => {
    const filled = (name: IconName) =>
      ICONS[name].filter((shape) => shape.filled).length;
    expect(filled('mic')).toBe(1);
    expect(filled('speaker')).toBe(1);
    // Marca de terceiro: a silhueta oficial e solida (nao e estado "ligado").
    expect(filled('github')).toBe(1);
    expect(filled('google')).toBe(1);

    const rest = Object.keys(ICONS).filter(
      (name) => name !== 'mic' && name !== 'speaker' && name !== 'github' && name !== 'google',
    ) as IconName[];
    for (const name of rest) {
      expect(filled(name), `${name} não deveria ter forma preenchida`).toBe(0);
    }
  });

  it('todo ícone do catálogo tem pelo menos um path com `d` não vazio', () => {
    for (const [name, shapes] of Object.entries(ICONS)) {
      expect(shapes.length, `${name} sem geometria`).toBeGreaterThan(0);
      for (const shape of shapes) {
        expect(shape.d.trim().length, `${name} com path vazio`).toBeGreaterThan(0);
      }
    }
  });
});
