'use client';

import { useState, useEffect, useCallback, useRef, use } from 'react';
import Link from 'next/link';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useChat } from '@/hooks/useChat';
import { ChatPanel } from '@/components/ChatPanel';
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
    ownerId: string | null;
    inviteToken?: string;
    expiresAt: string | null;
    createdAt: string;
    status: string;
    /** Sala persistente protegida por senha (passwordHash presente) — pedir senha no join. */
    hasPassword?: boolean;
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
  // Senha de sala protegida por password (fluxo password do critic). Fica SÓ em
  // estado — nunca em localStorage (segredo efêmero por sessão de navegação).
  const [roomPassword, setRoomPassword] = useState('');

  // Extract invite token from URL query params (client-side only)
  const urlInviteTokenRef = useRef<string | null>(null);
  if (typeof window !== 'undefined' && urlInviteTokenRef.current === null) {
    const params = new URLSearchParams(window.location.search);
    urlInviteTokenRef.current = params.get('token');
  }

  // Use URL token first, then fall back to room's own inviteToken (if owner)
  const inviteToken = urlInviteTokenRef.current ?? room?.room.inviteToken ?? undefined;

  const socket = useSocket();
  const chat = useChat(roomId, socket.socket, inviteToken, roomPassword.trim() || undefined);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [chatOpen, setChatOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Persist chatOpen em localStorage
  useEffect(() => {
    const key = `scale:chatOpen:${roomId}`;
    const stored = window.localStorage.getItem(key);
    if (stored === '1') setChatOpen(true);
  }, [roomId]);

  useEffect(() => {
    const key = `scale:chatOpen:${roomId}`;
    window.localStorage.setItem(key, chatOpen ? '1' : '0');
  }, [chatOpen, roomId]);

  // Identify current user (guest if 401)
  useEffect(() => {
    api
      .getMe()
      .then((res) => setCurrentUserId(res.user.id))
      .catch(() => setCurrentUserId(null));
  }, []);

  const webrtc = useWebRTC(socket, roomId);

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

  // Sala protegida por senha exige senha antes do join — a menos que haja
  // inviteToken na URL (guest com link) ou o dono autenticado por JWT.
  const isRoomOwner =
    room?.room.ownerId != null && room?.room.ownerId === currentUserId;
  const requiresPassword = Boolean(
    room?.room.hasPassword && !inviteToken && !isRoomOwner,
  );

  // Join room when connected. `initMedia`/`connectToPeers` são useCallback
  // estáveis do useWebRTC — destruturados aqui para o effect não depender da
  // identidade do objeto `webrtc` (memoizado, mas muda quando peers/mídia
  // mudam, o que causaria re-execução/loop antes do join).
  const { initMedia, connectToPeers } = webrtc;

  /**
   * Entra na sala e forma a malha. Usado no primeiro join E no reconnect:
   * quando o socket cai, o backend perde o peer (o socketId muda na volta),
   * então sem re-join o participante fica fantasma — some da lista dos outros
   * e nenhum sinal/chat chega mais para ele. `initMedia` é idempotente.
   */
  const performJoin = useCallback((): void => {
    // `isConnected()` lê o socket vivo: no re-join a reconexão acontece fora do
    // ciclo de render, então o estado `socket.connected` ainda seria o antigo.
    if (!socket.isConnected()) return;
    // Espera a senha ser fornecida (gate abaixo) antes de tentar o join.
    if (requiresPassword && roomPassword.trim().length === 0) return;

    socket.joinRoom(roomId, socket.guestName, inviteToken, roomPassword.trim() || undefined).then(({ peers: existingPeers, history }) => {
      setJoined(true);
      // Seed chat history (persistent rooms: last 200; temporary: FIFO buffer)
      if (history.length > 0) {
        chatRef.current.setMessages(history);
      }
      // Inicializa a mídia e, em seguida, conecta aos peers que JÁ estavam na
      // sala (existingPeers do ack de join-room). O novato também inicia
      // offers (mesh bidirecional): não depende apenas do room:peer-joined
      // enviado pelos antigos — se esse evento se perder, o mesh ainda se
      // forma. A dedupe interna (peersRef + regra de socket id menor) evita
      // offers duplicadas/glare com os offers vindos do outro lado.
      initMedia().then(() => {
        if (existingPeers.length > 0) {
          void connectToPeers(existingPeers);
        }
      });
    }).catch((err) => {
      setError(err.message || 'Falha ao entrar na sala');
    });
  }, [socket, roomId, initMedia, connectToPeers, inviteToken, requiresPassword, roomPassword]);

  // Primeiro join (uma vez por sessão de sala).
  useEffect(() => {
    if (joined) return;
    performJoin();
  }, [joined, performJoin]);

  // Reconnect: o socket volta com OUTRO socketId, então o servidor não tem mais
  // este peer na sala — sem re-join a malha não se restabelece. `onReconnect`
  // dispara a partir do evento 'connect' do NAMESPACE (useSocket), já com o
  // socket conectado — o evento 'reconnect' do Manager disparava antes do ack
  // do CONNECT e o join era rejeitado com "Socket not connected".
  // Não mexemos em `joined` de propósito: ele também controla o gate de senha,
  // e zerá-lo faria a tela de senha piscar a cada oscilação de rede.
  useEffect(() => {
    return socket.onReconnect(() => {
      console.debug('[Room] reconnect detectado — re-join');
      performJoin();
    });
  }, [socket, performJoin]);

  // Aviso não bloqueante quando o socket desconecta (ex.: handshake rejeitado
  // pelo tailnet barrier, backend caiu, rede instável). Nada de bloquear a UI:
  // o effect de reconnect acima refaz o join assim que o socket voltar.
  useEffect(() => {
    if (!socket.connected && !loading) {
      toast('Desconectado — tentando reconectar...', 'error');
    }
  }, [socket.connected, loading, toast]);

  // Diagnóstico rápido no console: estado do socket x peers x mídia.
  useEffect(() => {
    console.debug(
      `[Room] socket.connected=${socket.connected} peers=${webrtc.peers.size} mediaError=${webrtc.mediaError ?? 'none'}`,
    );
  }, [socket.connected, webrtc.peers.size, webrtc.mediaError]);

  // Handle leave — resiliente: nunca fica bloqueado aguardando o servidor.
  // Se o socket estiver desconectado (ou o backend não responder), o emit não
  // é acknowledgeado e o antigo `await` travava a navegação para sempre. Agora
  // notifica o servidor em background (o hook tem timeout próprio) e navega
  // imediatamente; o cleanup de mídia é síncrono.
  const handleLeave = useCallback(() => {
    socket.leaveRoom(roomId).catch(() => {});
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

  // ─── Gate de senha ────────────────────────────────────────────
  // Sala persistente protegida por password e o usuário ainda não forneceu a
  // senha (nem veio com inviteToken, nem é o dono). A senha entra por estado,
  // dispara o join effect acima e nunca vai para localStorage.
  if (requiresPassword && !joined) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (roomPassword.trim().length >= 8) {
              setRoomPassword(roomPassword.trim());
            }
          }}
          className="w-full max-w-md bg-forest-950/60 border border-white/10 rounded-2xl p-6 space-y-4"
        >
          <div className="text-4xl">🔒</div>
          <h1 className="text-xl font-semibold text-white">Sala protegida por senha</h1>
          <p className="text-sm text-slate-400">
            Esta sala exige a senha definida pelo dono para entrar. A senha não é
            salva no navegador.
          </p>
          <input
            type="password"
            value={roomPassword}
            onChange={(e) => setRoomPassword(e.target.value)}
            placeholder="Senha da sala"
            aria-label="Senha da sala"
            minLength={8}
            required
            className="w-full rounded bg-white/5 p-2 text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-moss-500"
          />
          <Button type="submit" size="md" disabled={roomPassword.trim().length < 8}>
            Entrar na sala
          </Button>
        </form>
      </div>
    );
  }

  // ─── Room UI ─────────────────────────────────────────────────
  const roomName = room?.room.name ?? 'Sala';
  const isPrivate = room?.room.isPrivate ?? false;
  const inviteLink =
    isPrivate && inviteToken
      ? `${typeof window !== 'undefined' ? window.location.origin : ''}/room/${roomId}?token=${inviteToken}`
      : `${typeof window !== 'undefined' ? window.location.origin : ''}/room/${roomId}`;

  const isOwner = room?.room.ownerId != null && room?.room.ownerId === currentUserId;
  // Nomes para o autocomplete de menções: quem está na sala agora (guestNames)
  const currentPeers = [
    socket.guestName,
    ...Array.from(webrtc.peers.values()).map((p) => p.name),
  ];

  return (
    <div className="h-screen flex flex-col">
      {/* Skip to content */}
      <a href="#room-controls" className="skip-link">
        Skip to controls
      </a>

      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/5 bg-forest-950/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => window.location.href = '/'}>
            ←
          </Button>
          <div>
            <h1 className="text-sm font-semibold text-white">{roomName}</h1>
            <p className="text-xs text-slate-400">Sala · {roomId.slice(0, 8)}...</p>
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

      {/* Banner extra quando initMedia falhou SEM ser contexto inseguro
          (permissão negada/indisponível em https) — o banner inseguro acima já
          cobre o caso isInsecureContext. */}
      {!isInsecureContext && webrtc.mediaError && (
        <div className="mx-4 mt-3">
          <Banner
            variant="warning"
            icon="🎤"
            title="Microfone indisponível"
            description="O navegador bloqueou o acesso ao microfone (permissão negada ou contexto inseguro). A chamada segue funcionando; participantes com áudio habilitado falam normalmente."
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Video grid */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <VideoGrid
            peers={webrtc.peers}
            localStream={webrtc.localStream}
            localScreenStream={webrtc.localScreenStream}
            isMuted={webrtc.isMuted}
            localName={socket.guestName}
            inviteLink={inviteLink}
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

        {/* Chat panel */}
        {chatOpen && (
          <ChatPanel
            roomId={roomId}
            socket={socket.socket}
            chat={chat}
            currentPeers={currentPeers}
            open={chatOpen}
            onClose={() => setChatOpen(false)}
            isOwner={isOwner}
            currentUserId={currentUserId}
            guestName={socket.guestName}
            inviteToken={inviteToken}
            password={roomPassword.trim() || undefined}
          />
        )}
      </div>

      {/* Controls */}
      <div id="room-controls">
        <RoomControls
          isMuted={webrtc.isMuted}
          isDeafened={webrtc.isDeafened}
          isScreenSharing={webrtc.isScreenSharing}
          controlsDisabled={!socket.connected || Boolean(webrtc.mediaError)}
          onToggleMute={() => {
            // toggleMute retorna o NOVO estado (boolean) ou null quando não há
            // stream local — evita ler isMuted stale logo após o toggle.
            const result = webrtc.toggleMute();
            if (result === null) {
              toast('Microfone indisponível em conexão insegura — use HTTPS', 'error');
            } else {
              toast(result ? 'Microfone silenciado' : 'Microfone ativado', 'info');
            }
          }}
          onToggleDeafen={() => {
            const result = webrtc.toggleDeafen();
            if (result === null) {
              toast('Nenhum participante na sala para silenciar', 'info');
            } else {
              toast(result ? 'Áudio silenciado' : 'Áudio restaurado', 'info');
            }
          }}
          onToggleScreenShare={async () => {
            const result = await webrtc.toggleScreenShare();
            if (result === null) {
              toast('Compartilhamento de tela indisponível em conexão insegura — use HTTPS', 'error');
            } else {
              toast(result ? 'Compartilhamento de tela iniciado' : 'Compartilhamento de tela encerrado', 'info');
            }
          }}
          onLeave={handleLeave}
          inviteLink={inviteLink}
          chatUnread={chat.unread}
          showChat={chatOpen}
          onToggleChat={() => setChatOpen((prev) => !prev)}
        />
      </div>
    </div>
  );
}
