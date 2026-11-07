import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { setAudioSink, useAudioDevices } from '../useAudioDevices';

const device = (deviceId: string, kind: MediaDeviceKind): MediaDeviceInfo => ({ deviceId, kind, label: deviceId, groupId: '', toJSON: () => ({}) });
let mediaDevices: EventTarget & { enumerateDevices: ReturnType<typeof vi.fn>; selectAudioOutput?: ReturnType<typeof vi.fn> };
let sink: ReturnType<typeof vi.fn>;
const originalSink = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'setSinkId');

beforeEach(() => {
  mediaDevices = Object.assign(new EventTarget(), { enumerateDevices: vi.fn().mockResolvedValue([device('usb', 'audioinput'), device('headset', 'audiooutput')]) });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
  vi.stubGlobal('isSecureContext', true);
  sink = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { configurable: true, value: sink });
});

afterEach(() => {
  if (originalSink) Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', originalSink);
  else Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');
  vi.unstubAllGlobals();
});

describe('seleção de dispositivos', () => {
  it('lista após permissão e troca saída permitida; erro do player restaura padrão', async () => {
    const captureMicrophone = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useAudioDevices({ localStream: null, microphoneId: '', captureMicrophone }));
    await act(async () => {});
    expect(result.current.inputs.map((item) => item.deviceId)).toEqual(['usb']);
    expect(result.current.canSelectOutput).toBe(true);
    await act(async () => { await result.current.selectOutput('headset'); });
    expect(sink).toHaveBeenCalledWith('headset');
    expect(result.current.outputId).toBe('headset');
    act(() => { result.current.reportOutputError(); });
    expect(result.current.outputId).toBe('');
    expect(result.current.error).toContain('saída padrão');
  });

  it('usa picker quando disponível e mantém saída atual se usuário cancela', async () => {
    mediaDevices.selectAudioOutput = vi.fn().mockResolvedValueOnce(device('headset', 'audiooutput')).mockRejectedValueOnce(new DOMException('Cancelado', 'NotAllowedError'));
    const captureMicrophone = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useAudioDevices({ localStream: null, microphoneId: '', captureMicrophone }));
    await act(async () => { await result.current.requestOutput(); });
    expect(result.current.outputId).toBe('headset');
    await act(async () => { await result.current.requestOutput(); });
    expect(result.current.outputId).toBe('headset');
    expect(result.current.error).toContain('cancelada');
  });

  it('dispositivo removido restaura saída e captura padrão; desmontagem remove listener', async () => {
    const captureMicrophone = vi.fn().mockResolvedValue(true);
    const remove = vi.spyOn(mediaDevices, 'removeEventListener');
    const stream = {} as MediaStream;
    const { result, unmount } = renderHook(() => useAudioDevices({ localStream: stream, microphoneId: 'usb', captureMicrophone }));
    await act(async () => { await result.current.selectOutput('headset'); });
    mediaDevices.enumerateDevices.mockResolvedValue([device('default', 'audioinput')]);
    await act(async () => { mediaDevices.dispatchEvent(new Event('devicechange')); });
    expect(captureMicrophone).toHaveBeenCalledWith('');
    expect(result.current.outputId).toBe('');
    expect(result.current.notice).toContain('padrão');
    unmount();
    expect(remove).toHaveBeenCalledWith('devicechange', expect.any(Function));
  });

  it('sem setSinkId mantém padrão; recusa seleção explícita sem fingir suporte', async () => {
    Reflect.deleteProperty(HTMLMediaElement.prototype, 'setSinkId');
    const captureMicrophone = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useAudioDevices({ localStream: null, microphoneId: '', captureMicrophone }));
    await act(async () => {});
    expect(result.current.canSelectOutput).toBe(false);
    await expect(setAudioSink(document.createElement('audio'), '')).resolves.toBeUndefined();
    await act(async () => { await result.current.selectOutput('headset'); });
    expect(result.current.outputId).toBe('');
    expect(result.current.error).toContain('saída padrão');
  });

  it('permissão negada e lista indisponível deixam mensagem recuperável', async () => {
    const captureMicrophone = vi.fn().mockResolvedValue(false);
    mediaDevices.enumerateDevices.mockRejectedValue(new DOMException('Negado', 'NotAllowedError'));
    const { result } = renderHook(() => useAudioDevices({ localStream: null, microphoneId: '', captureMicrophone }));
    await act(async () => {});
    expect(result.current.error).toContain('listar dispositivos');
    mediaDevices.enumerateDevices.mockResolvedValue([]);
    await act(async () => { await result.current.selectInput('usb'); });
    expect(result.current.error).toContain('microfone anterior');
  });
});
