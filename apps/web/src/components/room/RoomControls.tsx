'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { clsx } from 'clsx';
import { Icon } from '@/components/ui/Icon';
import { SpeakingBars } from '@/components/room/SpeakingBars';

interface RoomControlsProps {
  isMuted: boolean;
  /** A sua voz está sendo captada agora (acende o botão do microfone). */
  isSpeaking?: boolean;
  /** Você está falando com o microfone desligado (mostra o aviso "Você está mudo"). */
  talkingWhileMuted?: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  /** Desabilita os controles de mídia (socket desconectado ou mediaError). O botão Sair continua ativo. */
  controlsDisabled?: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  inviteLink?: string;
  /** Unread messages count — badge shown only when chat is closed. */
  chatUnread?: number;
  /** Whether the chat panel is currently visible. */
  showChat?: boolean;
  /** Toggle chat panel open/close. */
  onToggleChat?: () => void;
}

export function RoomControls({
  isMuted,
  isSpeaking = false,
  talkingWhileMuted = false,
  isDeafened,
  isScreenSharing,
  controlsDisabled = false,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onLeave,
  inviteLink,
  chatUnread = 0,
  showChat = false,
  onToggleChat,
}: RoomControlsProps) {
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-3 border-t border-white/5 bg-forest-950/60 backdrop-blur-xl transition-colors"
      role="toolbar"
      aria-label="Controles da sala"
    >
      {/* Mute (acende enquanto a sua voz é captada; avisa se fala mudo) */}
      <div className="relative">
        {talkingWhileMuted && (
          <span
            role="status"
            className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-red-600 px-2 py-1 text-xs font-semibold text-white shadow-lg animate-fade-in-fast"
          >
            Você está mudo
          </span>
        )}
        <Button
          className={clsx(
            'max-sm:px-3.5',
            isSpeaking && !isMuted && 'ring-2 ring-brand-400 animate-speak-pulse motion-reduce:animate-none',
          )}
          variant={isMuted ? 'danger' : 'secondary'}
          onClick={onToggleMute}
          disabled={controlsDisabled}
          aria-label={isMuted ? 'Ativar microfone' : 'Desativar microfone'}
          aria-pressed={!isMuted}
          title={isMuted ? 'Ativar microfone' : 'Desativar microfone'}
        >
          <span aria-hidden="true">{isMuted ? <Icon name="micOff" /> : <Icon name="mic" />}</span>
          {isSpeaking && !isMuted ? (
            <SpeakingBars active size="sm" className="hidden sm:inline-flex" />
          ) : (
            <span className="hidden sm:inline">{isMuted ? 'Mudo' : 'Mic'}</span>
          )}
        </Button>
      </div>

      {/* Deafen */}
      <Button
        className="max-sm:px-3.5"
        variant={isDeafened ? 'danger' : 'secondary'}
        onClick={onToggleDeafen}
        disabled={controlsDisabled}
        aria-label={isDeafened ? 'Ativar áudio' : 'Desativar áudio'}
        aria-pressed={!isDeafened}
        title={isDeafened ? 'Ativar áudio' : 'Desativar áudio'}
      >
        <span aria-hidden="true">{isDeafened ? <Icon name="speakerOff" /> : <Icon name="speaker" />}</span>
        <span className="hidden sm:inline">{isDeafened ? 'Surdo' : 'Áudio'}</span>
      </Button>

      {/* Screen share */}
      <Button
        className="max-sm:px-3.5"
        variant={isScreenSharing ? 'primary' : 'secondary'}
        onClick={onToggleScreenShare}
        disabled={controlsDisabled}
        aria-label={isScreenSharing ? 'Parar compartilhar tela' : 'Compartilhar tela'}
        aria-pressed={isScreenSharing}
        title={isScreenSharing ? 'Parar compartilhar tela' : 'Compartilhar tela'}
      >
        <span aria-hidden="true">
          <Icon name="monitor" />
        </span>
        <span className="hidden sm:inline">{isScreenSharing ? 'Parar tela' : 'Tela'}</span>
      </Button>

      {/* Copy invite link */}
      {inviteLink && (
        <Button
          className="max-sm:px-3.5"
          variant="ghost"
          onClick={copyInvite}
          aria-label="Copiar link de convite"
          title="Copiar link de convite"
        >
          <span aria-hidden="true">{copied ? <Icon name="check" /> : <Icon name="link" />}</span>
          <span className="hidden sm:inline">{copied ? 'Copiado' : 'Link'}</span>
        </Button>
      )}

      {/* Chat toggle */}
      {onToggleChat && (
        <Button
          className="max-sm:px-3.5"
          variant={showChat ? 'primary' : 'secondary'}
          onClick={onToggleChat}
          aria-label={showChat ? 'Fechar chat' : 'Abrir chat'}
          aria-pressed={showChat}
          title={showChat ? 'Fechar chat' : 'Abrir chat'}
        >
          <span aria-hidden="true"><Icon name="chat" /></span>
          <span className="hidden sm:inline">Chat</span>
          {chatUnread > 0 && !showChat && (
            <span className="badge bg-amber-500 text-forest-950">
              {chatUnread > 99 ? '99+' : chatUnread}
            </span>
          )}
        </Button>
      )}

      <div className="w-px h-8 bg-white/10 mx-0.5 sm:mx-2" aria-hidden="true" />

      {/* Leave */}
      <Button
        className="max-sm:px-3.5"
        variant="danger"
        onClick={onLeave}
        aria-label="Sair da sala"
      >
        <span aria-hidden="true"><Icon name="phone" /></span>
        <span className="hidden sm:inline">Sair</span>
      </Button>
    </div>
  );
}
