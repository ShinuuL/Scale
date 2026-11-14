import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ChannelThreadSummary } from '@scale/shared';
import { ChannelChat } from '../ChannelChat';
import { threadFooterLabel } from '../ThreadPanel';
import { api, type ChannelMessage } from '@/lib/api';
import { channelMessagesReducer, useChannelMessages } from '@/hooks/useChannelMessages';
import { threadBus } from '@/lib/threadEvents';

function message(id: string, extra: Partial<ChannelMessage> = {}): ChannelMessage {
  return {
    id,
    channelId: 'canal',
    author: { id: 'bia', name: 'Bia', username: null },
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
const thread = (extra: Partial<ChannelThreadSummary> = {}): ChannelThreadSummary => ({
  id: 't1',
  channelId: 'canal',
  rootMessageId: 'raiz',
  name: 'Plano',
  replyCount: 2,
  lastReplyAt: null,
  archivedAt: null,
  createdById: 'bia',
  ...extra,
});
function Harness({ canSend = true }: { canSend?: boolean }) {
  const { state, dispatch } = useChannelMessages('canal');
  return <ChannelChat channelId="canal" name="geral" meId="me" canManage={false} canSend={canSend} state={state} dispatch={dispatch} />;
}

describe('Fase 4: topicos', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('rotulo do rodape', () => {
    expect(threadFooterLabel({ replyCount: 1 })).toBe('1 resposta · Abrir tópico');
    expect(threadFooterLabel({ replyCount: 3 })).toBe('3 respostas · Abrir tópico');
  });

  it('reducer: mensagem de topico fica fora do canal e o evento atualiza a origem', () => {
    const state = { channelId: 'canal', cursor: null, loading: false, error: '', messages: [message('raiz')] };
    expect(channelMessagesReducer(state, { type: 'message', message: message('x', { threadId: 't1' }) })).toBe(state);
    const next = channelMessagesReducer(state, { type: 'thread', event: { channelId: 'canal', thread: thread({ replyCount: 5 }) } });
    expect(next.messages[0]?.thread?.replyCount).toBe(5);
  });

  it('abre o painel do topico existente, recebe em tempo real e envia pelo compositor proprio', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [message('raiz', { thread: thread() })], nextCursor: null });
    vi.spyOn(api, 'getChannelThread').mockResolvedValue({ thread: thread(), canSend: true, canManage: false });
    vi.spyOn(api, 'getThreadMessages').mockResolvedValue({ messages: [message('r1', { threadId: 't1', content: 'primeira' })], nextCursor: null });
    const send = vi.spyOn(api, 'sendThreadMessage').mockResolvedValue({ message: message('r2', { threadId: 't1', content: 'minha', author: { id: 'me', name: 'Ana', username: null } }) });
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir tópico Plano, 2 respostas' }));
    const panel = await screen.findByRole('complementary', { name: 'Tópico Plano' });
    expect(await screen.findByText('primeira')).toBeTruthy();
    act(() => threadBus.emit({ type: 'message', message: message('r3', { threadId: 't1', content: 'ao vivo' }) }));
    expect(screen.getByText('ao vivo')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Mensagem no tópico'), { target: { value: 'minha' } });
    fireEvent.click(panel.querySelector('button[type="submit"]')!);
    await waitFor(() => expect(send).toHaveBeenCalledWith('t1', 'minha'));
    expect(await screen.findByText('minha')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar tópico' }));
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('cria topico pelo dialogo; sem permissao de envio nao oferece', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [message('raiz')], nextCursor: null });
    const create = vi.spyOn(api, 'createChannelThread').mockResolvedValue({ thread: thread({ replyCount: 0, name: 'Novo' }) });
    vi.spyOn(api, 'getChannelThread').mockResolvedValue({ thread: thread({ replyCount: 0, name: 'Novo' }), canSend: true, canManage: false });
    vi.spyOn(api, 'getThreadMessages').mockResolvedValue({ messages: [], nextCursor: null });
    const { unmount } = render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir tópico a partir da mensagem de Bia' }));
    fireEvent.change(screen.getByLabelText('Nome do tópico'), { target: { value: 'Novo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abrir tópico' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('canal', 'raiz', 'Novo'));
    expect(await screen.findByRole('complementary', { name: 'Tópico Novo' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Abrir tópico Novo, 0 respostas' })).toBeTruthy();
    unmount();
    render(<Harness canSend={false} />);
    await screen.findByText('Texto raiz');
    expect(screen.queryByRole('button', { name: /Abrir tópico a partir/ })).toBeNull();
  });

  it('topico arquivado mostra aviso no lugar do compositor', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [message('raiz', { thread: thread({ archivedAt: 'ontem' }) })], nextCursor: null });
    vi.spyOn(api, 'getChannelThread').mockResolvedValue({ thread: thread({ archivedAt: 'ontem' }), canSend: false, canManage: true });
    vi.spyOn(api, 'getThreadMessages').mockResolvedValue({ messages: [], nextCursor: null });
    const archive = vi.spyOn(api, 'setThreadArchived').mockResolvedValue({ thread: thread() });
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir tópico Plano, 2 respostas, arquivado' }));
    expect(await screen.findByText('Tópico arquivado: não aceita novas mensagens.')).toBeTruthy();
    expect(screen.queryByLabelText('Mensagem no tópico')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Desarquivar tópico' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('t1', false));
  });
});
