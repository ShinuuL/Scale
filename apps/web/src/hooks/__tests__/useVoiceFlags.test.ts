import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io-client';
import { createSpeakingThrottle, useVoiceFlags } from '../useVoiceFlags';

afterEach(() => vi.useRealTimers());

describe('createSpeakingThrottle', () => {
  it('envia so transicoes e no maximo uma por intervalo, com o ultimo valor', () => {
    vi.useFakeTimers();
    const send = vi.fn();
    const throttle = createSpeakingThrottle(send, 400, () => Date.now());
    throttle.update(false);
    expect(send).not.toHaveBeenCalled();
    throttle.update(true);
    expect(send).toHaveBeenLastCalledWith(true);
    throttle.update(false);
    throttle.update(true);
    throttle.update(false);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(400);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(false);
    throttle.update(true);
    throttle.update(false);
    vi.advanceTimersByTime(400);
    // Voltou ao valor ja enviado dentro da janela: nada sai.
    expect(send).toHaveBeenCalledTimes(2);
    throttle.dispose();
  });
});

describe('useVoiceFlags', () => {
  it('publica deafen e tela so depois de entrar na sala', () => {
    const emit = vi.fn();
    const socket = { connected: true, emit } as unknown as Socket;
    const roomId = '11111111-1111-4111-8111-111111111111';
    const { rerender } = renderHook(
      ({ joined, deafened }) => useVoiceFlags(socket, roomId, joined, { deafened, screenSharing: false, speaking: false }),
      { initialProps: { joined: false, deafened: false } },
    );
    expect(emit).not.toHaveBeenCalled();
    rerender({ joined: true, deafened: false });
    expect(emit).toHaveBeenCalledWith('peer:voice-flags', { roomId, deafened: false, screenSharing: false }, expect.any(Function));
    rerender({ joined: true, deafened: true });
    expect(emit).toHaveBeenLastCalledWith('peer:voice-flags', { roomId, deafened: true, screenSharing: false }, expect.any(Function));
  });
});
