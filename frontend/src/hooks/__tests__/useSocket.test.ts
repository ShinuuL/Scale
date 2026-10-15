import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useSocket } from '@/hooks/useSocket';

// ─── Mock socket.io-client ─────────────────────────────────────
// O socket é recriado a cada chamada de io() (um por render do teste), então
// os vi.fn() internos nascem dentro do próprio teste — imunes ao
// restoreMocks da config do Vitest.
const { socketHandlers, managerHandlers } = vi.hoisted(() => {
  const socketHandlers = new Map<string, (payload: unknown) => void>();
  const managerHandlers = new Map<string, () => void>();
  return { socketHandlers, managerHandlers };
});

vi.mock('socket.io-client', () => {
  const createSocket = (): Socket => {
    const sock = {
      id: 'test-socket-id',
      connected: true,
      on: vi.fn((event: string, cb: (payload: unknown) => void) => {
        socketHandlers.set(event, cb);
        return sock;
      }),
      off: vi.fn(),
      emit: vi.fn(),
      disconnect: vi.fn(),
      io: {
        on: vi.fn((event: string, cb: () => void) => {
          managerHandlers.set(event, cb);
          return sock.io;
        }),
      },
    };
    return sock as unknown as Socket;
  };

  return { io: () => createSocket() };
});

beforeEach(() => {
  socketHandlers.clear();
  managerHandlers.clear();
});

describe('useSocket — handler connect_error', () => {
  it('connect_error após connect retorna connected=false mantendo o socket', () => {
    const { result } = renderHook(() => useSocket());

    // connect limpo
    act(() => {
      socketHandlers.get('connect')?.(undefined);
    });
    expect(result.current.connected).toBe(true);

    // connect_error (ex.: backend fora do ar / CORS / tailnet barrier)
    act(() => {
      socketHandlers.get('connect_error')?.({ message: 'xhr poll error' });
    });
    expect(result.current.connected).toBe(false);
    // O socket continua existindo para a reconexão do socket.io decidir.
    expect(result.current.socket).not.toBeNull();
  });

  it('connect_error em estado inicial mantém connected=false sem quebrar', () => {
    const { result } = renderHook(() => useSocket());
    expect(result.current.connected).toBe(false);

    act(() => {
      socketHandlers.get('connect_error')?.({ message: 'websocket error' });
    });
    expect(result.current.connected).toBe(false);
  });
});

describe('useSocket — onReconnect', () => {
  it('dispara no segundo connect (reconexão), não no primeiro', () => {
    const { result } = renderHook(() => useSocket());
    const onReconnect = vi.fn();

    act(() => {
      result.current.onReconnect(onReconnect);
    });

    // Primeiro connect: entrar na sala, não é reconexão.
    act(() => {
      socketHandlers.get('connect')?.(undefined);
    });
    expect(onReconnect).not.toHaveBeenCalled();

    // Queda e volta: o namespace 'connect' dispara de novo.
    act(() => {
      socketHandlers.get('disconnect')?.('transport close');
    });
    act(() => {
      socketHandlers.get('connect')?.(undefined);
    });
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('NÃO registra o evento reconnect do Manager (emissão antes do ack do CONNECT)', () => {
    const { result } = renderHook(() => useSocket());
    const onReconnect = vi.fn();
    act(() => {
      result.current.onReconnect(onReconnect);
    });

    act(() => {
      managerHandlers.get('reconnect')?.();
    });
    expect(onReconnect).not.toHaveBeenCalled();
    expect(managerHandlers.has('reconnect')).toBe(false);
  });

  it('isConnected() lê o estado vivo do socket, não o estado do React', () => {
    const { result } = renderHook(() => useSocket());

    // O mock nasce com connected=true mas o estado do React ainda não recebeu
    // o evento 'connect' — exatamente o cenário do re-join (callback disparado
    // fora do ciclo de render).
    expect(result.current.connected).toBe(false);
    expect(result.current.isConnected()).toBe(true);
  });

  it('unsubscribe para de notificar', () => {
    const { result } = renderHook(() => useSocket());
    const onReconnect = vi.fn();
    let unsub: () => void = () => {};
    act(() => {
      unsub = result.current.onReconnect(onReconnect);
      socketHandlers.get('connect')?.(undefined);
    });
    act(() => {
      unsub();
      socketHandlers.get('disconnect')?.('transport close');
      socketHandlers.get('connect')?.(undefined);
    });
    expect(onReconnect).not.toHaveBeenCalled();
  });
});