import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDisconnectNotice } from '@/hooks/useDisconnectNotice';

describe('useDisconnectNotice', () => {
  it('não avisa enquanto o socket ainda não conectou pela primeira vez', () => {
    const notify = vi.fn();
    const { rerender } = renderHook(({ c }) => useDisconnectNotice(c, notify), {
      initialProps: { c: false },
    });
    rerender({ c: false });
    expect(notify).not.toHaveBeenCalled();
  });

  it('avisa uma vez quando cai depois de conectado, e de novo numa nova queda', () => {
    const notify = vi.fn();
    const { rerender } = renderHook(({ c }) => useDisconnectNotice(c, notify), {
      initialProps: { c: false },
    });
    rerender({ c: true });
    rerender({ c: false });
    rerender({ c: false });
    expect(notify).toHaveBeenCalledTimes(1);

    rerender({ c: true });
    rerender({ c: false });
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
