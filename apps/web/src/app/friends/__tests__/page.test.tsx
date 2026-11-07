import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FriendsPage from '../page';
import { api, type MeUser } from '@/lib/api';

vi.mock('@/hooks/useUserEvents', () => ({ useUserEvents: vi.fn() }));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children, contextSidebar }: { children: ReactNode; contextSidebar?: ReactNode }) => (
    <main>
      <aside aria-label="Painel lateral">{contextSidebar}</aside>
      <div>{children}</div>
    </main>
  ),
}));
vi.mock('@/components/ui/ProfileMenu', () => ({
  ProfileMenu: () => <button type="button">Minha conta</button>,
}));

const me: MeUser = {
  id: 'ana',
  name: 'Ana',
  username: 'ana',
  email: 'ana@example.test',
  createdAt: '2026-11-06T10:00:00.000Z',
};
const friend = { id: 'bia', name: 'Bia', username: 'bia', avatarUpdatedAt: null };
const empty = { friends: [], incoming: [], outgoing: [] };

describe('amigos e conversas', () => {
  it('preserva ligação pelo painel e pela conversa, com erro acessível e recuperação', async () => {
    vi.spyOn(api, 'getFriends').mockResolvedValue({ ...empty, friends: [friend] });
    vi.spyOn(api, 'getDirectMessages').mockResolvedValue({ messages: [], hasMore: false });
    const startCall = vi.spyOn(api, 'startCall').mockRejectedValue({ status: 429 });
    render(<FriendsPage />);
    const sidebar = screen.getByRole('complementary', { name: 'Painel lateral' });
    fireEvent.click(await within(sidebar).findByRole('button', { name: 'Ligar para Bia' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas ligações seguidas');
    expect(startCall).toHaveBeenCalledWith('bia');
    expect(within(sidebar).getByRole('button', { name: 'Ligar para Bia' })).toBeEnabled();

    fireEvent.click(await screen.findByRole('button', { name: /Abrir conversa com Bia/ }));
    const conversation = await screen.findByRole('region', { name: 'Conversa com Bia' });
    startCall.mockRejectedValueOnce({ status: 503 });
    fireEvent.click(within(conversation).getByRole('button', { name: 'Ligar para Bia' }));
    await waitFor(() => expect(startCall).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível ligar agora.');
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: me });
  });

  it('erro ao carregar amigos não vira lista vazia e permite recuperar', async () => {
    const getFriends = vi
      .spyOn(api, 'getFriends')
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce({ ...empty, friends: [friend] });
    render(<FriendsPage />);
    expect(
      await screen.findByText('Não foi possível carregar seus amigos e pedidos.'),
    ).toBeTruthy();
    expect(screen.queryByText('Você não tem pedidos pendentes.')).toBeNull();
    expect(screen.queryByText(/Quando seu pedido for aceito/)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Tentar novamente' })[0]);
    await waitFor(() => expect(getFriends).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: /Abrir conversa com Bia/ })).toBeTruthy();
  });

  it('falha da conta não é apresentada como visitante sem sessão', async () => {
    vi.spyOn(api, 'getMe')
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ user: me });
    vi.spyOn(api, 'getFriends').mockResolvedValue(empty);
    render(<FriendsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sua conta não carregou');
    expect(screen.queryByRole('link', { name: 'Entrar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Você não tem pedidos pendentes.')).toBeTruthy();
  });

  it('abre uma conversa sem inventar presença e sinaliza pedidos reais', async () => {
    vi.spyOn(api, 'getFriends').mockResolvedValue({
      ...empty,
      friends: [friend],
      incoming: [
        {
          id: 'request-1',
          createdAt: '2026-11-06T10:00:00.000Z',
          user: { ...friend, id: 'carol', name: 'Carol', username: 'carol' },
        },
      ],
    });
    vi.spyOn(api, 'getDirectMessages').mockResolvedValue({ messages: [], hasMore: false });
    render(<FriendsPage />);
    expect(await screen.findByLabelText('1 pedidos recebidos')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: /Abrir conversa com Bia/ }));
    const conversation = await screen.findByRole('region', { name: 'Conversa com Bia' });
    expect(within(conversation).getByRole('heading', { name: 'Bia' })).toBeTruthy();
    expect(screen.queryByText(/online/i)).toBeNull();
  });
});
