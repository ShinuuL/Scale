import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCommunityEvents } from '../useCommunityEvents';

const mock = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => void>(), emit: vi.fn(), disconnect: vi.fn(), socket: { connected: true } }));
vi.mock('socket.io-client', () => ({ io: () => ({ ...mock.socket, on: (event: string, cb: (...args: unknown[]) => void) => mock.handlers.set(event, cb), emit: mock.emit, disconnect: mock.disconnect }) }));

describe('useCommunityEvents', () => {
  it('inscreve em cada conexão, restaura voz e limpa ao desmontar', () => {
    const onVoiceStates = vi.fn(); const onChanged = vi.fn();
    const { unmount } = renderHook(() => useCommunityEvents('community', { onVoiceStates, onChanged }));
    act(() => mock.handlers.get('connect')?.());
    expect(mock.emit).toHaveBeenCalledWith('community:subscribe', { communityId: 'community' }, expect.any(Function));
    const ack = mock.emit.mock.calls[0][2] as (data: unknown) => void;
    act(() => ack({ success: true, voiceStates: [] }));
    expect(onVoiceStates).toHaveBeenCalledWith([]); expect(onChanged).toHaveBeenCalledOnce();
    unmount();
    expect(mock.emit).toHaveBeenCalledWith('community:unsubscribe', { communityId: 'community' });
    expect(mock.disconnect).toHaveBeenCalled();
    act(() => ack({ success: true, voiceStates: [] }));
    expect(onChanged).toHaveBeenCalledOnce();
  });
});
