'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';

interface RoomControlsProps {
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleScreenShare: () => void;
  onLeave: () => void;
  inviteLink?: string;
}

export function RoomControls({
  isMuted,
  isDeafened,
  isScreenSharing,
  onToggleMute,
  onToggleDeafen,
  onToggleScreenShare,
  onLeave,
  inviteLink,
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
      className="flex items-center justify-center gap-2 px-4 py-3 border-t border-white/5 bg-slate-950/60 backdrop-blur-xl transition-colors"
      role="toolbar"
      aria-label="Controles da sala"
    >
      {/* Mute */}
      <Button
        variant={isMuted ? 'danger' : 'secondary'}
        onClick={onToggleMute}
        aria-label={isMuted ? 'Ativar microfone' : 'Desativar microfone'}
        aria-pressed={!isMuted}
        title={isMuted ? 'Ativar microfone' : 'Desativar microfone'}
      >
        <span aria-hidden="true">{isMuted ? '🔇' : '🎤'}</span>
        <span className="hidden sm:inline">{isMuted ? 'Mudo' : 'Mic'}</span>
      </Button>

      {/* Deafen */}
      <Button
        variant={isDeafened ? 'danger' : 'secondary'}
        onClick={onToggleDeafen}
        aria-label={isDeafened ? 'Ativar áudio' : 'Desativar áudio'}
        aria-pressed={!isDeafened}
        title={isDeafened ? 'Ativar áudio' : 'Desativar áudio'}
      >
        <span aria-hidden="true">{isDeafened ? '🔕' : '🔊'}</span>
        <span className="hidden sm:inline">{isDeafened ? 'Surdo' : 'Áudio'}</span>
      </Button>

      {/* Screen share */}
      <Button
        variant={isScreenSharing ? 'primary' : 'secondary'}
        onClick={onToggleScreenShare}
        aria-label={isScreenSharing ? 'Parar compartilhar tela' : 'Compartilhar tela'}
        aria-pressed={isScreenSharing}
        title={isScreenSharing ? 'Parar compartilhar tela' : 'Compartilhar tela'}
      >
        <span aria-hidden="true">{isScreenSharing ? '🖥️' : '🖥️'}</span>
        <span className="hidden sm:inline">{isScreenSharing ? 'Parar tela' : 'Tela'}</span>
      </Button>

      {/* Copy invite link */}
      {inviteLink && (
        <Button
          variant="ghost"
          onClick={copyInvite}
          aria-label="Copiar link de convite"
          title="Copiar link de convite"
        >
          <span aria-hidden="true">{copied ? '✓' : '🔗'}</span>
          <span className="hidden sm:inline">{copied ? 'Copiado' : 'Link'}</span>
        </Button>
      )}

      <div className="w-px h-8 bg-white/10 mx-2" aria-hidden="true" />

      {/* Leave */}
      <Button
        variant="danger"
        onClick={onLeave}
        aria-label="Sair da sala"
      >
        <span aria-hidden="true">📞</span>
        <span className="hidden sm:inline">Sair</span>
      </Button>
    </div>
  );
}
