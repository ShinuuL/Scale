'use client';

import { useState } from 'react';
import { CHANNEL_EVERYONE, SLOW_MODE_PRESETS, formatSlowMode, type ChannelOverride, type ChannelSettings } from '@scale/shared';
import { Button } from '@/components/ui/Button';
import type { CommunityCustomRole } from '@/lib/api';
import type { Channel } from './CommunityParts';

type Tri = 'inherit' | 'allow' | 'deny';
const toTri = (value: boolean | null | undefined): Tri => (value === true ? 'allow' : value === false ? 'deny' : 'inherit');
const fromTri = (value: Tri): boolean | null => (value === 'allow' ? true : value === 'deny' ? false : null);
const selectClass = 'rounded-md border border-line bg-surface-secondary px-2 py-1 text-sm text-ink-primary';

/** Estado inicial do formulario a partir do canal (sobrescritas vem so para quem gerencia). */
export function initialChannelSettings(channel: Channel): ChannelSettings {
  return {
    announcement: channel.announcement ?? false,
    slowModeSeconds: channel.slowModeSeconds ?? 0,
    overrides: (channel.overrides ?? []).map((o) => ({ ...o })),
  };
}

/** Troca uma das permissoes de um alvo; sobrescrita toda "herdar" sai da lista. */
export function setOverride(list: ChannelOverride[], target: string, key: 'viewChannel' | 'sendMessages', value: boolean | null): ChannelOverride[] {
  const current = list.find((o) => o.target === target) ?? { target, viewChannel: null, sendMessages: null };
  const next = { ...current, [key]: value };
  const rest = list.filter((o) => o.target !== target);
  return next.viewChannel === null && next.sendMessages === null ? rest : [...rest, next];
}

/**
 * Fase 3: permissoes por canal (ver / enviar por cargo), canal de avisos e
 * modo lento. Quem gerencia a comunidade sempre passa; o servidor aplica.
 */
export function ChannelPermissionsForm({
  channel,
  roles,
  onSave,
  onCancel,
}: {
  channel: Channel;
  roles: CommunityCustomRole[];
  onSave: (settings: ChannelSettings) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<ChannelSettings>(() => initialChannelSettings(channel));
  const [busy, setBusy] = useState(false);
  const isText = channel.kind === 'TEXT';
  const targets = [{ id: CHANNEL_EVERYONE, name: 'Todos os membros' }, ...roles.map((r) => ({ id: r.id, name: r.name }))];
  const tri = (target: string, key: 'viewChannel' | 'sendMessages') => toTri(value.overrides.find((o) => o.target === target)?.[key]);

  return (
    <form
      className="space-y-3 rounded-md border border-line p-3"
      aria-label={`Permissões do canal ${channel.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        void onSave(value).then((ok) => {
          setBusy(false);
          if (ok) onCancel();
        });
      }}
    >
      {isText && (
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-primary">
            <input
              type="checkbox"
              checked={value.announcement}
              onChange={(event) => setValue({ ...value, announcement: event.target.checked })}
            />
            Canal de avisos
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-primary">
            Modo lento
            <select
              className={selectClass}
              value={value.slowModeSeconds}
              onChange={(event) => setValue({ ...value, slowModeSeconds: Number(event.target.value) })}
            >
              {SLOW_MODE_PRESETS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {formatSlowMode(seconds)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <p className="text-xs text-ink-muted">
        {isText && value.announcement ? 'Só quem gerencia a comunidade publica; os demais leem e reagem. ' : ''}
        O cargo vence o ajuste de todos os membros. Dono e administradores sempre passam.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th className="font-normal">Cargo</th>
            <th className="font-normal">Ver canal</th>
            {isText && <th className="font-normal">Enviar mensagens</th>}
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => (
            <tr key={target.id}>
              <td className="py-1 pr-2 text-ink-primary">{target.name}</td>
              {(isText ? (['viewChannel', 'sendMessages'] as const) : (['viewChannel'] as const)).map((key) => (
                <td key={key} className="py-1 pr-2">
                  <select
                    className={selectClass}
                    aria-label={`${key === 'viewChannel' ? 'Ver canal' : 'Enviar mensagens'}: ${target.name}`}
                    value={tri(target.id, key)}
                    onChange={(event) => setValue({ ...value, overrides: setOverride(value.overrides, target.id, key, fromTri(event.target.value as Tri)) })}
                  >
                    <option value="inherit">Herdar</option>
                    <option value="allow">Permitir</option>
                    <option value="deny">Negar</option>
                  </select>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Salvar permissões
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
