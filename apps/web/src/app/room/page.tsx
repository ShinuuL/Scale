'use client';

import { Suspense, useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useSpeaking } from '@/hooks/useSpeaking';
import { useChat } from '@/hooks/useChat';
import { ChatPanel } from '@/components/ChatPanel';
import { VideoGrid, LOCAL_ID } from '@/components/room/VideoGrid';
import { RoomControls } from '@/components/room/RoomControls';
import { ParticipantList } from '@/components/room/ParticipantList';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { ToastProvider, useToast } from '@/components/ui/Toast';
import { Icon } from '@/components/ui/Icon';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { api } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { roomUrl } from '@/lib/roomLink';

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

/**
 * Rota estatica `/room?id=<uuid>&token=<convite>`. O frontend e exportado como
 * arquivos estaticos (`output: 'export'`), entao nao existe rota dinamica
 * `/room/[id]`: o id vem da query. Links antigos `/room/<id>` sao
 * redirecionados pelo Caddy para este formato (ver Caddyfile).
 *
 * `useSearchParams` exige um limite de Suspense no export estatico.
 */
export default function RoomPage() {
  return (
    <ToastProvider>
      <Suspense fallback={<RoomLoading />}>
        <RoomRoute />
      </Suspense>
    </ToastProvider>
  );
}

function RoomLoading() {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center p-6">
      <Skeleton className="h-8 w-48" />
    </main>
  );
}

function RoomRoute() {
  const searchParams = useSearchParams();
  const roomId = searchParams.get('id')?.trim() ?? '';
  if (!roomId) {
    return (
      <main id="main-content" className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-slate-300">Link de sala incompleto: falta o identificador da sala.</p>
        <Link href="/" className="text-moss-400 underline">
          Voltar ao inicio
        </Link>
      </main>
    );
  }
  // key: trocar de sala pela URL remonta o estado inteiro da sala.
  return <RoomPageInner key={roomId} roomId={roomId} />;
}

