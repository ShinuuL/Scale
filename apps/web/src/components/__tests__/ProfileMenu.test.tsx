import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { PALETTE_STORAGE_KEY } from '@/lib/theme';

describe('ProfileMenu', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-palette');
  });

  it('abre pelo gatilho e fecha com Esc devolvendo o foco', async () => {
    render(<ProfileMenu name="Ana" isAuthenticated={false} />);
    const trigger = screen.getByRole('button', { name: 'Perfil de Ana' });
    // react-aria marca o botão de menu com aria-haspopup="true" (equivale a menu).
    expect(trigger.getAttribute('aria-haspopup')).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    // react-aria nomeia o menu pelo gatilho (aria-labelledby).
    const menu = screen.getByRole('menu', { name: /Perfil de Ana/ });

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('fecha com clique fora', () => {
    render(
      <div>
        <ProfileMenu name="Ana" isAuthenticated={false} />
        <p>fora</p>
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    expect(screen.getByRole('menu')).toBeTruthy();
    // react-aria fecha no par mousedown/mouseup fora do menu (jsdom sem PointerEvent).
    const outside = screen.getByText('fora');
    fireEvent.mouseDown(outside, { button: 0 });
    fireEvent.mouseUp(outside, { button: 0 });
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

  it('setas navegam entre os itens', async () => {
    render(<ProfileMenu name="Ana" isAuthenticated={false} />);
    const trigger = screen.getByRole('button', { name: 'Perfil de Ana' });
    // Aberto pelo teclado, o foco vai para o primeiro item.
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const menu = screen.getByRole('menu');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Configurações' })),
    );
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
