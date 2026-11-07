'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { clsx } from 'clsx';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { copyText } from '@/lib/clipboard';
import { setAudioSink } from '@/hooks/useAudioDevices';
import type { PeerConnection } from '@/hooks/useWebRTC';

/** Id da transmissão/participante local (os remotos usam o peerId). */
export const LOCAL_ID = 'local';

/** Uma tela compartilhada ativa (alguém "Ao vivo"). */
export interface LiveShare {
  id: string;
  name: string;
  stream: MediaStream;
  isLocal: boolean;
}

function hasLiveVideo(stream: MediaStream | null): stream is MediaStream {
  return !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');
}

/** Transmissões ativas: a local primeiro, depois as remotas na ordem dos peers. */
export function collectLiveShares(
  peers: Map<string, PeerConnection>,
  localScreenStream: MediaStream | null,
  localName: string,
): LiveShare[] {
  const shares: LiveShare[] = [];
  if (hasLiveVideo(localScreenStream)) {
    shares.push({ id: LOCAL_ID, name: localName, stream: localScreenStream, isLocal: true });
  }
  peers.forEach((peer) => {
    if (peer.isScreenSharing && hasLiveVideo(peer.screenStream)) {
      shares.push({ id: peer.peerId, name: peer.name, stream: peer.screenStream, isLocal: false });
    }
  });
  return shares;
}

/**
 * Foco padrão do palco: a transmissão de OUTRA pessoa vence a sua (ninguém
 * precisa ver o próprio espelho gigante); um foco escolhido continua valendo
 * enquanto a transmissão existir.
 */
export function resolveFocus(shares: LiveShare[], requested: string | null): LiveShare | null {
  if (shares.length === 0) return null;
  return (
    shares.find((s) => s.id === requested) ?? shares.find((s) => !s.isLocal) ?? shares[0]
  );
}

// ─── Áudio ──────────────────────────────────────────────────────

/**
 * Um `<audio>` por peer remoto, FORA dos tiles: trocar o layout (palco ↔
 * grade, foco) não desmonta o elemento e o som não corta.
 */
function PeerAudio({ stream, outputDeviceId, onOutputError }: { stream: MediaStream | null; outputDeviceId: string; onOutputError?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    audioEl.srcObject = stream;
    if (!stream) return;

    // Abrir a URL direto no Chrome pode deixar o elemento PAUSADO pela política
    // de autoplay — play() explícito + nova tentativa no primeiro gesto.
    const tryPlay = () => {
      const p = audioEl.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    };
    tryPlay();
    const cleanup = () => {
      window.removeEventListener('pointerdown', onFirstGesture, true);
      window.removeEventListener('keydown', onFirstGesture, true);
    };
    const onFirstGesture = () => {
      tryPlay();
      cleanup();
    };
    window.addEventListener('pointerdown', onFirstGesture, true);
    window.addEventListener('keydown', onFirstGesture, true);
    return cleanup;
  }, [stream]);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    let active = true;
    void setAudioSink(element, outputDeviceId).catch(() => {
      if (!active) return;
      void setAudioSink(element, '').catch(() => {});
      onOutputError?.();
    });
    return () => { active = false; };
  }, [outputDeviceId, onOutputError]);

  return <audio ref={audioRef} autoPlay playsInline />;
}

// ─── Peças visuais ──────────────────────────────────────────────

function StreamVideo({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className={className} />;
}

function Avatar({
  name,
  speaking,
  size,
  src,
}: {
  name: string;
  speaking: boolean;
  size: 'lg' | 'md' | 'sm';
  /** Foto de perfil; sem ela (ou se falhar ao carregar) mostra a inicial. */
  src?: string;
}) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const showPhoto = Boolean(src) && !broken;

  return (
    <div
      className={clsx(
        'rounded-full flex items-center justify-center font-semibold select-none overflow-hidden',
        'bg-brand-600/30 text-brand-200 border border-brand-500/30',
        'ring-offset-2 ring-offset-slate-900 transition-shadow duration-150 motion-reduce:transition-none',
        speaking ? 'ring-[3px] ring-brand-400' : 'ring-0',
        size === 'lg' && 'w-24 h-24 text-3xl',
        size === 'md' && 'w-16 h-16 text-xl',
        size === 'sm' && 'w-10 h-10 text-sm',
      )}
      aria-hidden="true"
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL blob:/same-origin; next/image nao se aplica (export estatico)
        <img src={src} alt="" className="h-full w-full object-cover" draggable={false} onError={() => setBroken(true)} />
      ) : (
        name.charAt(0).toUpperCase()
      )}
    </div>
  );
}

