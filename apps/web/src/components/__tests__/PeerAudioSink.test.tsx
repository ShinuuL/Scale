import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { VideoGrid } from '@/components/room/VideoGrid';
import { saveDeviceId } from '@/lib/audioDevices';
import type { PeerConnection } from '@/hooks/useWebRTC';

const peer: PeerConnection = {
  peerId: 'p1',
  isRegistered: false,
  name: 'Bia',
  connection: {} as RTCPeerConnection,
  stream: { getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] } as unknown as MediaStream,
  screenStream: null,
  audioMuted: false,
  videoMuted: false,
  isScreenSharing: false,
};

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
  window.localStorage.clear();
});

function renderGrid() {
  return render(
    <VideoGrid peers={new Map([['p1', peer]])} localStream={null} localScreenStream={null} isMuted={false} />,
  );
}

describe('PeerAudio e a saída de áudio', () => {
  it('aplica a saída salva e troca ao vivo pelo evento', () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: setSinkId, configurable: true });
    window.localStorage.setItem('scale.audio.output', 'out-1');

    renderGrid();
    expect(setSinkId).toHaveBeenCalledWith('out-1');

    saveDeviceId('output', 'out-2');
    expect(setSinkId).toHaveBeenLastCalledWith('out-2');
  });

  it('saída padrão salva não chama setSinkId', () => {
    const setSinkId = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: setSinkId, configurable: true });
    renderGrid();
    expect(setSinkId).not.toHaveBeenCalled();
  });

  it('retoma o play() no primeiro toque (touchstart)', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    renderGrid();
    const before = play.mock.calls.length;
    window.dispatchEvent(new Event('touchstart'));
    expect(play.mock.calls.length).toBeGreaterThan(before);
  });

  it('sem setSinkId não quebra', () => {
    expect(() => renderGrid()).not.toThrow();
  });
});
