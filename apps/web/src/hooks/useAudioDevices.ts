'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type OutputMediaDevices = MediaDevices & {
  selectAudioOutput?: (options?: { deviceId?: string }) => Promise<MediaDeviceInfo>;
};

export interface AudioDevicesState {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
  microphoneId: string;
  outputId: string;
  canSelectOutput: boolean;
  canRequestOutput: boolean;
  error: string | null;
  notice: string | null;
  selectInput: (deviceId: string) => Promise<void>;
  selectOutput: (deviceId: string) => Promise<void>;
  requestOutput: () => Promise<void>;
  reportOutputError: () => void;
}

/** O id vazio mantém o roteamento padrão do navegador/sistema operacional. */
export async function setAudioSink(element: HTMLMediaElement, deviceId: string): Promise<void> {
  if (typeof element.setSinkId === 'function') await element.setSinkId(deviceId);
  else if (deviceId) throw new DOMException('Seleção de saída indisponível', 'NotSupportedError');
}

export function useAudioDevices({ localStream, microphoneId, captureMicrophone }: {
  localStream: MediaStream | null;
  microphoneId: string;
  captureMicrophone: (deviceId: string) => Promise<boolean>;
}): AudioDevicesState {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [outputs, setOutputs] = useState<MediaDeviceInfo[]>([]);
  const [outputId, setOutputId] = useState('');
  const [canSelectOutput, setCanSelectOutput] = useState(false);
  const [canRequestOutput, setCanRequestOutput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selectionRef = useRef({ microphoneId, outputId, localStream });
  selectionRef.current = { microphoneId, outputId, localStream };
  const outputGenerationRef = useRef(0);

  const refresh = useCallback(async (deviceChanged = false) => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setInputs(devices.filter((device) => device.kind === 'audioinput' && device.deviceId));
      setOutputs(devices.filter((device) => device.kind === 'audiooutput' && device.deviceId));
      if (!deviceChanged) return;
      const selected = selectionRef.current;
      if (selected.outputId && !devices.some((device) => device.kind === 'audiooutput' && device.deviceId === selected.outputId)) {
        outputGenerationRef.current += 1;
        setOutputId('');
        setNotice('Saída desconectada. Usando a saída padrão do sistema.');
      }
      if (selected.microphoneId && selected.localStream && !devices.some((device) => device.kind === 'audioinput' && device.deviceId === selected.microphoneId)) {
        const restored = await captureMicrophone('');
        setNotice(restored ? 'Microfone desconectado. Usando o microfone padrão.' : 'Microfone desconectado. Conecte outro dispositivo e tente novamente.');
      }
    } catch {
      setError('Não foi possível listar dispositivos. Verifique a permissão de microfone e tente novamente.');
    }
  }, [captureMicrophone]);

  useEffect(() => {
    setCanSelectOutput(window.isSecureContext && typeof HTMLMediaElement.prototype.setSinkId === 'function');
    setCanRequestOutput(typeof (navigator.mediaDevices as OutputMediaDevices | undefined)?.selectAudioOutput === 'function');
    void refresh();
    const onDeviceChange = () => { void refresh(true); };
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => { navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange); };
  }, [refresh]);

  // Após a permissão, o navegador pode finalmente revelar nomes e saídas.
  useEffect(() => { void refresh(); }, [localStream, refresh]);

  const selectInput = useCallback(async (deviceId: string) => {
    setError(null);
    setNotice(null);
    if (!await captureMicrophone(deviceId)) {
      setError('Não foi possível usar esse microfone. Verifique a conexão e a permissão; o microfone anterior foi mantido quando disponível.');
    }
    await refresh();
  }, [captureMicrophone, refresh]);

  const reportOutputError = useCallback(() => {
    outputGenerationRef.current += 1;
    setOutputId('');
    setError('Não foi possível usar a saída escolhida. Usando a saída padrão do sistema.');
  }, []);

  const selectOutput = useCallback(async (deviceId: string) => {
    const generation = ++outputGenerationRef.current;
    setError(null);
    setNotice(null);
    try {
      // Valida a permissão mesmo sem peers conectados. Cada player recebe o
      // mesmo sink na montagem, inclusive participantes que entrarem depois.
      await setAudioSink(document.createElement('audio'), deviceId);
      if (generation === outputGenerationRef.current) setOutputId(deviceId);
    } catch {
      if (generation === outputGenerationRef.current) reportOutputError();
    }
  }, [reportOutputError]);

  const requestOutput = useCallback(async () => {
    const devices = navigator.mediaDevices as OutputMediaDevices;
    if (!devices?.selectAudioOutput) return;
    try {
      // Chamada direta do clique: selectAudioOutput exige ativação transitória.
      const device = await devices.selectAudioOutput();
      await selectOutput(device.deviceId);
      await refresh();
    } catch {
      setError('Escolha de saída cancelada ou sem permissão. A saída atual foi mantida.');
    }
  }, [refresh, selectOutput]);

  return { inputs, outputs, microphoneId, outputId, canSelectOutput, canRequestOutput,
    error, notice, selectInput, selectOutput, requestOutput, reportOutputError };
}
