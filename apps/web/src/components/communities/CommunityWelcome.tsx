'use client';

import { useState } from 'react';
import {
  DEFAULT_WELCOME_MESSAGE,
  MAX_PARTICIPANTS,
  VOICE_USER_LIMIT_MIN,
  WELCOME_MESSAGE_MAX,
  WELCOME_NAME_TOKEN,
  renderWelcomeMessage,
} from '@scale/shared';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import type { Channel } from './CommunityParts';

/**
 * Fase 3: limite do canal de voz (linha do canal nas configuracoes) e secao do
 * canal de boas-vindas. Separado de CommunityDialogs para manter aquele
 * arquivo enxuto.
 */
const selectClass = 'rounded-lg border border-line bg-surface-secondary p-2 text-sm text-ink-primary';
const LIMIT_OPTIONS = Array.from(
  { length: MAX_PARTICIPANTS - VOICE_USER_LIMIT_MIN + 1 },
  (_, index) => VOICE_USER_LIMIT_MIN + index,
);

/** Seletor do limite de pessoas: "Sem limite" ou 2..8 (teto do mesh). */
export function VoiceLimitSelect({
  channel,
  run,
}: {
  channel: Channel;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  return (
    <label className="text-sm text-ink-primary">
      <span className="sr-only">Limite de pessoas do canal {channel.name}</span>
      <select
        className={selectClass}
        value={channel.userLimit ? String(channel.userLimit) : ''}
        onChange={(event) => {
          const value = event.target.value ? Number(event.target.value) : null;
          void run(() => api.setChannelUserLimit(channel.id, value));
        }}
      >
        <option value="">Sem limite</option>
        {LIMIT_OPTIONS.map((limit) => (
          <option key={limit} value={limit}>
            {limit} pessoas
          </option>
        ))}
      </select>
    </label>
  );
}

/** Canal de texto + modelo com {nome}; "Nenhum" desliga as boas-vindas. */
export function WelcomeSection({
  communityId,
  channels,
  welcome,
  run,
}: {
  communityId: string;
  channels: Channel[];
  welcome: { channelId: string; message: string } | null | undefined;
  run: (action: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [channelId, setChannelId] = useState(welcome?.channelId ?? '');
  const [message, setMessage] = useState(welcome?.message ?? DEFAULT_WELCOME_MESSAGE);
  const textChannels = channels.filter((channel) => channel.kind === 'TEXT');
  const trimmed = message.trim();
  return (
    <section className="space-y-2" aria-labelledby="welcome-heading">
      <h3 id="welcome-heading" className="font-semibold text-ink-primary">
        Boas-vindas
      </h3>
      <p className="text-sm text-ink-muted">
        Quem entra por convite abre a comunidade neste canal, que recebe uma mensagem do sistema. Use{' '}
        {WELCOME_NAME_TOKEN} para o nome da pessoa.
      </p>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!trimmed) return;
          void run(() => api.setCommunityWelcome(communityId, { channelId: channelId || null, message: trimmed }));
        }}
      >
        <label className="block text-sm text-ink-primary">
          Canal de boas-vindas
          <select
            className={`${selectClass} mt-1 w-full`}
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
          >
            <option value="">Nenhum (desligado)</option>
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm text-ink-primary">
          Mensagem de boas-vindas
          <textarea
            className={`${selectClass} mt-1 w-full`}
            rows={2}
            maxLength={WELCOME_MESSAGE_MAX}
            required
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        {trimmed && (
          <p className="text-xs text-ink-muted" data-testid="welcome-preview">
            Prévia: {renderWelcomeMessage(trimmed, 'Ana')}
          </p>
        )}
        <Button type="submit" size="sm" aria-disabled={!trimmed}>
          Salvar boas-vindas
        </Button>
      </form>
    </section>
  );
}
