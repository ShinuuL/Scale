'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { AudioDeviceSettings } from './AudioDeviceSettings';
import type { AudioDevicesState } from '@/hooks/useAudioDevices';

interface RoomControlsProps {
  audioDevices?: AudioDevicesState;
  isChangingMicrophone?: boolean;
  isMuted: boolean;
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
  audioDevices,
  isChangingMicrophone = false,
  isMuted,
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
      className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-3 border-t border-line bg-surface-secondary"
      role="toolbar"
      aria-label="Controles da sala"
    >
      {/* Mute */}
      <Button
        className="max-sm:px-3.5"
        variant={isMuted ? 'danger' : 'secondary'}
        onClick={onToggleMute}
        disabled={controlsDisabled}
        aria-label={isMuted ? 'Ativar microfone' : 'Desativar microfone'}
        aria-pressed={!isMuted}
        title={isMuted ? 'Ativar microfone' : 'Desativar microfone'}
      >
        <span aria-hidden="true">{isMuted ? <Icon name="micOff" /> : <Icon name="mic" />}</span>
        <span className="hidden sm:inline">{isMuted ? 'Mudo' : 'Mic'}</span>
      </Button>

      {audioDevices && <AudioDeviceSettings devices={audioDevices} busy={isChangingMicrophone} />}

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
        <span aria-hidden="true">
          {isDeafened ? <Icon name="speakerOff" /> : <Icon name="speaker" />}
        </span>
        <span className="hidden sm:inline">{isDeafened ? 'Sem áudio' : 'Áudio'}</span>
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
          <span aria-hidden="true">
            <Icon name="chat" />
          </span>
          <span className="hidden sm:inline">Chat</span>
          {chatUnread > 0 && !showChat && (
            <span className="badge bg-accent-solid text-white">
              {chatUnread > 99 ? '99+' : chatUnread}
            </span>
          )}
        </Button>
      )}

      <div className="w-px h-8 bg-surface-tertiary mx-0.5 sm:mx-2" aria-hidden="true" />

      {/* Leave */}
      <Button
        className="max-sm:px-3.5"
        variant="danger"
        onClick={onLeave}
        aria-label="Sair da sala"
      >
        <span aria-hidden="true">
          <Icon name="phone" />
        </span>
        <span className="hidden sm:inline">Sair</span>
      </Button>
    </div>
  );
}
