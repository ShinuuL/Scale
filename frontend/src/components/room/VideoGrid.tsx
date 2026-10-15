'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { copyText } from '@/lib/clipboard';
import type { PeerConnection } from '@/hooks/useWebRTC';

interface VideoTileProps {
  peer?: PeerConnection;
  stream: MediaStream | null;
  label: string;
  isLocal?: boolean;
  isScreenShare?: boolean;
  /** Tile único (total === 1): permite crescer e centralizar, em vez de achatado no rodapé. */
  solo?: boolean;
}

function VideoTile({ stream, label, isLocal, isScreenShare, peer, solo }: VideoTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const hasAudio = stream?.getAudioTracks().length ?? 0;
  const hasVideo = stream?.getVideoTracks().length ?? 0;

  const displayName = isLocal ? 'Você' : label;
  const audioStatus = isLocal
    ? (peer?.audioMuted ?? false) || stream?.getAudioTracks().length === 0
      ? 'microfone desligado'
      : 'microfone ligado'
    : hasAudio === 0
      ? 'microfone desligado'
      : 'microfone ligado';
  const videoStatus = hasVideo > 0 ? 'câmera ligada' : 'câmera desligada';
  const screenStatus = isScreenShare ? ', compartilhando tela' : '';
  const ariaLabel = `${displayName}, ${audioStatus}, ${videoStatus}${screenStatus}`;

  return (
    <div
      className={clsx(
        'relative rounded-2xl overflow-hidden aspect-video transition-all duration-200',
        'bg-slate-800/80 border border-white/5 hover:border-white/10',
        solo && 'w-full max-w-2xl mx-auto min-h-[280px] sm:min-h-[360px]',
        isScreenShare && 'col-span-2',
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {/* Media elements */}
      <audio ref={audioRef} autoPlay playsInline muted={isLocal} />
      {hasVideo > 0 && isScreenShare && (
        <video ref={videoRef} autoPlay playsInline muted={isLocal} className="absolute inset-0 w-full h-full object-contain bg-black" />
      )}

      {/* Placeholder when no video */}
      {(!isScreenShare || hasVideo === 0) && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={clsx(
            'w-20 h-20 rounded-full flex items-center justify-center text-2xl font-bold',
            'bg-brand-600/30 text-brand-300 border border-brand-500/30 shadow-lg shadow-moss-600/20',
          )}>
            {label.charAt(0).toUpperCase()}
          </div>
        </div>
      )}

      {/* Label */}
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
        <span className="text-xs font-medium text-white bg-black/60 backdrop-blur-sm px-2 py-1 rounded-md">
          {isLocal ? 'Você' : label}
        </span>
      </div>

      {/* Indicators */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {isScreenShare && (
          <span className="text-xs font-medium text-emerald-300 bg-emerald-500/20 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
            Tela
          </span>
        )}
        {hasAudio === 0 && !isLocal && (
          <span className="text-xs font-medium text-red-200 bg-red-500/20 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
            Mudo
          </span>
        )}
      </div>
    </div>
  );
}

interface VideoGridProps {
  peers: Map<string, PeerConnection>;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  isMuted: boolean;
  localName?: string;
  /** Link de convite — usado no empty state "só local" (botão Copiar link). */
  inviteLink?: string;
}

export function VideoGrid({
  peers,
  localStream,
  localScreenStream,
  isMuted,
  localName,
  inviteLink,
}: VideoGridProps) {
  const peerArray = Array.from(peers.values());
  const total = peerArray.length + 1; // +1 for local
  // total 3-4 → 2 cols; 5-6 → 3 cols; 7-8 → 4 cols. (total 1-2 têm layouts próprios.)
  const cols = total <= 4 ? 2 : total <= 6 ? 3 : 4;
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');

  const handleCopyInvite = useCallback(async () => {
    if (!inviteLink) return;
    const ok = await copyText(inviteLink);
    if (ok) {
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    }
  }, [inviteLink]);

  // 1 participante (só local): tile centralizado vertical e horizontalmente —
  // não fica mais achatado/deslocado para o rodapé.
  if (total === 1) {
    return (
      <div className="flex flex-col items-center justify-center h-full min-h-0 gap-4 p-4">
        <VideoTile
          stream={localScreenStream ?? localStream}
          label={localName || 'Você'}
          isLocal
          isScreenShare={!!localScreenStream}
          solo
        />

        {inviteLink && (
          <div className="flex flex-col items-center gap-2 mt-1 text-center">
            <p className="text-sm text-slate-400">
              Você está sozinho — copie o link e convide alguém
            </p>
            <Button variant="secondary" size="sm" onClick={handleCopyInvite}>
              {copyState === 'copied' ? '✓ Link copiado' : 'Copiar link'}
            </Button>
          </div>
        )}
      </div>
    );
  }

  // 2 participantes: tiles lado a lado, centralizados no container.
  // `w-full` é obrigatório: num flex-column, `mx-auto` cancela o stretch do
  // eixo cruzado e o grid passa a medir o max-content dos tiles — que é ~0,
  // porque todo o conteúdo do tile é `absolute`. Sem `w-full` os tiles
  // colapsam para 2px (só as bordas).
  // >2: grade padrão 2/3/4 colunas (compartilhamento de tela ocupa col-span-2).
  return (
    <div
      className={clsx(
        'grid h-full',
        total === 2
          ? 'w-full grid-cols-2 gap-3 p-3 items-center content-center max-w-4xl mx-auto min-h-0'
          : 'gap-2 p-2 auto-rows-fr sm:gap-3 sm:p-3',
        total > 2 && cols === 2 && 'grid-cols-2',
        total > 2 && cols === 3 && 'grid-cols-3',
        total > 2 && cols === 4 && 'grid-cols-4',
      )}
      role="region"
      aria-label="Grade de participantes"
    >
      {/* Local tile — mostra tela se compartilhando, senão áudio */}
      <VideoTile
        stream={localScreenStream ?? localStream}
        label={localName || 'Você'}
        isLocal
        isScreenShare={!!localScreenStream}
      />

      {/* Remote peers */}
      {peerArray.map((peer) => (
        <VideoTile
          key={peer.peerId}
          peer={peer}
          stream={peer.isScreenSharing ? (peer.stream ?? peer.screenStream) : peer.stream}
          label={peer.name}
          isScreenShare={peer.isScreenSharing}
        />
      ))}
    </div>
  );
}
