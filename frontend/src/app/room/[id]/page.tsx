'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import Link from 'next/link';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { VideoGrid } from '@/components/room/VideoGrid';
import { RoomControls } from '@/components/room/RoomControls';
import { ParticipantList } from '@/components/room/ParticipantList';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { api } from '@/lib/api';
import { buildTailscaleHttpsUrl, buildTailscaleHttpUrl } from '@/lib/tailscale';
import { copyText } from '@/lib/clipboard';

interface RoomData {
  room: {
    id: string;
    name: string;
    isPersistent: boolean;
    isPrivate: boolean;
    maxParticipants: number;
    inviteToken?: string;
    expiresAt: string | null;
    createdAt: string;
    status: string;
  };
}

export default function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <ToastProvider>
      <RoomPageInner params={params} />
    </ToastProvider>
  );
}

function RoomPageInner({ params }: { params: Promise<{ id: string }> }) {
  const { id: roomId } = use(params);
  const { toast } = useToast();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [showParticipants, setShowParticipants] = useState(true);
  const [isInsecureContext, setIsInsecureContext] = useState(false);
  const [tailscaleIp, setTailscaleIp] = useState<string | null>(null);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const [copiedTsLink, setCopiedTsLink] = useState(false);

  const socket = useSocket();

  // Extract invite token from URL query params (client-side only)
  const urlInviteTokenRef = useRef<string | null>(null);
  if (typeof window !== 'undefined' && urlInviteTokenRef.current === null) {
    const params = new URLSearchParams(window.location.search);
    urlInviteTokenRef.current = params.get('token');
  }

  // Use URL token first, then fall back to room's own inviteToken (if owner)
  const inviteToken = urlInviteTokenRef.current ?? room?.room.inviteToken ?? undefined;

  const webrtc = useWebRTC(socket, roomId, inviteToken);

  // Detect insecure context (HTTP on non-localhost) — blocks getUserMedia
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setIsInsecureContext(true);
    }
  }, []);

  // Tailscale IP do servidor (para link HTTP compartilhável) — não bloqueia
  useEffect(() => {
    api
      .getTailscaleStatus()
      .then((status) => setTailscaleIp(status.tailscaleIp))
      .catch(() => {});
  }, []);

  // Fetch room info — via Next.js rewrite (same-origin, sem CORS)
  useEffect(() => {
    const fetchRoom = async () => {
      try {
        const res = await fetch(`/api/rooms/${roomId}`, { credentials: 'include' });

        if (res.status === 404) {
          setError('Sala não encontrada');
          return;
        }
        if (res.status === 410) {
          setError('Esta sala expirou');
          return;
        }
        if (!res.ok) {
          setError('Erro ao carregar sala');
          return;
        }

        const data = await res.json();
        setRoom(data);
      } catch {
        setError('Falha ao conectar ao servidor');
      } finally {
        setLoading(false);
      }
    };

    fetchRoom();
  }, [roomId]);

  // Join room when connected
  useEffect(() => {
    if (!socket.connected || joined) return;

    socket.joinRoom(roomId, socket.guestName, inviteToken).then(({ peers: existingPeers }) => {
      setJoined(true);
      // Initialize media
      webrtc.initMedia().then(() => {
        // For existing peers, we already received them via peer-joined events
        // The WebRTC hook handles creating offers when we join
        // But existing peers need to be connected to us
        // The socket handler already sent them peer-joined events
      });
    }).catch((err) => {
      setError(err.message || 'Falha ao entrar na sala');
    });
  }, [socket.connected, roomId, socket, joined, webrtc, inviteToken]);

  // Handle leave
  const handleLeave = useCallback(async () => {
    await socket.leaveRoom(roomId);
    webrtc.cleanupMedia();
    window.location.href = '/';
  }, [socket, roomId, webrtc]);

  // ─── Insecure context actions ───────────────────────────────
  const chromeFlagCommand = 'chrome://flags/#unsafely-treat-insecure-origin-as-secure';
  const tailscaleHttpUrl = buildTailscaleHttpUrl(tailscaleIp, `/room/${roomId}`);
  const httpsUrl = buildTailscaleHttpsUrl(`/room/${roomId}`);

  const handleCopyFlag = useCallback(async () => {
    const ok = await copyText(chromeFlagCommand);
    if (ok) {
      setCopiedFlag(true);
      setTimeout(() => setCopiedFlag(false), 2000);
    }
  }, []);

  const handleCopyTsLink = useCallback(async () => {
    const ok = await copyText(tailscaleHttpUrl);
    if (ok) {
      setCopiedTsLink(true);
      setTimeout(() => setCopiedTsLink(false), 2000);
    }
  }, [tailscaleHttpUrl]);

  // Room expired status
  const isExpired = room?.room.expiresAt
    ? new Date(room.room.expiresAt) < new Date()
    : false;

  const isFull = false; // Would need to check participant count

  // ─── Error / Loading states ──────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4">
          <Skeleton className="h-12 !rounded-2xl" />
          <Skeleton className="h-64 !rounded-2xl" />
          <Skeleton className="h-16 !rounded-xl" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-5xl">
            {error.includes('expirou') ? '⏰' : error.includes('não encontrada') ? '🔍' : '⚠️'}
          </div>
          <h1 className="text-xl font-semibold text-white">{error}</h1>
          <Button onClick={() => window.location.href = '/'}>
            Voltar ao Início
          </Button>
        </div>
      </div>
    );
  }

  if (isExpired || isFull) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-md">
          <div className="text-5xl">{isExpired ? '⏰' : '👥'}</div>
          <h1 className="text-xl font-semibold text-white">
            {isExpired ? 'Esta sala expirou' : 'Sala cheia'}
          </h1>
          <p className="text-sm text-slate-400">
            {isExpired
              ? 'Crie uma nova sala para continuar.'
              : 'Tente novamente mais tarde ou entre em outra sala.'}
          </p>
          <Button onClick={() => window.location.href = '/'}>
            Criar Nova Sala
          </Button>
        </div>
      </div>
    );
  }

  // ─── Room UI ─────────────────────────────────────────────────
  const roomName = room?.room.name ?? 'Sala';
  const isPrivate = room?.room.isPrivate ?? false;

  return (
    <div className="h-screen flex flex-col">
      {/* Skip to content */}
      <a href="#room-controls" className="skip-link">
        Skip to controls
      </a>

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-slate-950/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => window.location.href = '/'}>
            ←
          </Button>
          <div>
            <h1 className="text-sm font-semibold text-white">{roomName}</h1>
            <p className="text-xs text-slate-500">Sala · {roomId.slice(0, 8)}...</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={socket.connected ? 'success' : 'error'}>
            {socket.connected ? 'Conectado' : 'Desconectado'}
          </Badge>
          <Badge variant="info" aria-live="polite">
            {Array.from(webrtc.peers.size ? webrtc.peers.keys() : []).length + 1} / {room?.room.maxParticipants ?? 8}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowParticipants(!showParticipants)}
            aria-label="Mostrar/ocultar participantes"
            aria-expanded={showParticipants}
          >
            👥
          </Button>
        </div>
      </header>

      {/* Insecure context warning */}
      {isInsecureContext && (
        <div className="mx-4 mt-3">
          <Banner
            variant="warning"
            icon="🔒"
            title="Conexão não segura — microfone/tela bloqueados"
            description="Navegadores bloqueiam microfone e compartilhamento de tela em páginas HTTP fora do localhost. Acesse via HTTPS para falar com áudio, ou ative a flag do Chrome para liberar este endereço. A chamada segue funcionando sem áudio — participantes com HTTPS falam normalmente."
            action={
              <>
                <Button variant="secondary" size="sm" onClick={handleCopyFlag}>
                  {copiedFlag ? '✓ Flag copiada' : 'Copiar comando flag'}
                </Button>
                {httpsUrl ? (
                  <a
                    className="btn-primary text-xs px-3 py-1.5 rounded-lg"
                    href={httpsUrl}
                    aria-label={`Abrir sala via HTTPS (${httpsUrl})`}
                  >
                    Abrir via HTTPS
                  </a>
                ) : (
                  <Link
                    href="/tutorial"
                    className="btn-ghost text-xs px-3 py-1.5 rounded-lg"
                    aria-label="Ver instruções de configuração HTTPS no guia"
                  >
                    Ver guia HTTPS
                  </Link>
                )}
              </>
            }
          >
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="bg-amber-500/10 px-1.5 py-0.5 rounded text-xs font-mono break-all">
                {tailscaleHttpUrl}
              </code>
              <Button variant="ghost" size="sm" onClick={handleCopyTsLink}>
                {copiedTsLink ? '✓ Copiado' : 'Copiar link Tailscale'}
              </Button>
            </div>
          </Banner>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video grid */}
        <div className="flex-1 overflow-hidden">
          <VideoGrid
            peers={webrtc.peers}
            localStream={webrtc.localStream}
            localScreenStream={webrtc.localScreenStream}
            isMuted={webrtc.isMuted}
            localName={socket.guestName}
          />
        </div>

        {/* Participant sidebar */}
        {showParticipants && (
          <aside className="w-64 border-l border-white/5 bg-slate-900/30 backdrop-blur-sm p-3 overflow-auto flex-shrink-0 transition-all">
            <ParticipantList
              peers={webrtc.peers}
              localName={socket.guestName}
              localMuted={webrtc.isMuted}
              localScreenSharing={webrtc.isScreenSharing}
            />
          </aside>
        )}
      </div>

      {/* Controls */}
      <div id="room-controls">
        <RoomControls
          isMuted={webrtc.isMuted}
          isDeafened={webrtc.isDeafened}
          isScreenSharing={webrtc.isScreenSharing}
          onToggleMute={() => {
            webrtc.toggleMute();
            toast(webrtc.isMuted ? 'Microfone ativado' : 'Microfone silenciado', 'info');
          }}
          onToggleDeafen={() => {
            webrtc.toggleDeafen();
            toast(webrtc.isDeafened ? 'Áudio restaurado' : 'Áudio silenciado', 'info');
          }}
          onToggleScreenShare={async () => {
            await webrtc.toggleScreenShare();
            toast(webrtc.isScreenSharing ? 'Compartilhamento de tela iniciado' : 'Compartilhamento de tela encerrado', 'info');
          }}
          onLeave={handleLeave}
          inviteLink={
            isPrivate && inviteToken
              ? `${typeof window !== 'undefined' ? window.location.origin : ''}/room/${roomId}?token=${inviteToken}`
              : `${typeof window !== 'undefined' ? window.location.origin : ''}/room/${roomId}`
          }
        />
      </div>
    </div>
  );
}
