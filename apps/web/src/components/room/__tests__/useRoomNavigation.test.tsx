import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useRoomNavigation } from '../useRoomNavigation';

describe('proteção da navegação durante a chamada', () => {
  it('permite navegar antes de entrar e pede decisão depois do ingresso', () => {
    const { result, rerender } = renderHook(({ joined }) => useRoomNavigation(joined), {
      initialProps: { joined: false },
    });
    expect(result.current.requestNavigation('/friends')).toBe(true);
    expect(result.current.pendingDestination).toBeNull();
    rerender({ joined: true });
    act(() => {
      expect(result.current.requestNavigation('/friends')).toBe(false);
    });
    expect(result.current.pendingDestination).toBe('/friends');
    act(() => result.current.cancelNavigation());
    expect(result.current.pendingDestination).toBeNull();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('uma saída confirmada não pede uma segunda confirmação do navegador', () => {
    const { result } = renderHook(() => useRoomNavigation(true));
    act(() => result.current.allowNavigation());
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