function LiveBadge({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        'bg-red-600 text-white',
        className,
      )}
    >
      Ao vivo
    </span>
  );
}

interface Member {
  id: string;
  name: string;
  isLocal: boolean;
  muted: boolean;
  avatarUrl?: string;
}

/** Cartão de participante do canal de voz (sem vídeo: avatar + nome). */
function MemberCard({ member, speaking, compact }: { member: Member; speaking: boolean; compact?: boolean }) {
  const label = member.isLocal ? `${member.name} (você)` : member.name;
  return (
    <div
      role="group"
      aria-label={`${label}, ${member.muted ? 'microfone desligado' : 'microfone ligado'}${speaking ? ', falando' : ''}`}
      className={clsx(
        'scales relative flex items-center justify-center rounded-xl bg-slate-800/80 border transition-colors duration-150',
        speaking ? 'border-brand-400/70' : 'border-white/5',
        compact ? 'h-full w-full' : 'aspect-video w-full',
      )}
    >
      <Avatar name={member.name} speaking={speaking} size={compact ? 'sm' : 'lg'} src={member.avatarUrl} />
      <span className="absolute bottom-2 left-2 max-w-[75%] truncate rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
        {label}
      </span>
      {member.muted && (
        <span className="absolute bottom-2 right-2 rounded-md bg-black/60 p-1 text-red-300">
          <Icon name="micOff" size={14} title="Microfone desligado" />
        </span>
      )}
    </div>
  );
}

// ─── Grade ──────────────────────────────────────────────────────

interface VideoGridProps {
  outputDeviceId?: string;
  onOutputError?: () => void;
  peers: Map<string, PeerConnection>;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  isMuted: boolean;
  localName?: string;
  /** Link de convite — usado no estado "só você na sala". */
  inviteLink?: string;
  /** Ids (LOCAL_ID ou peerId) de quem está falando agora. */
  speaking?: Set<string>;
  /** Transmissão em foco no palco (controlada pela página; a lateral também foca). */
  focusedShareId?: string | null;
  onFocusShare?: (id: string) => void;
  /** Encerra a própria transmissão (botão do cartão "Você está transmitindo"). */
  onStopShare?: () => void;
  /** Fotos de perfil por id (LOCAL_ID ou peerId); sem entrada = inicial do nome. */
  avatars?: Map<string, string>;
}

