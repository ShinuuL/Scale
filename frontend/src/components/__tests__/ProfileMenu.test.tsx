import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { PALETTE_STORAGE_KEY } from '@/lib/theme';

describe('ProfileMenu', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
  });

  it('abre pelo gatilho e fecha com Esc devolvendo o foco', () => {
    render(<ProfileMenu name="Ana" isAuthenticated={false} />);
    const trigger = screen.getByRole('button', { name: 'Perfil de Ana' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = screen.getByRole('menu', { name: 'Menu do perfil' });

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('fecha com clique fora', () => {
    render(
      <div>
        <ProfileMenu name="Ana" isAuthenticated={false} />
        <p>fora</p>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    fireEvent.pointerDown(screen.getByText('fora'));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('troca o tema e fecha o menu', () => {
    render(<ProfileMenu name="Ana" isAuthenticated={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Safira' }));
    expect(document.documentElement.getAttribute('data-palette')).toBe('safira');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('safira');
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    expect(screen.getByRole('menuitemradio', { name: 'Safira' }).getAttribute('aria-checked')).toBe('true');
  });

  it('setas navegam entre os itens', () => {
    render(<ProfileMenu name="Ana" isAuthenticated={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    const menu = screen.getByRole('menu');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Jade' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Grafite' }));
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Criar conta' }));
  });

  it('convidado vê "Convidado", Entrar e Criar conta', () => {
    render(<ProfileMenu name="Guest-ab12" isAuthenticated={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Guest-ab12' }));
    expect(screen.getByText('Convidado')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Entrar' }).getAttribute('href')).toBe('/login');
    expect(screen.getByRole('menuitem', { name: 'Criar conta' }).getAttribute('href')).toBe('/register');
  });

  it('logado mostra o e-mail e não oferece Entrar', () => {
    render(<ProfileMenu name="Ana" email="ana@exemplo.com" isAuthenticated />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    expect(screen.getByText('ana@exemplo.com')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Entrar' })).toBeNull();
  });
});

describe('ProfileMenu sem nome de convidado', () => {
  it('não repete "Convidado" no subtítulo', () => {
    render(<ProfileMenu name="Convidado" isAuthenticated={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Convidado' }));
    expect(screen.getByText('Sem conta conectada')).toBeTruthy();
  });
});
