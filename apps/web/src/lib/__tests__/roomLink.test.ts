import { describe, expect, it } from 'vitest';
import { roomPath, roomUrl } from '@/lib/roomLink';

const id = '7d1f6a3e-2b4c-4d8e-9f10-112233445566';

describe('roomLink', () => {
  it('gera /room?id=<id> sem token', () => {
    expect(roomPath(id)).toBe(`/room?id=${id}`);
  });

  it('acrescenta o token de convite quando presente', () => {
    expect(roomPath(id, 'abc')).toBe(`/room?id=${id}&token=abc`);
    expect(roomPath(id, null)).toBe(`/room?id=${id}`);
  });

  it('roomUrl usa o origin atual', () => {
    expect(roomUrl(id)).toBe(`${window.location.origin}/room?id=${id}`);
  });
});
