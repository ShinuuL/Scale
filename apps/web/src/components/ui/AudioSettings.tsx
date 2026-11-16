'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button as AriaButton,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from 'react-aria-components';
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
  canChooseOutput,
  type AudioDeviceList,
} from '@/lib/audioDevices';

/**
 * Microfone de fone Bluetooth: ao abrir o mic, o sistema muda o fone para o
 * modo chamada (HFP, "Hands-Free"), mono e de baixa qualidade nos DOIS sentidos
 * — a voz fica metálica. Detectado pelo nome do aparelho.
 */
export function isBluetoothCallMic(label: string | undefined): boolean {
  return !!label && /hands[- ]?free|bluetooth/i.test(label);
}

/** Chave de UI do "Padrão do sistema" (o react-aria não aceita '' como seleção). */
const DEFAULT_KEY = '__default';

interface DeviceOption {
  deviceId: string;
  label: string;
}

/**
 * Seletor de aparelho (react-aria `Select`): lista estilizada no tema, setas e
 * busca por letra, Escape fecha só a lista (o diálogo continua aberto).
 */
function DeviceSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: DeviceOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Select
      selectedKey={value || DEFAULT_KEY}
      onSelectionChange={(key) => {
        if (key === null) return;
        const id = String(key);
        onChange(id === DEFAULT_KEY ? DEFAULT_DEVICE_ID : id);
      }}
      placeholder="Nenhum aparelho"
      className="space-y-1"
    >
      <Label className="block text-sm text-slate-200">{label}</Label>
      <AriaButton className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-forest-950 px-3 py-2 text-left text-sm text-white outline-none transition-colors hover:border-white/20 data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-brand-400 data-[pressed]:bg-white/[0.04]">
        <SelectValue className="truncate data-[placeholder]:text-slate-400" />
        <Icon name="chevronDown" size={16} className="text-slate-400" />
      </AriaButton>
      <Popover
        offset={6}
        className="z-[60] w-[--trigger-width] overflow-auto rounded-xl border border-white/10 bg-forest-900 p-1 shadow-[0_12px_40px_rgb(0_0_0/0.35)] data-[entering]:animate-menu-in"
      >
        <ListBox items={options} className="max-h-64 outline-none">
          {(item) => (
            <ListBoxItem
              id={item.deviceId || DEFAULT_KEY}
              textValue={item.label}
              className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-primary outline-none data-[focused]:bg-white/[0.08] data-[selected]:font-medium"
            >
              {({ isSelected }) => (
                <>
                  <span className="truncate">{item.label}</span>
                  {isSelected && <Icon name="check" size={16} className="shrink-0 text-accent" />}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}

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

  const refresh = useCallback(async () => {
    const list = await listAudioDevices();
    setDevices(list);
    const savedIn = getSavedDeviceId('input');
    const savedOut = getSavedDeviceId('output');
    // Sem nomes (antes da permissão) os ids podem não bater: mantém a escolha.
    if (!list.hasLabels) {
      setInputId(savedIn);
      setOutputId(savedOut);
      return;
    }
    // Aparelho salvo que sumiu volta ao padrão (e a troca ao vivo acontece).
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
    const resumeOnGesture = () => {
      if (ctx && ctx.state === 'suspended') void ctx.resume();
    };

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
        // Permissão concedida: agora a lista vem com nomes.
        void refresh();
        const Ctor = window.AudioContext;
        if (!Ctor) return;
        ctx = new Ctor();
        // Celular cria o contexto suspenso fora de gesto: retoma já e no toque.
        void ctx.resume();
        if (ctx.state === 'suspended') {
          window.addEventListener('pointerdown', resumeOnGesture, true);
        }
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
      window.removeEventListener('pointerdown', resumeOnGesture, true);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      stream?.getTracks().forEach((t) => t.stop());
      if (ctx && ctx.state !== 'closed') void ctx.close();
      setLevel(0);
    };
  }, [inputId, refresh]);

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
    <section
      aria-labelledby="settings-audio"
      className="space-y-3 border-t border-white/[0.08] pt-4"
    >
      <h3
        id="settings-audio"
        className="text-xs font-medium uppercase tracking-wide text-slate-400"
      >
        Áudio
      </h3>

      <DeviceSelect
        label="Microfone"
        options={devices?.inputs ?? []}
        value={inputId}
        onChange={onInput}
      />
      {isBluetoothCallMic(devices?.inputs.find((d) => d.deviceId === inputId)?.label) && (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-200"
        >
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          Microfone de fone sem fio deixa o som metálico para você e para os outros. Para ouvir
          melhor, escolha o microfone do computador e mantenha o fone só como saída de áudio.
        </p>
      )}

      {devices && !devices.hasLabels && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void askPermission()}
            disabled={asking}
          >
            <Icon name="mic" size={14} />
            Permitir acesso ao microfone
          </Button>
          <p className="text-xs text-slate-400">
            Os nomes dos aparelhos só aparecem após a permissão.
          </p>
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
          <div
            className="h-full bg-brand-400 transition-[width] duration-75"
            style={{ width: `${level * 100}%` }}
          />
        </div>
        {testError && (
          <p role="alert" className="text-xs text-red-300">
            Não foi possível acessar o microfone. Verifique a permissão do navegador.
          </p>
        )}
      </div>

      {canChooseOutput(devices) ? (
        <DeviceSelect
          label="Saída de áudio"
          options={devices?.outputs ?? []}
          value={outputId}
          onChange={onOutput}
        />
      ) : (
        <div className="space-y-1">
          <div className="text-sm text-slate-200" id="settings-output-label">
            Saída de áudio
          </div>
          <div
            role="textbox"
            aria-readonly="true"
            aria-labelledby="settings-output-label"
            className="w-full rounded-lg border border-white/10 bg-forest-950 px-3 py-2 text-sm text-slate-300"
          >
            Padrão do sistema
          </div>
          <p className="text-xs text-slate-400">
            No celular, o sistema alterna entre alto-falante e fone.
          </p>
        </div>
      )}
    </section>
  );
}
