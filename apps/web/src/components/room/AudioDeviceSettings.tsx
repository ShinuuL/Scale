'use client';

import { useEffect, useId, useRef } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import type { AudioDevicesState } from '@/hooks/useAudioDevices';

export function AudioDeviceSettings({
  devices,
  busy,
}: {
  devices: AudioDevicesState;
  busy: boolean;
}) {
  const id = useId();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      const details = detailsRef.current;
      if (event.key !== 'Escape' || event.defaultPrevented || !details?.open) return;
      // Só o disclosure que contém o foco responde; outros painéis não roubam o foco.
      if (!details.contains(document.activeElement)) return;
      event.preventDefault();
      details.open = false;
      summaryRef.current?.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) {
        // O alvo externo recebe o foco normalmente, inclusive outro controle da sala.
        details.open = false;
      }
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
    };
  }, []);
  const selectClass =
    'mt-1 w-full rounded-lg border border-line-strong bg-surface-secondary px-3 py-2 text-base text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';
  return (
    <details ref={detailsRef} className="relative">
      <summary
        ref={summaryRef}
        className="flex cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-line bg-surface-tertiary px-3.5 py-2.5 text-sm font-medium text-ink-primary hover:bg-surface-tertiary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [&::-webkit-details-marker]:hidden"
        aria-label="Dispositivos de áudio"
      >
        <Icon name="settings" aria-hidden="true" />
        <span className="hidden sm:inline">Dispositivos</span>
      </summary>
      <div className="fixed bottom-24 left-1/2 z-40 max-h-[calc(100dvh-8rem)] overflow-y-auto w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-line-strong bg-surface-secondary p-4 shadow-xl shadow-black/30">
        <h2 className="mb-3 text-base font-semibold text-ink-primary">Dispositivos de áudio</h2>
        <label htmlFor={`${id}-input`} className="block text-sm font-medium text-ink-secondary">
          Microfone
        </label>
        <select
          id={`${id}-input`}
          className={selectClass}
          value={devices.microphoneId}
          disabled={busy}
          onChange={(event) => void devices.selectInput(event.target.value)}
        >
          <option value="">Padrão do sistema</option>
          {devices.inputs
            .filter((device) => device.deviceId !== 'default')
            .map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microfone ${index + 1}`}
              </option>
            ))}
        </select>
        <p className="mt-1 text-xs text-ink-muted">
          {busy
            ? 'Conectando microfone…'
            : 'A permissão de microfone libera os nomes dos dispositivos.'}
        </p>
        <Button
          variant="secondary"
          className="mt-2 w-full"
          disabled={busy}
          onClick={() => void devices.selectInput(devices.microphoneId)}
        >
          Tentar microfone novamente
        </Button>
        <label
          htmlFor={`${id}-output`}
          className="mt-4 block text-sm font-medium text-ink-secondary"
        >
          Saída de áudio
        </label>
        <select
          id={`${id}-output`}
          className={selectClass}
          value={devices.outputId}
          disabled={!devices.canSelectOutput}
          onChange={(event) => void devices.selectOutput(event.target.value)}
        >
          <option value="">Padrão do sistema</option>
          {devices.outputs
            .filter((device) => device.deviceId !== 'default')
            .map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Saída ${index + 1}`}
              </option>
            ))}
        </select>
        {devices.canRequestOutput && devices.canSelectOutput && (
          <Button
            variant="secondary"
            className="mt-2 w-full"
            onClick={() => void devices.requestOutput()}
          >
            Autorizar outra saída
          </Button>
        )}
        {!devices.canSelectOutput && (
          <p className="mt-2 text-sm text-ink-secondary">
            Este navegador usa a saída padrão. Troque o dispositivo nas configurações de som do
            sistema.
          </p>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          Ao compartilhar, escolha a aba ou janela desejada e marque o áudio no seletor quando
          disponível. Use fones para reduzir eco.
        </p>
        <div role="status" aria-live="polite" className="mt-2 text-sm text-ink-secondary">
          {devices.error || devices.notice}
        </div>
      </div>
    </details>
  );
}
