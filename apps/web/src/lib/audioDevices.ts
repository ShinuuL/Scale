/**
 * Escolha de microfone e saída de áudio (vale para logados e convidados).
 *
 * Valor "padrão" = string vazia (''): o navegador decide (sem `deviceId` no
 * getUserMedia e sem setSinkId). É o valor inicial e o que sobra quando o
 * aparelho salvo some da lista. A opção na UI aparece como "Padrão do sistema".
 */

export type AudioDeviceKind = 'input' | 'output';

export const DEFAULT_DEVICE_ID = '';
export const DEFAULT_DEVICE_LABEL = 'Padrão do sistema';

export const AUDIO_DEVICES_EVENT = 'scale:audio-devices-changed';

const STORAGE_KEYS: Record<AudioDeviceKind, string> = {
  input: 'scale.audio.input',
  output: 'scale.audio.output',
};

export interface AudioDeviceOption {
  deviceId: string;
  label: string;
}

export interface AudioDeviceList {
  inputs: AudioDeviceOption[];
  outputs: AudioDeviceOption[];
  /** true quando o navegador devolveu nomes (permissão do microfone concedida). */
  hasLabels: boolean;
}

export interface AudioDeviceChangeDetail {
  kind: AudioDeviceKind;
  deviceId: string;
}

/** Lê a escolha salva ('' = padrão). Não confere se o aparelho ainda existe. */
export function getSavedDeviceId(kind: AudioDeviceKind): string {
  if (typeof window === 'undefined') return DEFAULT_DEVICE_ID;
  try {
    return window.localStorage.getItem(STORAGE_KEYS[kind]) ?? DEFAULT_DEVICE_ID;
  } catch {
    return DEFAULT_DEVICE_ID;
  }
}

/** Salva a escolha e avisa a aba atual. Só dispara o evento se o valor mudou. */
export function saveDeviceId(kind: AudioDeviceKind, deviceId: string): void {
  if (typeof window === 'undefined') return;
  const previous = getSavedDeviceId(kind);
  try {
    if (deviceId === DEFAULT_DEVICE_ID) window.localStorage.removeItem(STORAGE_KEYS[kind]);
    else window.localStorage.setItem(STORAGE_KEYS[kind], deviceId);
  } catch {
    // localStorage indisponível: a escolha vale só nesta sessão (evento abaixo).
  }
  if (previous === deviceId) return;
  window.dispatchEvent(
    new CustomEvent<AudioDeviceChangeDetail>(AUDIO_DEVICES_EVENT, {
      detail: { kind, deviceId },
    }),
  );
}

/** Se o aparelho salvo não está na lista, volta para o padrão. */
export function resolveDeviceId(saved: string, available: AudioDeviceOption[]): string {
  if (saved === DEFAULT_DEVICE_ID) return DEFAULT_DEVICE_ID;
  return available.some((d) => d.deviceId === saved) ? saved : DEFAULT_DEVICE_ID;
}

/** Lista aparelhos de áudio; a primeira opção é sempre o padrão do sistema. */
export async function listAudioDevices(): Promise<AudioDeviceList> {
  const empty: AudioDeviceList = {
    inputs: [{ deviceId: DEFAULT_DEVICE_ID, label: DEFAULT_DEVICE_LABEL }],
    outputs: [{ deviceId: DEFAULT_DEVICE_ID, label: DEFAULT_DEVICE_LABEL }],
    hasLabels: false,
  };
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return empty;
  }
  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    return empty;
  }
  const build = (kind: MediaDeviceKind): AudioDeviceOption[] => {
    const list = devices
      // 'default' e 'communications' do Chromium duplicam o "Padrão do sistema".
      .filter((d) => d.kind === kind && d.deviceId !== '' && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({
        deviceId: d.deviceId,
        label: d.label || `${kind === 'audioinput' ? 'Microfone' : 'Saída'} ${i + 1}`,
      }));
    return [{ deviceId: DEFAULT_DEVICE_ID, label: DEFAULT_DEVICE_LABEL }, ...list];
  };
  const audioDevices = devices.filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput');
  return {
    inputs: build('audioinput'),
    outputs: build('audiooutput'),
    hasLabels: audioDevices.some((d) => d.label !== ''),
  };
}

/** Escolha salva já validada contra a lista atual (sumiu = padrão). */
export async function getEffectiveDeviceId(kind: AudioDeviceKind): Promise<string> {
  const saved = getSavedDeviceId(kind);
  if (saved === DEFAULT_DEVICE_ID) return DEFAULT_DEVICE_ID;
  const list = await listAudioDevices();
  return resolveDeviceId(saved, kind === 'input' ? list.inputs : list.outputs);
}

/**
 * Pede permissão do microfone (os nomes só aparecem depois) e solta as faixas
 * na hora. Devolve true se a permissão foi concedida.
 */
export async function requestMicrophonePermission(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

/** Navegador permite escolher a saída (HTMLMediaElement.setSinkId)? */
export function supportsSinkId(): boolean {
  return typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
}

/** Aplica a saída salva num elemento de mídia, quando suportado. Nunca lança. */
export async function applySavedSink(el: HTMLMediaElement): Promise<void> {
  const sinkable = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };
  if (typeof sinkable.setSinkId !== 'function') return;
  const saved = getSavedDeviceId('output');
  // Padrão sem troca anterior: não chama setSinkId (no celular a chamada com ''
  // pode prender o áudio no alto-falante). Só volta ao padrão se já foi trocado.
  const current = (el as HTMLMediaElement & { sinkId?: string }).sinkId ?? '';
  if (saved === DEFAULT_DEVICE_ID && current === DEFAULT_DEVICE_ID) return;
  try {
    await sinkable.setSinkId(saved);
  } catch (err) {
    console.warn('[audio] setSinkId falhou:', err);
  }
}

/**
 * Saída escolhível? Sem setSinkId (iOS) ou com só o padrão na lista (Android,
 * com permissão) o sistema decide entre alto-falante e fone.
 */
export function canChooseOutput(list: AudioDeviceList | null): boolean {
  if (!supportsSinkId()) return false;
  if (list && list.hasLabels && list.outputs.length <= 1) return false;
  return true;
}

/** Assina mudanças de escolha (mesma aba). Devolve a função de cancelar. */
export function subscribeAudioDeviceChange(
  listener: (detail: AudioDeviceChangeDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const handler = (e: Event) => listener((e as CustomEvent<AudioDeviceChangeDetail>).detail);
  window.addEventListener(AUDIO_DEVICES_EVENT, handler);
  return () => window.removeEventListener(AUDIO_DEVICES_EVENT, handler);
}

/** Assina plug/unplug de aparelhos (evento 'devicechange'). */
export function subscribeDeviceList(listener: () => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.addEventListener) {
    return () => undefined;
  }
  const md = navigator.mediaDevices;
  md.addEventListener('devicechange', listener);
  return () => md.removeEventListener('devicechange', listener);
}
