'use client';

import { useRef, useEffect } from 'react';
import { clsx } from 'clsx';
import type { PeerConnection } from '@/hooks/useWebRTC';

interface VideoTileProps {
  peer?: PeerConnection;
  stream: MediaStream | null;
  label: string;
  isLocal?: boolean;
  isScreenShare?: boolean;
}

function VideoTile({ stream, label, isLocal, isScreenShare }: VideoTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (audioRef.current) audioRef.current.srcObject = stream;
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);

  const hasAudio = stream?.getAudioTracks().length ?? 0;
  const hasVideo = stream?.getVideoTracks().length ?? 0;

  return (
    <div
      className={clsx(
        'relative rounded-2xl overflow-hidden aspect-video transition-all duration-200',
        'bg-slate-800/80 border border-white/5 hover:border-white/10',
        isScreenShare && 'col-span-2',
      )}
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
            'w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold',
            'bg-brand-600/30 text-brand-300 border border-brand-500/30',
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
          <span className="text-[10px] font-medium text-emerald-300 bg-emerald-500/20 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
            Tela
          </span>
        )}
        {hasAudio === 0 && !isLocal && (
          <span className="text-[10px] text-red-400 bg-red-500/20 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
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
}

export function VideoGrid({
  peers,
  localStream,
  localScreenStream,
  isMuted,
  localName,
}: VideoGridProps) {
  const peerArray = Array.from(peers.values());
  const total = peerArray.length + 1; // +1 for local
  const cols = total <= 2 ? 1 : total <= 4 ? 2 : total <= 6 ? 3 : 4;

  return (
    <div
      className={clsx(
        'grid gap-2 p-2 h-full auto-rows-fr',
        'sm:gap-3 sm:p-3',
        cols === 1 && 'grid-cols-1',
        cols === 2 && 'grid-cols-2',
        cols === 3 && 'grid-cols-3',
        cols === 4 && 'grid-cols-4',
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
