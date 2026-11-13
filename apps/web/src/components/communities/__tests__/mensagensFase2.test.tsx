import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChannelChat } from '../ChannelChat';
import { reactionLabel } from '../MessageExtras';
import { api, type ChannelMessage } from '@/lib/api';
import { applyReaction, channelMessagesReducer, useChannelMessages } from '@/hooks/useChannelMessages';

function message(id: string, authorId: string, extra: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id,
    channelId: 'canal',
    author: { id: authorId, name: authorId === 'me' ? 'Ana' : 'Bia', username: null },
    content: `Texto ${id}`,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
    files: [],
    replyTo: null,
    reactions: [],
    pinnedAt: null,
    pinnedById: null,
    ...extra,
  };
}
function Harness({ canManage = false }: { canManage?: boolean }) {
  const { state, dispatch } = useChannelMessages('canal');
  return <ChannelChat channelId="canal" name="geral" meId="me" canManage={canManage} state={state} dispatch={dispatch} />;
}

describe('Fase 2: responder, reagir e fixar', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('nome acessivel da reacao', () => {
    expect(reactionLabel('like', 3, true)).toBe('Curtir, 3 reações, você reagiu');
    expect(reactionLabel('heart', 1, false)).toBe('Coração, 1 reação');
  });

  it('reducer aplica reacao na ordem fixa e remove quando ninguem reagiu', () => {
    expect(applyReaction([{ reaction: 'star', userIds: ['a'] }], { channelId: 'c', messageId: 'm', reaction: 'like', userIds: ['b'] })).toEqual([
      { reaction: 'like', userIds: ['b'] },
      { reaction: 'star', userIds: ['a'] },
    ]);
    expect(applyReaction([{ reaction: 'like', userIds: ['a'] }], { channelId: 'c', messageId: 'm', reaction: 'like', userIds: [] })).toEqual([]);
    const state = { channelId: 'canal', cursor: null, loading: false, error: '', messages: [message('1', 'me')] };
    const pinned = channelMessagesReducer(state, { type: 'pin', event: { channelId: 'canal', messageId: '1', pinnedAt: 'agora', pinnedById: 'me' } });
    expect(pinned.messages[0]?.pinnedAt).toBe('agora');
  });

  it('responde com citacao: composer mostra "Respondendo a", cancela e envia com replyToId', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({
      messages: [message('orig', 'friend'), message('resp', 'me', { replyTo: { id: 'sumiu', authorName: '', excerpt: '', deleted: true } })],
      nextCursor: null,
    });
    const send = vi.spyOn(api, 'sendChannelMessage').mockResolvedValue({
      message: message('nova', 'me', { replyTo: { id: 'orig', authorName: 'Bia', excerpt: 'Texto orig', deleted: false } }),
    });
    render(<Harness />);
    expect(await screen.findByText('Resposta a uma mensagem apagada')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Responder a Bia' }));
    expect(screen.getByText(/Respondendo a/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar resposta' }));
    expect(screen.queryByText(/Respondendo a/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Responder a Bia' }));
    const input = screen.getByLabelText('Mensagem');
    fireEvent.change(input, { target: { value: 'Concordo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledWith('canal', 'Concordo', 'orig'));
    const quote = await screen.findByRole('button', { name: 'Resposta a Bia: Texto orig. Ir para a mensagem original' });
    const target = document.getElementById('channel-message-orig')!;
    target.scrollIntoView = vi.fn();
    fireEvent.click(quote);
    expect(target.scrollIntoView).toHaveBeenCalled();
  });

  it('reacao: contagem, "voce reagiu" e toggle pelo seletor', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({
      messages: [message('m', 'friend', { reactions: [{ reaction: 'like', userIds: ['me', 'x', 'y'] }] })],
      nextCursor: null,
    });
    const toggle = vi.spyOn(api, 'toggleChannelReaction').mockResolvedValue({ channelId: 'canal', messageId: 'm', reaction: 'heart', userIds: ['me'] });
    render(<Harness />);
    const like = await screen.findByRole('button', { name: 'Curtir, 3 reações, você reagiu' });
    expect(like).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar reação' }));
    fireEvent.click(screen.getByRole('button', { name: 'Coração' }));
    await waitFor(() => expect(toggle).toHaveBeenCalledWith('canal', 'm', 'heart'));
    expect(await screen.findByRole('button', { name: 'Coração, 1 reação, você reagiu' })).toBeTruthy();
  });

  it('fixar so com manageMessages; painel lista as fixadas', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [message('m', 'friend')], nextCursor: null });
    const pin = vi.spyOn(api, 'setChannelPin').mockResolvedValue({ channelId: 'canal', messageId: 'm', pinnedAt: new Date().toISOString(), pinnedById: 'me' });
    vi.spyOn(api, 'getChannelPins').mockResolvedValue({ messages: [message('m', 'friend', { pinnedAt: new Date().toISOString() })] });
    const { unmount } = render(<Harness />);
    await screen.findByText('Texto m');
    expect(screen.queryByRole('button', { name: 'Fixar mensagem de Bia' })).toBeNull();
    unmount();
    render(<Harness canManage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Fixar mensagem de Bia' }));
    await waitFor(() => expect(pin).toHaveBeenCalledWith('canal', 'm', true));
    expect(await screen.findByRole('button', { name: 'Desafixar mensagem de Bia' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mensagens fixadas' }));
    expect(await screen.findByRole('button', { name: 'Ir para a mensagem de Bia' })).toBeTruthy();
  });
});
