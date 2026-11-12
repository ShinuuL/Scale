import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { ChannelList } from '../CommunityParts';
import {
  START_CALL_EVENT,
  callScreenPath,
  setActiveCall,
  startBackgroundCall,
  useActiveCall,
} from '@/lib/callControl';

const channels = [
  { id: 't1', name: 'Inicio', kind: 'TEXT' as const, position: 0 },
  { id: 'v1', name: 'Sala de voz', kind: 'VOICE' as const, position: 1 },
];

function renderList(props: Partial<Parameters<typeof ChannelList>[0]> = {}) {
  const onSelect = vi.fn();
  const onOpenCall = vi.fn();
  render(
    <ChannelList
      name="Anti-FrontEnd"
      channels={channels}
      selected="t1"
      voiceStates={[
        { channelId: 'v1', members: [{ userId: 'u1', name: 'Shinuu' }] },
      ] as never}
      onSelect={onSelect}
      onInvite={() => undefined}
      onSettings={() => undefined}
      canManage={false}
      onOpenCall={onOpenCall}
      {...props}
    />,
  );
  return { onSelect, onOpenCall };
}

describe('canal de voz estilo Discord', () => {
  it('lista quem está conectado embaixo do canal', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'Conectados em Sala de voz' });
    expect(list).toHaveTextContent('Shinuu');
  });

  it('clicar no canal pede entrada sem abrir a tela da chamada', () => {
    const { onSelect, onOpenCall } = renderList();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar no canal de voz Sala de voz' }));
    expect(onSelect).toHaveBeenCalledWith(channels[1]);
    expect(onOpenCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Abrir chamada de Sala de voz' })).toBeNull();
  });

  it('no canal ativo mostra o estado e o botão para abrir a chamada', () => {
    const { onOpenCall } = renderList({ activeVoiceId: 'v1', activeVoiceJoined: true });
    expect(screen.getByRole('button', { name: 'Sala de voz, conectado' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chamada de Sala de voz' }));
    expect(onOpenCall).toHaveBeenCalledWith(channels[1]);
  });
});

describe('callControl', () => {
  it('dispara o pedido de chamada em segundo plano', () => {
    const listener = vi.fn();
    window.addEventListener(START_CALL_EVENT, listener);
    startBackgroundCall({ roomId: 'v1', communityId: 'c1' });
    window.removeEventListener(START_CALL_EVENT, listener);
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      roomId: 'v1',
      communityId: 'c1',
    });
  });

  it('publica a chamada ativa para as telas', () => {
    const { result } = renderHook(() => useActiveCall());
    expect(result.current).toBeNull();
    act(() => setActiveCall({ roomId: 'v1', joined: true }));
    expect(result.current).toEqual({ roomId: 'v1', joined: true });
    act(() => setActiveCall(null));
    expect(result.current).toBeNull();
  });

  it('monta o link da tela da chamada com a comunidade', () => {
    expect(callScreenPath('v1', 'c1')).toBe('/room?id=v1&c=c1');
    expect(callScreenPath('v1')).toBe('/room?id=v1');
  });
});
