'use client';

import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { callScreenPath } from '@/lib/callControl';

export interface MiniCallBarProps {
  roomId: string;
  communityId?: string | null;
  roomName: string;
  connected: boolean;
  participants: number;
  isMuted: boolean;
  isSpeaking: boolean;
  onToggleMute: () => void;
  onLeave: () => void;
}

/** Barra "Em chamada" mostrada fora da rota da sala: a ligação continua ativa. */
export function MiniCallBar({
  roomId,
  communityId,
  roomName,
  connected,
  participants,
  isMuted,
  isSpeaking,
  onToggleMute,
  onLeave,
}: MiniCallBarProps) {
  return (
    <section
      aria-label="Chamada em andamento"
      className="fixed bottom-4 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded-2xl border border-line bg-surface-secondary/95 py-2 pl-3 pr-2 shadow-2xl backdrop-blur max-lg:bottom-[calc(76px+env(safe-area-inset-bottom))]"
    >
      <span
        aria-hidden="true"
        className={`h-2.5 w-2.5 shrink-0 rounded-full ${
          !connected
            ? 'bg-amber-400'
            : isSpeaking
              ? 'bg-emerald-400 ring-4 ring-emerald-400/25'
              : 'bg-emerald-500'
        }`}
      />
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-emerald-400">
          {connected ? 'Em chamada' : 'Reconectando'}
        </p>
        <p className="truncate text-sm font-semibold text-ink-primary">
          {roomName}
          <span className="ml-1.5 font-normal text-ink-muted">
            {participants} {participants === 1 ? 'pessoa' : 'pessoas'}
          </span>
        </p>
      </div>
      <div className="ml-1 flex items-center gap-1">
        <Tooltip label={isMuted ? 'Ativar microfone' : 'Silenciar microfone'}>
          <button
            type="button"
            onClick={onToggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Ativar microfone' : 'Silenciar microfone'}
            className={`flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full transition-colors ${
              isMuted
                ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25'
                : 'text-ink-secondary hover:bg-surface-hover hover:text-ink-primary'
            }`}
          >
            <Icon name={isMuted ? 'micOff' : 'mic'} size={18} />
          </button>
        </Tooltip>
        <Tooltip label="Voltar para a sala">
          <Link
            href={callScreenPath(roomId, communityId)}
            aria-label="Voltar para a sala"
            className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink-primary"
          >
            <Icon name="maximize" size={18} />
          </Link>
        </Tooltip>
        <Tooltip label="Sair da chamada">
          <button
            type="button"
            onClick={onLeave}
            aria-label="Sair da chamada"
            className="flex h-11 w-11 sm:h-9 sm:w-9 items-center justify-center rounded-full bg-red-500 text-white transition-colors hover:bg-red-600"
          >
            <Icon name="phone" size={18} className="rotate-[135deg]" />
          </button>
        </Tooltip>
      </div>
    </section>
  );
}
