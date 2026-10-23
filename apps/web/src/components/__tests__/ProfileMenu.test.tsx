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

  it('Configurações abre o diálogo com o tema e Esc devolve o foco ao gatilho', () => {
    render(<ProfileMenu name="Ana" isAuthenticated={false} />);
    const trigger = screen.getByRole('button', { name: 'Perfil de Ana' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configurações' }));
    expect(screen.queryByRole('menu')).toBeNull();
    const dialog = screen.getByRole('dialog', { name: 'Configurações' });

    fireEvent.click(screen.getByRole('radio', { name: 'Tema Safira' }));
    expect(document.documentElement.getAttribute('data-palette')).toBe('safira');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('safira');
    // Convidado: sem edição de perfil.
    expect(screen.queryByLabelText('Nome de usuário')).toBeNull();

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('clique fora do diálogo de Configurações fecha', () => {
    render(<ProfileMenu name="Ana" isAuthenticated={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configurações' }));
    const dialog = screen.getByRole('dialog', { name: 'Configurações' });
    // Portal no body: o fundo nao fica preso dentro do header.
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.mouseDown(dialog.parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('logado edita o nome nas Configurações', () => {
    const user = { id: 'u1', email: 'ana@exemplo.com', name: 'Ana', createdAt: '2026-01-01', avatarUpdatedAt: null };
    render(<ProfileMenu name="Ana" email={user.email} isAuthenticated user={user} />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Configurações' }));
    const input = screen.getByLabelText('Nome de usuário') as HTMLInputElement;
    expect(input.value).toBe('Ana');
    const save = screen.getByRole('button', { name: 'Salvar nome' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Shinuu' } });
    expect(save.disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Enviar foto' })).toBeTruthy();
  });

  it('setas navegam entre os itens', () => {
    render(<ProfileMenu name="Ana" isAuthenticated={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    const menu = screen.getByRole('menu');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Configurações' }));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Entrar' }));
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
