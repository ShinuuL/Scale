import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AUDIO_DEVICES_EVENT,
  DEFAULT_DEVICE_ID,
  DEFAULT_DEVICE_LABEL,
  getSavedDeviceId,
  listAudioDevices,
  requestMicrophonePermission,
  resolveDeviceId,
  saveDeviceId,
  subscribeAudioDeviceChange,
  subscribeDeviceList,
} from '@/lib/audioDevices';

function dev(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: '', toJSON: () => ({}) } as MediaDeviceInfo;
}

let enumerate: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let mediaListeners: Map<string, Set<() => void>>;

beforeEach(() => {
  window.localStorage.clear();
  mediaListeners = new Map();
  enumerate = vi.fn();
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: {
      enumerateDevices: enumerate,
      getUserMedia,
      addEventListener: (type: string, cb: () => void) => {
        mediaListeners.set(type, (mediaListeners.get(type) ?? new Set()).add(cb));
      },
      removeEventListener: (type: string, cb: () => void) => mediaListeners.get(type)?.delete(cb),
    },
  });
});

describe('audioDevices', () => {
  it('lista com "Padrão do sistema" primeiro, sem duplicar o alias default', async () => {
    enumerate.mockResolvedValue([
      dev('audioinput', 'default', 'Padrão - Headset'),
      dev('audioinput', 'mic-1', 'Headset'),
      dev('audiooutput', 'out-1', 'Caixas'),
    ]);
    const list = await listAudioDevices();
    expect(list.inputs).toEqual([
      { deviceId: DEFAULT_DEVICE_ID, label: DEFAULT_DEVICE_LABEL },
      { deviceId: 'mic-1', label: 'Headset' },
    ]);
    expect(list.outputs[0].deviceId).toBe(DEFAULT_DEVICE_ID);
    expect(list.outputs[1].label).toBe('Caixas');
    expect(list.hasLabels).toBe(true);
  });

  it('sem permissão (rótulos vazios) hasLabels é false', async () => {
    enumerate.mockResolvedValue([dev('audioinput', 'mic-1', '')]);
    const list = await listAudioDevices();
    expect(list.hasLabels).toBe(false);
    expect(list.inputs[1].label).toBe('Microfone 1');
  });

  it('padrão inicial e aparelho salvo que sumiu voltam ao padrão', async () => {
    expect(getSavedDeviceId('input')).toBe(DEFAULT_DEVICE_ID);
    saveDeviceId('input', 'mic-velho');
    expect(getSavedDeviceId('input')).toBe('mic-velho');
    enumerate.mockResolvedValue([dev('audioinput', 'mic-1', 'Headset')]);
    const list = await listAudioDevices();
    expect(resolveDeviceId(getSavedDeviceId('input'), list.inputs)).toBe(DEFAULT_DEVICE_ID);
    expect(resolveDeviceId('mic-1', list.inputs)).toBe('mic-1');
  });

  it('saveDeviceId notifica a aba só quando o valor muda; padrão remove a chave', () => {
    const seen: unknown[] = [];
    const off = subscribeAudioDeviceChange((d) => seen.push(d));
    saveDeviceId('output', 'out-1');
    saveDeviceId('output', 'out-1');
    expect(seen).toEqual([{ kind: 'output', deviceId: 'out-1' }]);
    saveDeviceId('output', DEFAULT_DEVICE_ID);
    expect(window.localStorage.getItem('scale.audio.output')).toBeNull();
    expect(seen).toHaveLength(2);
    off();
    saveDeviceId('output', 'out-2');
    expect(seen).toHaveLength(2);
    expect(AUDIO_DEVICES_EVENT).toBe('scale:audio-devices-changed');
  });

  it('reage a devicechange e cancela a assinatura', () => {
    const cb = vi.fn();
    const off = subscribeDeviceList(cb);
    mediaListeners.get('devicechange')?.forEach((l) => l());
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    expect(mediaListeners.get('devicechange')?.size).toBe(0);
  });

  it('pede permissão e para as faixas logo depois', async () => {
    const stop = vi.fn();
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop }] });
    await expect(requestMicrophonePermission()).resolves.toBe(true);
    expect(stop).toHaveBeenCalled();
    getUserMedia.mockRejectedValue(new Error('NotAllowedError'));
    await expect(requestMicrophonePermission()).resolves.toBe(false);
  });
});
