import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCallKeepAlive, resumePausedAudio } from '@/hooks/useCallKeepAlive';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

describe('useCallKeepAlive', () => {
  const release = vi.fn(() => Promise.resolve());
  const request = vi.fn();
  const handlers = new Map<string, (() => void) | null>();

  beforeEach(() => {
    setVisibility('visible');
    release.mockClear();
    request.mockReset();
    request.mockImplementation(() => {
      const s = {
        released: false,
        release: () => {
          s.released = true;
          return release();
        },
      };
      return Promise.resolve(s);
    });
    handlers.clear();
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: {
        metadata: null,
        setActionHandler: (a: string, h: (() => void) | null) => {
          handlers.set(a, h);
        },
      },
    });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(public init: { title: string }) {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(navigator, 'mediaSession');
    document.body.innerHTML = '';
  });

  it('não pede wake lock fora da chamada', () => {
    renderHook(() => useCallKeepAlive({ active: false, roomName: 'Sala' }));
    expect(request).not.toHaveBeenCalled();
  });

  it('pede wake lock, re-pede ao voltar visível e libera ao sair', async () => {
    const { unmount } = renderHook(() => useCallKeepAlive({ active: true, roomName: 'Sala' }));
    await act(async () => {});
    expect(request).toHaveBeenCalledWith('screen');
    unmount();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('re-pede wake lock quando o anterior foi liberado e a aba volta', async () => {
    renderHook(() => useCallKeepAlive({ active: true, roomName: 'Sala' }));
    await act(async () => {});
    const s = (await request.mock.results[0]!.value) as { released: boolean };
    s.released = true;
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('registra metadata e ações da Media Session e limpa no fim', () => {
    const hangup = vi.fn();
    const mic = vi.fn();
    const { unmount } = renderHook(() =>
      useCallKeepAlive({
        active: true,
        roomName: 'Minha sala',
        onHangup: hangup,
        onToggleMicrophone: mic,
      }),
    );
    const ms = navigator.mediaSession as unknown as {
      metadata: { init: { title: string } } | null;
    };
    expect(ms.metadata?.init.title).toBe('Minha sala');
    handlers.get('hangup')?.();
    handlers.get('togglemicrophone')?.();
    expect(hangup).toHaveBeenCalled();
    expect(mic).toHaveBeenCalled();
    unmount();
    expect(handlers.get('hangup')).toBeNull();
    expect(ms.metadata).toBeNull();
  });

  it('funciona sem as APIs (feature detection)', () => {
    Reflect.deleteProperty(navigator, 'wakeLock');
    Reflect.deleteProperty(navigator, 'mediaSession');
    expect(() =>
      renderHook(() => useCallKeepAlive({ active: true, roomName: 'Sala', onHangup: () => {} })),
    ).not.toThrow();
  });
});

describe('resumePausedAudio', () => {
  it('chama play só nos <audio> pausados', () => {
    const a = document.createElement('audio');
    const b = document.createElement('audio');
    document.body.append(a, b);
    Object.defineProperty(a, 'paused', { value: true });
    Object.defineProperty(b, 'paused', { value: false });
    const playA = vi.fn(() => Promise.reject(new Error('blocked')));
    const playB = vi.fn(() => Promise.resolve());
    a.play = playA;
    b.play = playB;
    resumePausedAudio();
    expect(playA).toHaveBeenCalled();
    expect(playB).not.toHaveBeenCalled();
  });
});
