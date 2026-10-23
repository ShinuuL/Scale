import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { RoomDeletedEvent } from '@scale/shared';
import { useRoomDeleted, ROOM_DELETED_NOTICE } from '@/hooks/useRoomDeleted';
import { takeFlash } from '@/lib/flash';

const ROOM_ID = '22222222-2222-4222-8222-222222222222';

function fakeSocket() {
  const handlers: Array<(data: RoomDeletedEvent) => void> = [];
  return {
    onRoomDeleted: (cb: (data: RoomDeletedEvent) => void) => {
      handlers.push(cb);
      return () => {
        handlers.splice(handlers.indexOf(cb), 1);
      };
    },
    fire: (data: RoomDeletedEvent) => handlers.forEach((cb) => cb(data)),
  };
}

describe('useRoomDeleted (room:deleted)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('limpa a midia, deixa o aviso e volta para a home', () => {
    const socket = fakeSocket();
    const cleanup = vi.fn();
    const navigate = vi.fn();
    renderHook(() => useRoomDeleted(socket, ROOM_ID, cleanup, navigate));
    socket.fire({ roomId: ROOM_ID });
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(takeFlash()).toEqual({ message: ROOM_DELETED_NOTICE, variant: 'info' });
  });

  it('ignora outra sala e a propria exclusao em curso', () => {
    const socket = fakeSocket();
    const cleanup = vi.fn();
    const navigate = vi.fn();
    const { result } = renderHook(() => useRoomDeleted(socket, ROOM_ID, cleanup, navigate));
    socket.fire({ roomId: '33333333-3333-4333-8333-333333333333' });
    result.current.current = true;
    socket.fire({ roomId: ROOM_ID });
    expect(cleanup).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
