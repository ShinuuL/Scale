import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ChannelList, CommunityRail, unreadLabel } from '../CommunityParts';
import { CommunityView } from '../CommunityView';
import { api, type CommunityDetail } from '@/lib/api';

// Todos os sockets (comunidade e conta) compartilham os handlers do mock.
const handlers = new Map<string, Array<(payload: unknown) => void>>();
vi.mock('socket.io-client', () => ({
  io: () => {
    const sock = {
      connected: false,
      on: vi.fn((event: string, cb: (payload: unknown) => void) => {
        handlers.set(event, [...(handlers.get(event) ?? []), cb]);
        return sock;
      }),
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    return sock;
  },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
const fire = (event: string, payload: unknown) =>
  act(() => (handlers.get(event) ?? []).forEach((cb) => cb(payload)));

const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const T2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('unreadLabel', () => {
  it('singular, plural e teto', () => {
    expect(unreadLabel(1)).toBe('1 mensagem não lida');
    expect(unreadLabel(3)).toBe('3 mensagens não lidas');
    expect(unreadLabel(100)).toBe('mais de 99 mensagens não lidas');
  });
});

describe('UI de não lidas', () => {
  it('rail mostra contador e nome acessível', () => {
    render(
      <CommunityRail
        communities={[
          { id: 'a', name: 'Alfa', role: 'MEMBER', unread: 120 },
          { id: 'b', name: 'Beta', role: 'MEMBER', unread: 0 },
        ]}
        onSelect={() => undefined}
        onCreate={() => undefined}
        onJoin={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Alfa, mais de 99 mensagens não lidas' })).toHaveTextContent('99+');
    expect(screen.getByRole('button', { name: 'Beta' })).toBeInTheDocument();
    expect(screen.getAllByTestId('community-unread-badge')).toHaveLength(1);
  });

  it('canal com não lidas fica em negrito com contador; menu marca como lido', () => {
    const onMarkRead = vi.fn();
    render(
      <ChannelList
        name="Alfa"
        channels={[
          { id: 't1', name: 'geral', kind: 'TEXT', position: 0, unread: 3 },
          { id: 't2', name: 'off', kind: 'TEXT', position: 1, unread: 0 },
        ]}
        voiceStates={[]}
        onSelect={() => undefined}
        onInvite={() => undefined}
        onSettings={() => undefined}
        canManage={false}
        onMarkRead={onMarkRead}
      />,
    );
    const unread = screen.getByRole('button', { name: /geral/ });
    expect(unread).toHaveAccessibleName('geral 3 mensagens não lidas');
    expect(unread.className).toContain('font-semibold');
    expect(screen.getByRole('button', { name: 'off' }).className).not.toContain('font-semibold');
    fireEvent.click(screen.getByRole('button', { name: 'Menu da comunidade' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Marcar como lido' }));
    expect(onMarkRead).toHaveBeenCalled();
  });
});

describe('CommunityView: não lidas em tempo real', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    handlers.clear();
  });

  const detail = (): CommunityDetail => ({
    community: { id: C1, name: 'Alfa', ownerId: 'dono' },
    myRole: 'MEMBER',
    myPermissions: { manageChannels: false, manageInvites: false, manageMessages: false, kickMembers: false },
    roles: [],
    channels: [
      { id: T1, name: 'geral', kind: 'TEXT', position: 0, unread: 2 },
      { id: T2, name: 'off', kind: 'TEXT', position: 1, unread: 1 },
    ],
    members: [],
  });
  const message = (channelId: string, authorId: string) => ({
    id: crypto.randomUUID(),
    channelId,
    author: { id: authorId, name: authorId, username: null },
    content: 'oi',
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    files: [],
  });

  it('abre o canal como lido, conta nos outros e na outra comunidade', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList,
    );
    vi.spyOn(api, 'listCommunities').mockResolvedValue({
      communities: [
        { id: C1, name: 'Alfa', role: 'MEMBER', unread: 3 },
        { id: C2, name: 'Beta', role: 'MEMBER', unread: 0 },
      ],
    });
    vi.spyOn(api, 'getCommunity').mockResolvedValue(detail());
    vi.spyOn(api, 'getFriends').mockRejectedValue(new Error('x'));
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [], nextCursor: null });
    const markChannel = vi.spyOn(api, 'markChannelRead').mockResolvedValue();
    const markCommunity = vi.spyOn(api, 'markCommunityRead').mockResolvedValue();
    render(<CommunityView communityId={C1} channelId={T1} onNavigate={() => undefined} meId="eu" />);
    const rail = await screen.findByRole('navigation', { name: 'Comunidades' });
    // Canal aberto zera; sobra 1 no "off".
    await waitFor(() =>
      expect(within(rail).getByRole('button', { name: 'Alfa, 1 mensagem não lida' })).toBeInTheDocument(),
    );
    await waitFor(() => expect(markChannel).toHaveBeenCalledWith(T1));

    fire('channel:message', message(T2, 'outro'));
    fire('channel:message', message(T2, 'eu'));
    fire('channel:message', message(T1, 'outro'));
    expect(screen.getAllByRole('button', { name: /off/ })[0]).toHaveAccessibleName('off 2 mensagens não lidas');
    expect(within(rail).getByRole('button', { name: 'Alfa, 2 mensagens não lidas' })).toBeInTheDocument();

    // Outra comunidade: aviso leve em user:<id>; a aberta e as proprias nao contam de novo.
    fire('community:activity', { communityId: C2, channelId: T1, authorId: 'outro' });
    fire('community:activity', { communityId: C2, channelId: T1, authorId: 'eu' });
    fire('community:activity', { communityId: C1, channelId: T2, authorId: 'outro' });
    expect(within(rail).getByRole('button', { name: 'Beta, 1 mensagem não lida' })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: 'Alfa, 2 mensagens não lidas' })).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Menu da comunidade' })[0]);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Marcar como lido' }));
    expect(markCommunity).toHaveBeenCalledWith(C1);
    expect(within(rail).getByRole('button', { name: 'Alfa' })).toBeInTheDocument();
  });
});
