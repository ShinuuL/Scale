'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import {
  DEFAULT_DEVICE_ID,
  getSavedDeviceId,
  listAudioDevices,
  requestMicrophonePermission,
  resolveDeviceId,
  saveDeviceId,
  subscribeDeviceList,
  supportsSinkId,
  type AudioDeviceList,
} from '@/lib/audioDevices';

const SELECT_CLASS =
  'w-full rounded-lg border border-white/10 bg-forest-950 px-3 py-2 text-sm text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400';

/**
 * Seção "Áudio" das configurações (todos, logados ou convidados): microfone,
 * saída e teste de nível. O teste só captura enquanto a seção está montada.
 */
export function AudioSettings() {
  const [devices, setDevices] = useState<AudioDeviceList | null>(null);
  const [inputId, setInputId] = useState(DEFAULT_DEVICE_ID);
  const [outputId, setOutputId] = useState(DEFAULT_DEVICE_ID);
  const [level, setLevel] = useState(0);
  const [testError, setTestError] = useState(false);
  const [asking, setAsking] = useState(false);
  const sinkSupported = supportsSinkId();

  const refresh = useCallback(async () => {
    const list = await listAudioDevices();
    setDevices(list);
    // Aparelho salvo que sumiu volta ao padrão (e a troca ao vivo acontece).
    const savedIn = getSavedDeviceId('input');
    const savedOut = getSavedDeviceId('output');
    const effIn = resolveDeviceId(savedIn, list.inputs);
    const effOut = resolveDeviceId(savedOut, list.outputs);
    if (effIn !== savedIn) saveDeviceId('input', effIn);
    if (effOut !== savedOut) saveDeviceId('output', effOut);
    setInputId(effIn);
    setOutputId(effOut);
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeDeviceList(() => void refresh());
  }, [refresh]);

  // Teste de captação: getUserMedia do aparelho escolhido + AnalyserNode.
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: inputId ? { deviceId: { ideal: inputId } } : true,
          video: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        setTestError(false);
        const Ctor = window.AudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          setLevel(Math.min(1, (peak / 128) * 2));
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        if (!cancelled) setTestError(true);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx && ctx.state !== 'closed') void ctx.close();
      setLevel(0);
    };
  }, [inputId]);

  const askPermission = async () => {
    setAsking(true);
    const ok = await requestMicrophonePermission();
    setTestError(!ok);
    await refresh();
    setAsking(false);
  };

  const onInput = (id: string) => {
    setInputId(id);
    saveDeviceId('input', id);
  };
  const onOutput = (id: string) => {
    setOutputId(id);
    saveDeviceId('output', id);
  };

  return (
    <section aria-labelledby="settings-audio" className="space-y-3 border-t border-white/[0.08] pt-4">
      <h3 id="settings-audio" className="text-xs font-medium uppercase tracking-wide text-slate-400">
        Áudio
      </h3>

      <div className="space-y-1">
        <label htmlFor="settings-mic" className="block text-sm text-slate-200">
          Microfone
        </label>
        <select
          id="settings-mic"
          className={SELECT_CLASS}
          value={inputId}
          onChange={(e) => onInput(e.target.value)}
        >
          {(devices?.inputs ?? []).map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </div>

      {devices && !devices.hasLabels && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void askPermission()} disabled={asking}>
            <Icon name="mic" size={14} />
            Permitir acesso ao microfone
          </Button>
          <p className="text-xs text-slate-400">Os nomes dos aparelhos só aparecem após a permissão.</p>
        </div>
      )}

      <div className="space-y-1">
        <div className="text-sm text-slate-200" id="settings-mic-level-label">
          Nível do microfone
        </div>
        <div
          role="progressbar"
          aria-labelledby="settings-mic-level-label"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
          className="h-2 w-full overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full bg-brand-400 transition-[width] duration-75" style={{ width: `${level * 100}%` }} />
        </div>
        {testError && (
          <p role="alert" className="text-xs text-red-300">
            Não foi possível acessar o microfone. Verifique a permissão do navegador.
          </p>
        )}
      </div>

      {sinkSupported ? (
        <div className="space-y-1">
          <label htmlFor="settings-speaker" className="block text-sm text-slate-200">
            Saída de áudio
          </label>
          <select
            id="settings-speaker"
            className={SELECT_CLASS}
            value={outputId}
            onChange={(e) => onOutput(e.target.value)}
          >
            {(devices?.outputs ?? []).map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-xs text-slate-400">Seu navegador não permite escolher a saída de áudio</p>
      )}
    </section>
  );
}
