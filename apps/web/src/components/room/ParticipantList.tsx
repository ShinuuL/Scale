'use client';

import { clsx } from 'clsx';
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover, type Key } from 'react-aria-components';
import { Icon } from '@/components/ui/Icon';
import { SpeakingBars } from '@/components/room/SpeakingBars';
import type { PeerConnection } from '@/hooks/useWebRTC';
import { LOCAL_ID } from '@/components/room/VideoGrid';

interface Participant {
  id: string;
  name: string;
  isLocal: boolean;
  isMuted: boolean;
  isLive: boolean;
}

interface ParticipantListProps {
  peers: Map<string, PeerConnection>;
  localName?: string;
  localMuted: boolean;
  localScreenSharing: boolean;
  /** Nome do canal (a sala), mostrado no cabeçalho como no Discord. */
  channelName?: string;
  maxParticipants?: number;
  /** Ids (LOCAL_ID ou peerId) de quem está falando agora. */
  speaking?: Set<string>;
  /** Clicar em "Ao vivo" leva a transmissão daquela pessoa para o palco. */
  onWatch?: (id: string) => void;
  /** Abre a denúncia de um participante (nunca de si mesmo). */
  onReport?: (peerId: string) => void;
  /** Dono da sala: encerra a partilha de tela de quem está ao vivo. */
  onStopShare?: (peerId: string) => void;
}

/** Menu de ações sobre OUTRO participante (react-aria): denunciar e, para o dono, encerrar a partilha. */
function ParticipantMenu({
  name,
  onReport,
  onStopShare,
}: {
  name: string;
  onReport?: () => void;
  onStopShare?: () => void;
}) {
  const onAction = (key: Key) => {
    if (key === 'report') onReport?.();
    if (key === 'stop-share') onStopShare?.();
  };
  const itemClass =
    'flex min-h-[44px] w-full cursor-pointer items-center gap-3 rounded-lg px-2.5 text-left text-sm text-ink-primary outline-none transition-colors hover:bg-white/[0.06] focus:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-brand-400/60';
  return (
    <MenuTrigger>
      <AriaButton
        aria-label={`Opções de ${name}`}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted outline-none transition-colors hover:bg-surface-hover hover:text-ink-primary data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent aria-expanded:bg-surface-hover"
      >
        <Icon name="more" size={16} />
      </AriaButton>
      <Popover
        placement="bottom end"
        offset={6}
        className="z-50 w-56 rounded-xl border border-white/10 bg-forest-900 p-1.5 shadow-[0_12px_40px_rgb(0_0_0/0.3)] data-[entering]:animate-menu-in"
      >
        <Menu aria-label={`Ações sobre ${name}`} onAction={onAction} className="outline-none">
          {onStopShare && (
            <MenuItem id="stop-share" textValue="Encerrar partilha" className={itemClass}>
              <Icon name="monitor" size={16} className="text-ink-muted" />
              Encerrar partilha
            </MenuItem>
          )}
          {onReport && (
            <MenuItem id="report" textValue="Denunciar" className={clsx(itemClass, 'text-red-300 hover:bg-red-500/10 focus:bg-red-500/10')}>
              <Icon name="flag" size={16} />
              Denunciar
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}

/** Lateral do canal de voz: quem está no canal, quem fala, quem está ao vivo. */
export function ParticipantList({
  peers,
  localName,
  localMuted,
  localScreenSharing,
  channelName,
  maxParticipants,
  speaking = new Set<string>(),
  onWatch,
  onReport,
  onStopShare,
}: ParticipantListProps) {
  const participants: Participant[] = [
    {
      id: LOCAL_ID,
      name: localName || 'Você',
      isLocal: true,
      isMuted: localMuted,
      isLive: localScreenSharing,
    },
    ...Array.from(peers.values()).map((p) => ({
      id: p.peerId,
      name: p.name,
      isLocal: false,
      isMuted: p.audioMuted,
      isLive: p.isScreenSharing,
    })),
  ];

  return (
    <nav aria-label="Participantes da sala" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5 text-ink-secondary">
        <span
          aria-hidden="true"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent"
        >
          <Icon name="speaker" size={16} />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
          {channelName ?? 'Participantes'}
        </h2>
        <span
          className="rounded-full border border-line px-2 py-0.5 text-xs font-medium tabular-nums text-ink-secondary"
          aria-label={`${participants.length} de ${maxParticipants ?? 8} participantes`}
        >
          {participants.length}/{maxParticipants ?? 8}
        </span>
      </div>

      <p className="px-4 pb-1 pt-3 text-xs font-medium text-ink-muted" aria-hidden="true">
        Participantes
      </p>
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2" aria-label="Participantes">
        {participants.map((p) => {
          const isSpeaking = speaking.has(p.id);
          return (
            <li
              key={p.id}
              className="flex min-h-[44px] items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-surface-hover motion-reduce:transition-none"
            >
              <span
                aria-hidden="true"
                className={clsx(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  'bg-accent-subtle text-accent transition-shadow duration-150 motion-reduce:transition-none',
                  isSpeaking
                    ? 'ring-2 ring-[var(--status-online)] ring-offset-2 ring-offset-surface-secondary animate-speak-pulse motion-reduce:animate-none'
                    : '',
                )}
              >
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span
                className={clsx(
                  'min-w-0 flex-1 truncate text-sm',
                  isSpeaking ? 'text-white' : 'text-ink-secondary',
                )}
              >
                {p.name}
                {p.isLocal && <span className="text-ink-muted"> (você)</span>}
                {isSpeaking && <span className="sr-only">, falando</span>}
              </span>
              {isSpeaking && !p.isMuted && <SpeakingBars active size="sm" />}
              {p.isLive &&
                (onWatch && !p.isLocal ? (
                  <button
                    type="button"
                    onClick={() => onWatch(p.id)}
                    aria-label={`Assistir transmissão de ${p.name}`}
                    className="rounded bg-accent-subtle px-1.5 py-0.5 text-xs font-medium text-white hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    Ao vivo
                  </button>
                ) : (
                  <span className="rounded bg-accent-subtle px-1.5 py-0.5 text-xs font-medium text-white">
                    Ao vivo
                  </span>
                ))}
              {p.isMuted && (
                <Icon
                  name="micOff"
                  size={16}
                  className="text-red-400"
                  title="Microfone desligado"
                />
              )}
              {!p.isLocal && (onReport || (onStopShare && p.isLive)) && (
                <ParticipantMenu
                  name={p.name}
                  onReport={onReport ? () => onReport(p.id) : undefined}
                  onStopShare={onStopShare && p.isLive ? () => onStopShare(p.id) : undefined}
                />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