function RoomPageInner({ roomId }: { roomId: string }) {
  const { toast } = useToast();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const [showParticipants, setShowParticipants] = useState(true);
  // Em telas estreitas a lateral vira gaveta sobreposta e começa fechada.
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches) setShowParticipants(false);
  }, []);
  const [isInsecureContext, setIsInsecureContext] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);
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
  // Nome do cadastro quando logado; senão o Guest-xxxx do socket. O backend já
  // identifica o usuário pelo cookie no handshake — este é o nome LOCAL (tile
  // "Você", lista de participantes e autor do chat/upload).
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);

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
      .then((res) => {
        setCurrentUserId(res.user.id);
        setAccountName(res.user.name);
        setAccountEmail(res.user.email);
      })
      .catch(() => {
        setCurrentUserId(null);
        setAccountName(null);
        setAccountEmail(null);
      });
  }, []);

  const webrtc = useWebRTC(socket, roomId);
  const displayName = accountName ?? socket.guestName;
  // Transmissão escolhida para o palco (null = foco automático: a de outra
  // pessoa vence a sua). Lateral e faixa de miniaturas escrevem aqui.
  const [focusedShareId, setFocusedShareId] = useState<string | null>(null);
  // Anel verde de "falando" na lateral e nos cartões. Local mudo não conta.
  const speaking = useSpeaking([
    { id: LOCAL_ID, stream: webrtc.isMuted ? null : webrtc.localStream },
    ...Array.from(webrtc.peers.values()).map((p) => ({ id: p.peerId, stream: p.stream })),
  ]);

  // Detect insecure context (HTTP on non-localhost) — blocks getUserMedia
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      setIsInsecureContext(true);
    }
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
   *
   * `mode` separa a entrada original (`'first'`: falha = tela de erro, caso
   * senha errada/sala cheia) do re-join (`'reconnect'`: falha pode ser
   * transitória — peer antigo ainda no roomPeers → "Room is full" — então
   * tenta 1x a mais antes de gritar).
   */
  // Retry agendado de re-join que falhou, e a versão atual de performJoin
  // para o retry não disparar um closure velho do useCallback.
  const rejoinRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const performJoinRef = useRef<(mode?: 'first' | 'reconnect') => void>(() => undefined);

  const performJoin = useCallback((mode: 'first' | 'reconnect' = 'first'): void => {
    // `isConnected()` lê o socket vivo: no re-join a reconexão acontece fora do
    // ciclo de render, então o estado `socket.connected` ainda seria o antigo.
    if (!socket.isConnected()) return;
    // Espera a senha ser fornecida (gate abaixo) antes de tentar o join.
    if (requiresPassword && roomPassword.trim().length === 0) return;

    // Mídia ANTES do join. Sem isso o `room:peer-joined` (emitido pelo backend
    // antes do ack do join-room) chega ao novato enquanto o prompt de permissão
    // do microfone ainda está aberto, e o PC dele nasce sem faixa de áudio.
    // `initMedia` é idempotente (no re-join a stream já está live e o retorno é
    // imediato) e já é estável (useCallback com []), então não desestabiliza a
    // identidade do performJoin. Também cobre o caso sem permissão/contexto
    // inseguro: initMedia resolve rápido e só marca mediaError.
    void initMedia().then(() => {
      if (!socket.isConnected()) return;
      socket
        .joinRoom(roomId, socket.guestName, inviteToken, roomPassword.trim() || undefined)
        .then(({ peers: existingPeers, history }) => {
          setJoined(true);
          // Limpa um erro anterior: a tela de erro tem precedência no render, e
          // sem isto um re-join bem-sucedido deixaria a pessoa presa nela.
          setError(null);
          if (rejoinRetryRef.current) {
            clearTimeout(rejoinRetryRef.current);
            rejoinRetryRef.current = null;
          }
          // Seed chat history (persistent rooms: last 200; temporary: FIFO buffer)
          if (history.length > 0) {
            chatRef.current.setMessages(history);
          }
          // Conecta aos peers que JÁ estavam na sala (existingPeers do ack de
          // join-room). O novato também inicia offers (mesh bidirecional): não
          // depende apenas do room:peer-joined enviado pelos antigos — se esse
          // evento se perder, o mesh ainda se forma. A dedupe interna (peersRef
          // + regra de socket id menor) evita offers duplicadas/glare com os
          // offers vindos do outro lado.
          // NÃO chamamos initMedia aqui de novo: ela já foi resolvida acima.
          if (existingPeers.length > 0) {
            void connectToPeers(existingPeers);
          }
        })
        .catch((err: unknown) => {
          const message =
            err instanceof Error && err.message ? err.message : 'Falha ao entrar na sala';
          if (mode === 'first') {
            setError(message);
            return;
          }
          // Re-join: não ejecta no primeiro erro. Tenta de novo em 2,5s (dá tempo
          // de o servidor processar o disconnect do peer antigo); se persistir,
          // aí sim mostra o erro — que um re-join seguinte consegue limpar.
          if (rejoinRetryRef.current === null) {
            rejoinRetryRef.current = setTimeout(() => {
              rejoinRetryRef.current = null;
              performJoinRef.current('reconnect');
            }, 2500);
            return;
          }
          setError(message);
        });
    });
  }, [socket, roomId, initMedia, connectToPeers, inviteToken, requiresPassword, roomPassword]);

  useEffect(() => {
    performJoinRef.current = performJoin;
  }, [performJoin]);

  // Zera um retry agendado ao desmontar (senão o timer dispara tarde demais).
  useEffect(() => {
    return () => {
      if (rejoinRetryRef.current) clearTimeout(rejoinRetryRef.current);
    };
  }, []);

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
      performJoin('reconnect');
    });
  }, [socket, performJoin]);

  // Aviso não bloqueante quando o socket desconecta (ex.: backend caiu, rede
  // instável). Nada de bloquear a UI:
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

  const handleCopyFlag = useCallback(async () => {
    const ok = await copyText(chromeFlagCommand);
    if (ok) {
      setCopiedFlag(true);
      setTimeout(() => setCopiedFlag(false), 2000);
    }
  }, []);

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
            {error.includes('expirou') ? (
              <Icon name="clock" size={48} />
            ) : error.includes('não encontrada') ? (
              <Icon name="search" size={48} />
            ) : (
              <Icon name="warning" size={48} />
            )}
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
          <div className="text-5xl">
            {isExpired ? <Icon name="clock" size={48} /> : <Icon name="users" size={48} />}
          </div>
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
          <div className="text-4xl"><Icon name="lock" size={36} /></div>
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
      ? roomUrl(roomId, inviteToken)
      : roomUrl(roomId);

  const isOwner = room?.room.ownerId != null && room?.room.ownerId === currentUserId;
  // Nomes para o autocomplete de menções: quem está na sala agora (guestNames)
  const currentPeers = [
    displayName,
    ...Array.from(webrtc.peers.values()).map((p) => p.name),
  ];

  return (
    <div className="h-screen flex flex-col">
      {/* Skip to content */}
      <a href="#room-controls" className="skip-link">
        Skip to controls
      </a>

      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-2 sm:px-4 py-2 border-b border-white/5 bg-forest-950/80 backdrop-blur-sm z-10">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.location.href = '/'}
            aria-label="Voltar ao início"
          >
            <Icon name="arrowLeft" />
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-white">{roomName}</h1>
            <p className="text-xs text-slate-400">Sala · {roomId.slice(0, 8)}...</p>
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-1.5 sm:gap-2">
          <Badge variant={socket.connected ? 'success' : 'error'}>
            {socket.connected ? 'Conectado' : 'Desconectado'}
          </Badge>
          <Badge variant="info" aria-live="polite" className="max-sm:hidden">
            {Array.from(webrtc.peers.size ? webrtc.peers.keys() : []).length + 1} / {room?.room.maxParticipants ?? 8}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowParticipants(!showParticipants)}
            aria-label="Mostrar/ocultar participantes"
            aria-expanded={showParticipants}
          >
            <Icon name="users" />
          </Button>
          <ProfileMenu
            name={displayName}
            email={accountEmail}
            isAuthenticated={currentUserId !== null}
          />
        </div>
      </header>

      {/* Insecure context warning */}
      {isInsecureContext && (
        <div className="mx-4 mt-3">
          <Banner
            variant="warning"
            icon={<Icon name="lock" size={18} />}
            title="Conexão não segura — microfone/tela bloqueados"
            description="Navegadores bloqueiam microfone e compartilhamento de tela em páginas HTTP fora do localhost. Acesse via HTTPS para falar com áudio, ou ative a flag do Chrome para liberar este endereço. A chamada segue funcionando sem áudio — participantes com HTTPS falam normalmente."
            action={
              <Button variant="secondary" size="sm" onClick={handleCopyFlag}>
                {copiedFlag ? (
                  <>
                    <Icon name="check" /> Flag copiada
                  </>
                ) : (
                  'Copiar comando flag'
                )}
              </Button>
            }
          />
        </div>
      )}

      {/* Banner extra quando initMedia falhou SEM ser contexto inseguro
          (permissão negada/indisponível em https) — o banner inseguro acima já
          cobre o caso isInsecureContext. */}
      {!isInsecureContext && webrtc.mediaError && (
        <div className="mx-4 mt-3">
          <Banner
            variant="warning"
            icon={<Icon name="mic" size={18} />}
            title="Microfone indisponível"
            description="O navegador bloqueou o acesso ao microfone (permissão negada ou contexto inseguro). A chamada segue funcionando; participantes com áudio habilitado falam normalmente."
          />
        </div>
      )}

      {/* Main content */}
      <div className="relative flex-1 flex min-h-0 overflow-hidden">
        {/* Lateral do canal de voz (à esquerda, como no Discord) */}
        {showParticipants && (
          <aside className="flex w-64 flex-shrink-0 flex-col p-3 pr-0 max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-30 max-md:pr-3">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-forest-900 shadow-lg shadow-black/30 max-md:shadow-2xl">
              <ParticipantList
                peers={webrtc.peers}
                localName={displayName}
                localMuted={webrtc.isMuted}
                localScreenSharing={webrtc.isScreenSharing}
                channelName={roomName}
                maxParticipants={room?.room.maxParticipants ?? 8}
                speaking={speaking}
                onWatch={setFocusedShareId}
              />
            </div>
          </aside>
        )}

        {/* Palco / grade */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <VideoGrid
            peers={webrtc.peers}
            localStream={webrtc.localStream}
            localScreenStream={webrtc.localScreenStream}
            isMuted={webrtc.isMuted}
            localName={displayName}
            inviteLink={inviteLink}
            speaking={speaking}
            focusedShareId={focusedShareId}
            onFocusShare={setFocusedShareId}
            onStopShare={() => void webrtc.toggleScreenShare()}
          />
        </div>

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
            guestName={displayName}
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
