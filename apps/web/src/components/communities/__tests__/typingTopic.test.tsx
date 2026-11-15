import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { formatTypingText } from '@scale/shared';
import { ChannelChat } from '../ChannelChat';
import { api } from '@/lib/api';
import { useChannelMessages } from '@/hooks/useChannelMessages';
import {
  TYPING_EXPIRE_MS,
  activeTypingNames,
  applyTypingEvent,
  createTypingSender,
  useChannelTyping,
} from '@/hooks/useChannelTyping';

const C = '11111111-1111-4111-8111-111111111111';
const CH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const event = (userId: string, name: string, typing = true) => ({ communityId: C, channelId: CH, userId, name, typing });

function Harness(props: { topic?: string | null; onSaveTopic?: (t: string) => Promise<void>; typingText?: string | null; onTyping?: (t: boolean) => void }) {
  const { state, dispatch } = useChannelMessages('canal');
  return <ChannelChat channelId="canal" name="geral" meId="me" canManage={false} state={state} dispatch={dispatch} {...props} />;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('texto do indicador', () => {
  it('um, dois e varios', () => {
    expect(formatTypingText([])).toBeNull();
    expect(formatTypingText(['Ana'])).toBe('Ana está digitando');
    expect(formatTypingText(['Ana', 'Bia'])).toBe('Ana e Bia estão digitando');
    expect(formatTypingText(['Ana', 'Bia', 'Caio'])).toBe('Várias pessoas estão digitando');
  });
});

describe('estado de digitando', () => {
  it('ignora a si mesmo, expira e remove na parada', () => {
    let entries = applyTypingEvent([], event('me', 'Eu'), 0);
    entries = applyTypingEvent(entries, event('u1', 'Ana'), 0);
    entries = applyTypingEvent(entries, event('u1', 'Ana'), 1000);
    expect(entries).toHaveLength(2);
    expect(activeTypingNames(entries, CH, 'me', 1000)).toEqual(['Ana']);
    expect(activeTypingNames(entries, CH, 'me', 1000 + TYPING_EXPIRE_MS)).toEqual([]);
    expect(activeTypingNames(applyTypingEvent(entries, event('u1', 'Ana', false), 1000), CH, 'me', 1000)).toEqual([]);
  });

  it('hook some com o texto apos ~6 s sem sinal', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useChannelTyping('me'));
    act(() => result.current.onTyping(event('u1', 'Ana')));
    expect(result.current.textFor(CH)).toBe('Ana está digitando');
    act(() => vi.advanceTimersByTime(TYPING_EXPIRE_MS + 1000));
    expect(result.current.textFor(CH)).toBeNull();
  });

  it('envio limitado a 1 a cada 3 s e parada unica', () => {
    let clock = 0;
    const emit = vi.fn();
    const sender = createTypingSender(emit, () => clock);
    sender.input('o');
    clock = 1000;
    sender.input('ol');
    clock = 3000;
    sender.input('ola');
    expect(emit.mock.calls).toEqual([[true], [true]]);
    sender.input('');
    sender.stop();
    expect(emit.mock.calls).toEqual([[true], [true], [false]]);
  });
});

describe('ChannelChat: digitando e topico', () => {
  it('mostra indicador em regiao polite e avisa digitacao/parada ao enviar', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [], nextCursor: null });
    vi.spyOn(api, 'sendChannelMessage').mockResolvedValue({
      message: { id: 'm1', channelId: 'canal', author: { id: 'me', name: 'Eu', username: null }, content: 'oi', createdAt: new Date().toISOString(), editedAt: null, files: [], deletedAt: null, replyTo: null, reactions: [], pinnedAt: null, pinnedById: null },
    } as Awaited<ReturnType<typeof api.sendChannelMessage>>);
    const onTyping = vi.fn();
    render(<Harness typingText="Ana está digitando" onTyping={onTyping} />);
    const live = screen.getByText('Ana está digitando');
    expect(live).toHaveAttribute('aria-live', 'polite');
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'o' } });
    fireEvent.change(input, { target: { value: 'oi' } });
    expect(onTyping.mock.calls).toEqual([[true]]);
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await waitFor(() => expect(onTyping.mock.calls).toEqual([[true], [false]]));
  });

  it('exibe topico truncado com dica e permite editar a quem gerencia', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [], nextCursor: null });
    const onSaveTopic = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(<Harness topic="Regras da casa" />);
    const shown = screen.getByText('Regras da casa');
    expect(shown).toHaveAttribute('title', 'Regras da casa');
    expect(shown).toHaveClass('truncate');
    expect(screen.queryByRole('button', { name: 'Editar tópico' })).not.toBeInTheDocument();
    rerender(<Harness topic="Regras da casa" onSaveTopic={onSaveTopic} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editar tópico' }));
    fireEvent.change(screen.getByLabelText('Tópico do canal'), { target: { value: '  Novo tópico ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSaveTopic).toHaveBeenCalledWith('Novo tópico'));
  });
});
