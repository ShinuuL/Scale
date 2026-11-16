import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MODERATION_FRAME_MAX_BYTES } from '@scale/shared';
import { useScreenModeration } from '@/hooks/useScreenModeration';
import { api } from '@/lib/api';

const ROOM_ID = 'room-1';
const TICKET = 'ticket-abc';

function mockStream(): MediaStream {
  return {
    getVideoTracks: () => [{ getSettings: () => ({ width: 1920, height: 1080 }) }],
    getTracks: () => [],
  } as unknown as MediaStream;
}

let drawImage: ReturnType<typeof vi.fn>;
let blobSize = 1000;
let canvasSize: { width: number; height: number } | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  drawImage = vi.fn();
  blobSize = 1000;
  canvasSize = null;
  // jsdom nao implementa canvas 2D nem toBlob.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    canvasSize = { width: this.width, height: this.height };
    return { drawImage } as unknown as CanvasRenderingContext2D;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback, type?: string) {
    cb(new Blob([new Uint8Array(blobSize)], { type: type ?? 'image/jpeg' }));
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, writable: true, value: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useScreenModeration', () => {
  it('envia um JPEG reduzido a cada intervalo com o ticket no header e para ao desligar', async () => {
    const send = vi.spyOn(api, 'sendModerationFrame').mockResolvedValue(undefined);
    const stream = mockStream();
    const { rerender, unmount } = renderHook(
      (props: { stream: MediaStream | null }) =>
        useScreenModeration({ roomId: ROOM_ID, stream: props.stream, enabled: true, intervalSec: 20, ticket: TICKET }),
      { initialProps: { stream } },
    );
    expect(send).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(1);
    const [roomId, blob, ticket] = send.mock.calls[0];
    expect(roomId).toBe(ROOM_ID);
    expect(ticket).toBe(TICKET);
    expect((blob as Blob).type).toBe('image/jpeg');
    expect(drawImage).toHaveBeenCalledTimes(1);
    // 1920x1080 reduzido para largura <= 480 (mantendo proporcao).
    expect(canvasSize).toEqual({ width: 480, height: 270 });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(2);

    // Parou de compartilhar: nenhuma amostra a mais.
    rerender({ stream: null });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    unmount();
  });

  it('não envia nada sem ticket, com a amostragem desligada ou acima do limite de bytes', async () => {
    const send = vi.spyOn(api, 'sendModerationFrame').mockResolvedValue(undefined);
    const stream = mockStream();
    const { unmount: u1 } = renderHook(() =>
      useScreenModeration({ roomId: ROOM_ID, stream, enabled: false, intervalSec: 10, ticket: TICKET }),
    );
    const { unmount: u2 } = renderHook(() =>
      useScreenModeration({ roomId: ROOM_ID, stream, enabled: true, intervalSec: 10, ticket: null }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).not.toHaveBeenCalled();
    u1();
    u2();

    blobSize = MODERATION_FRAME_MAX_BYTES + 1;
    const { unmount: u3 } = renderHook(() =>
      useScreenModeration({ roomId: ROOM_ID, stream, enabled: true, intervalSec: 10, ticket: TICKET }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(send).not.toHaveBeenCalled();
    u3();
  });

  it('erro no envio é silencioso e não interrompe as amostras seguintes', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const send = vi.spyOn(api, 'sendModerationFrame').mockRejectedValueOnce({ status: 429 }).mockResolvedValue(undefined);
    const { unmount } = renderHook(() =>
      useScreenModeration({ roomId: ROOM_ID, stream: mockStream(), enabled: true, intervalSec: 10, ticket: TICKET }),
    );
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(debug).toHaveBeenCalledWith('[Moderation] amostra recusada', { status: 429 });
    unmount();
  });
});
