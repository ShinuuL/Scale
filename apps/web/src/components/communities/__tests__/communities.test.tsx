import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChannelChat } from '../ChannelChat';
import { ChannelList } from '../CommunityParts';
import { api, type ChannelMessage } from '@/lib/api';
import { useChannelMessages } from '@/hooks/useChannelMessages';

const now = Date.now();
function message(
  id: string,
  authorId: string,
  age: number,
  deletedAt: string | null = null,
): ChannelMessage {
  return {
    id,
    channelId: 'canal',
    author: { id: authorId, name: authorId === 'me' ? 'Ana' : 'Bia', username: null },
    content: `Texto ${id}`,
    createdAt: new Date(now - age).toISOString(),
    editedAt: null,
    files: [],
    replyTo: null,
    reactions: [],
    pinnedAt: null,
    pinnedById: null,
    deletedAt,
  };
}
function ChatHarness({ canManage = false }: { canManage?: boolean }) {
  const { state, dispatch } = useChannelMessages('canal');
  return (
    <ChannelChat
      channelId="canal"
      name="geral"
      meId="me"
      canManage={canManage}
      state={state}
      dispatch={dispatch}
    />
  );
}
function chat(canManage = false) {
  return <ChatHarness canManage={canManage} />;
}

describe('Comunidades: permissões e chat', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('oculta configurações para MEMBER, mas permite convite e saída', () => {
    render(
      <ChannelList
        name="Grupo"
        channels={[]}
        voiceStates={[]}
        canManage={false}
        onSelect={() => {}}
        onInvite={() => {}}
        onSettings={() => {}}
        onLeave={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Configurações da comunidade' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Menu da comunidade' }));
    expect(screen.getByRole('menuitem', { name: 'Convidar' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Sair da comunidade' })).toBeTruthy();
  });

  it('permite editar apenas mensagem própria dentro da janela de 15 minutos', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({
      messages: [
        message('recente', 'me', 1000),
        message('antiga', 'me', 16 * 60 * 1000),
        message('outra', 'friend', 1000),
      ],
      nextCursor: null,
    });
    const edit = vi.spyOn(api, 'editChannelMessage').mockResolvedValue();
    render(chat());
    expect(await screen.findByText('Texto recente')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Editar mensagem de Ana' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Editar mensagem de Bia' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Editar mensagem de Ana' }));
    fireEvent.change(screen.getByLabelText('Editar mensagem'), {
      target: { value: 'Texto corrigido' },
    });
    fireEvent.keyDown(screen.getByLabelText('Editar mensagem'), { key: 'Enter' });
    await waitFor(() => expect(edit).toHaveBeenCalledWith('canal', 'recente', 'Texto corrigido'));
    expect(await screen.findByText('Texto corrigido')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Editar mensagem de Ana' }));
    fireEvent.keyDown(screen.getByLabelText('Editar mensagem'), { key: 'Escape' });
    expect(screen.queryByLabelText('Editar mensagem')).toBeNull();
  });

  it('MEMBER só apaga mensagem própria, mediante confirmação; conteúdo apagado não aparece', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({
      messages: [
        message('propria', 'me', 1000),
        message('outra', 'friend', 1000),
        message('apagada', 'friend', 1000, new Date().toISOString()),
      ],
      nextCursor: null,
    });
    const remove = vi.spyOn(api, 'deleteChannelMessage').mockResolvedValue();
    render(chat());
    expect(await screen.findByText('Texto propria')).toBeTruthy();
    expect(screen.queryByText('Texto apagada')).toBeNull();
    expect(screen.getByText('[mensagem apagada]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Apagar mensagem de Bia' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar mensagem de Ana' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar mensagem' }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('canal', 'propria'));
    // A previa do dialogo de confirmacao pode seguir no DOM durante a animacao de saida.
    await waitFor(() => expect(screen.queryAllByText('Texto propria')).toHaveLength(0));
  });

  it('envia com Enter e preserva Shift+Enter, com log rotulado', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [], nextCursor: null });
    const send = vi
      .spyOn(api, 'sendChannelMessage')
      .mockResolvedValue({ message: message('nova', 'me', 0) });
    render(chat());
    const input = await screen.findByLabelText('Mensagem');
    expect(screen.getByRole('log', { name: 'Mensagens' })).toHaveAttribute('aria-live', 'polite');
    fireEvent.change(input, { target: { value: 'Olá' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledWith('canal', 'Olá'));
  });

  it('ADMIN pode apagar mensagem de outro membro', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({
      messages: [message('outra', 'friend', 1000)],
      nextCursor: null,
    });
    render(chat(true));
    expect(await screen.findByRole('button', { name: 'Apagar mensagem de Bia' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Editar mensagem de Bia' })).toBeNull();
  });
});
