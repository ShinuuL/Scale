'use client';

import { clsx } from 'clsx';
import { Icon } from '@/components/ui/Icon';
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
    <nav aria-label="Canal de voz" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-4 py-3.5 text-slate-300">
        <span aria-hidden="true" className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
          <Icon name="speaker" size={16} />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
          {channelName ?? 'Canal de voz'}
        </h2>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-300" aria-label={`${participants.length} de ${maxParticipants ?? 8} participantes`}>
          {participants.length}/{maxParticipants ?? 8}
        </span>
      </div>

      <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500" aria-hidden="true">
        No canal
      </p>
      <ul className="scales min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2" aria-label="Participantes">
        {participants.map((p) => {
          const isSpeaking = speaking.has(p.id);
          return (
            <li
              key={p.id}
              className="flex min-h-[44px] items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-white/[0.06] motion-reduce:transition-none"
            >
              <span
                aria-hidden="true"
                className={clsx(
                  'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                  'bg-brand-600/30 text-brand-200 transition-shadow duration-150 motion-reduce:transition-none',
                  isSpeaking ? 'ring-2 ring-brand-400 ring-offset-2 ring-offset-forest-900' : '',
                )}
              >
                {p.name.charAt(0).toUpperCase()}
              </span>
              <span className={clsx('min-w-0 flex-1 truncate text-sm', isSpeaking ? 'text-white' : 'text-slate-300')}>
                {p.name}
                {p.isLocal && <span className="text-slate-500"> (você)</span>}
                {isSpeaking && <span className="sr-only">, falando</span>}
              </span>
              {p.isLive &&
                (onWatch && !p.isLocal ? (
                  <button
                    type="button"
                    onClick={() => onWatch(p.id)}
                    aria-label={`Assistir transmissão de ${p.name}`}
                    className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white hover:bg-red-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
                  >
                    Ao vivo
                  </button>
                ) : (
                  <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Ao vivo
                  </span>
                ))}
              {p.isMuted && (
                <Icon name="micOff" size={16} className="text-red-400" title="Microfone desligado" />
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