export function VideoGrid({
  outputDeviceId = '',
  onOutputError,
  peers,
  localStream,
  localScreenStream,
  isMuted,
  localName,
  inviteLink,
  speaking = new Set<string>(),
  focusedShareId = null,
  onFocusShare,
  onStopShare,
  avatars,
}: VideoGridProps) {
  const name = localName || 'Você';
  const peerArray = Array.from(peers.values());
  const members: Member[] = [
    { id: LOCAL_ID, name, isLocal: true, muted: isMuted || !localStream, avatarUrl: avatars?.get(LOCAL_ID) },
    ...peerArray.map((p) => ({
      id: p.peerId,
      name: p.name,
      isLocal: false,
      avatarUrl: avatars?.get(p.peerId),
      muted: p.audioMuted || (p.stream?.getAudioTracks().length ?? 0) === 0,
    })),
  ];
  const shares = collectLiveShares(peers, localScreenStream, name);
  const focused = resolveFocus(shares, focusedShareId);

  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle');
  const handleCopyInvite = useCallback(async () => {
    if (!inviteLink) return;
    if (await copyText(inviteLink)) {
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 2000);
    }
  }, [inviteLink]);

  const audioLayer = (
    <div className="hidden" aria-hidden="true">
      {peerArray.map((peer) => (
        <PeerAudio key={peer.peerId} stream={peer.stream} outputDeviceId={outputDeviceId} onOutputError={onOutputError} />
      ))}
    </div>
  );

  if (focused) {
    return (
      <>
        {audioLayer}
        <Stage
          focused={focused}
          shares={shares}
          members={members}
          speaking={speaking}
          viewers={peerArray.length}
          onFocusShare={onFocusShare}
          onStopShare={onStopShare}
        />
      </>
    );
  }

  const total = members.length;
  return (
    <>
      {audioLayer}
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-auto p-4">
        <div
          role="region"
          aria-label="Participantes do canal de voz"
          className={clsx(
            'grid w-full gap-3',
            total === 1 && 'max-w-xl grid-cols-1',
            total === 2 && 'max-w-4xl grid-cols-1 sm:grid-cols-2',
            total >= 3 && total <= 4 && 'max-w-4xl grid-cols-2',
            total >= 5 && 'max-w-6xl grid-cols-2 md:grid-cols-3 xl:grid-cols-4',
          )}
        >
          {members.map((m) => (
            <MemberCard key={m.id} member={m} speaking={speaking.has(m.id)} />
          ))}
        </div>

        {total === 1 && inviteLink && (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm text-slate-400">Você está sozinho no canal. Copie o link e convide alguém.</p>
            <Button variant="secondary" size="sm" onClick={handleCopyInvite}>
              {copyState === 'copied' ? (
                <>
                  <Icon name="check" /> Link copiado
                </>
              ) : (
                'Copiar link'
              )}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Palco (Go Live) ────────────────────────────────────────────

interface StageProps {
  focused: LiveShare;
  shares: LiveShare[];
  members: Member[];
  speaking: Set<string>;
  viewers: number;
  onFocusShare?: (id: string) => void;
  onStopShare?: () => void;
}

function Stage({ focused, shares, members, speaking, viewers, onFocusShare, onStopShare }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  // A própria tela fica num cartão por padrão: espelhar a tela que você está
  // transmitindo cria o "túnel infinito" e não informa nada. Prévia é opt-in.
  const [showOwnPreview, setShowOwnPreview] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void stageRef.current?.requestFullscreen().catch(() => {});
    }
  }, []);

  const otherShares = shares.filter((s) => s.id !== focused.id);
  const ownCard = focused.isLocal && !showOwnPreview;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 sm:gap-3 sm:p-3">
      <div
        ref={stageRef}
        role="region"
        aria-label={`Transmissão de ${focused.isLocal ? 'você' : focused.name}`}
        className="group relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-black"
      >
        {ownCard ? (
          <div className="flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600/15 text-red-400">
              <Icon name="monitor" size={28} />
            </span>
            <p className="text-base font-semibold text-white">Você está transmitindo sua tela</p>
            <p className="text-sm text-slate-400">
              {viewers === 0
                ? 'Ninguém mais está no canal ainda.'
                : `${viewers} ${viewers === 1 ? 'pessoa pode' : 'pessoas podem'} assistir.`}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => setShowOwnPreview(true)}>
                <Icon name="eye" /> Mostrar prévia
              </Button>
              {onStopShare && (
                <Button variant="danger" size="sm" onClick={onStopShare}>
                  Parar transmissão
                </Button>
              )}
            </div>
          </div>
        ) : (
          <StreamVideo stream={focused.stream} className="h-full w-full object-contain" />
        )}

        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          <LiveBadge />
          <span className="rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
            {focused.isLocal ? 'Sua tela' : focused.name}
          </span>
        </div>

        <div className="absolute right-3 top-3 flex items-center gap-2">
          {focused.isLocal && showOwnPreview && (
            <button
              type="button"
              onClick={() => setShowOwnPreview(false)}
              className="rounded-md bg-black/60 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
            >
              Ocultar prévia
            </button>
          )}
          {!ownCard && (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              className="flex h-11 w-11 items-center justify-center rounded-lg bg-black/60 text-white hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
            >
              <Icon name={isFullscreen ? 'minimize' : 'maximize'} size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Faixa: outras transmissões (clicáveis) + participantes do canal */}
      <ul
        aria-label="Transmissões e participantes"
        className="flex h-24 flex-shrink-0 gap-2 overflow-x-auto sm:h-28"
      >
        {otherShares.map((share) => (
          <li key={`share-${share.id}`} className="aspect-video h-full flex-shrink-0">
            <button
              type="button"
              onClick={() => onFocusShare?.(share.id)}
              aria-label={`Assistir transmissão de ${share.isLocal ? 'você' : share.name}`}
              className="relative h-full w-full overflow-hidden rounded-lg border border-white/10 bg-black hover:border-brand-400/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
            >
              {share.isLocal ? (
                <span className="flex h-full items-center justify-center text-slate-400">
                  <Icon name="monitor" size={22} />
                </span>
              ) : (
                <StreamVideo stream={share.stream} className="h-full w-full object-cover" />
              )}
              <LiveBadge className="absolute left-1.5 top-1.5" />
              <span className="absolute bottom-1.5 left-1.5 max-w-[85%] truncate rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
                {share.isLocal ? 'Sua tela' : share.name}
              </span>
            </button>
          </li>
        ))}
        {members.map((m) => (
          <li key={`member-${m.id}`} className="aspect-video h-full flex-shrink-0">
            <MemberCard member={m} speaking={speaking.has(m.id)} compact />
          </li>
        ))}
      </ul>
    </div>
  );
}
