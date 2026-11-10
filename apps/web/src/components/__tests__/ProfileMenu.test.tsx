import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { PALETTE_STORAGE_KEY } from '@/lib/theme';
import { api } from '@/lib/api';

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

describe('ProfileMenu: sair da conta', () => {
  const assign = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    assign.mockReset();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, assign },
    });
    delete document.documentElement.dataset.scaleCallActive;
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    vi.restoreAllMocks();
  });

  function openMenu(authed = true) {
    render(<ProfileMenu name="Ana" email="ana@exemplo.com" isAuthenticated={authed} />);
    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
  }

  it('convidado não vê Sair da conta', () => {
    openMenu(false);
    expect(screen.queryByRole('menuitem', { name: 'Sair da conta' })).toBeNull();
  });

  it('fora de chamada sai direto: encerra a sessão e recarrega no início', async () => {
    const logout = vi.spyOn(api, 'logout').mockResolvedValue();
    const endCall = vi.fn();
    window.addEventListener('scale:end-call', endCall);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sair da conta' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
    expect(logout).toHaveBeenCalledOnce();
    expect(endCall).toHaveBeenCalledOnce();
    window.removeEventListener('scale:end-call', endCall);
  });

  it('em chamada pede confirmação; continuar não sai', async () => {
    document.documentElement.dataset.scaleCallActive = 'true';
    const logout = vi.spyOn(api, 'logout').mockResolvedValue();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sair da conta' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sair da conta?' });
    expect(dialog).toHaveTextContent('a chamada é encerrada');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar na chamada' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(logout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Perfil de Ana' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sair da conta' }));
    const again = await screen.findByRole('dialog', { name: 'Sair da conta?' });
    fireEvent.click(within(again).getByRole('button', { name: 'Sair da conta' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/'));
  });

  it('falha do servidor avisa e mantém na página', async () => {
    vi.spyOn(api, 'logout').mockRejectedValue(new Error('HTTP 503'));
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sair da conta' }));
    expect(await screen.findByRole('dialog', { name: 'Não foi possível sair' })).toBeInTheDocument();
    expect(assign).not.toHaveBeenCalled();
  });
});
