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

  it('entrega presenca inicial, transicoes da propria comunidade e falando', () => {
    mock.emit.mockClear();
    const onOnlineUsers = vi.fn(); const onPresence = vi.fn(); const onVoiceSpeaking = vi.fn();
    const id = '11111111-1111-4111-8111-111111111111';
    const channelId = '22222222-2222-4222-8222-222222222222';
    renderHook(() => useCommunityEvents(id, { onOnlineUsers, onPresence, onVoiceSpeaking }));
    act(() => mock.handlers.get('connect')?.());
    const ack = mock.emit.mock.calls[0][2] as (data: unknown) => void;
    act(() => ack({ success: true, voiceStates: [], onlineUserIds: ['u1'] }));
    expect(onOnlineUsers).toHaveBeenCalledWith(['u1']);
    act(() => mock.handlers.get('community:presence')?.({ communityId: id, userId: 'u2', online: true }));
    act(() => mock.handlers.get('community:presence')?.({ communityId: '33333333-3333-4333-8333-333333333333', userId: 'u3', online: true }));
    expect(onPresence).toHaveBeenCalledTimes(1);
    act(() => mock.handlers.get('community:voice-speaking')?.({ channelId, userId: 'u1', speaking: true }));
    act(() => mock.handlers.get('community:voice-speaking')?.({ channelId: 'x', userId: 'u1', speaking: true }));
    expect(onVoiceSpeaking).toHaveBeenCalledTimes(1);
  });
});
