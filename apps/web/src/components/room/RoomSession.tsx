'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Link from 'next/link';
import { useSocket } from '@/hooks/useSocket';
import { useWebRTC } from '@/hooks/useWebRTC';
import { useDisconnectNotice } from '@/hooks/useDisconnectNotice';
import { useRoomDeleted } from '@/hooks/useRoomDeleted';
import { useSpeaking } from '@/hooks/useSpeaking';
import { useChat } from '@/hooks/useChat';
import { usePeerAvatars } from '@/hooks/usePeerAvatars';
import { useScreenModeration } from '@/hooks/useScreenModeration';
import type { ModerationConfig } from '@scale/shared';
import { ScreenShareGateDialog } from '@/components/room/ScreenShareGateDialog';
import { ReportDialog } from '@/components/room/ReportDialog';
import { ChatPanel } from '@/components/ChatPanel';
import { VideoGrid, LOCAL_ID } from '@/components/room/VideoGrid';
import { RoomControls } from '@/components/room/RoomControls';
import { InviteFriendsDialog } from '@/components/calls/InviteFriendsDialog';
import { ParticipantList } from '@/components/room/ParticipantList';
import { DeleteRoomDialog } from '@/components/room/DeleteRoomDialog';
import { AppShell } from '@/components/layout/AppShell';
import { LeaveRoomDialog } from '@/components/room/LeaveRoomDialog';
import { useRoomNavigation } from '@/components/room/useRoomNavigation';
import { Badge } from '@/components/ui/Badge';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { MiniCallBar } from '@/components/room/MiniCallBar';
import { Icon } from '@/components/ui/Icon';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { api, avatarUrl, applyMeAdmin, screenShareGateOf, type MeUser } from '@/lib/api';
import { copyText } from '@/lib/clipboard';
import { subscribeAudioDeviceChange } from '@/lib/audioDevices';
import { roomUrl } from '@/lib/roomLink';
import { roomInviteHeaders } from '@/lib/roomAccess';
import { setFlash } from '@/lib/flash';

/** Id interno do medidor que detecta fala com o microfone desligado. */
const MUTED_PROBE_ID = 'local-muted-probe';

/**
 * Sala privada sem credencial (nem dono, nem convite valido no header) vem
 * reduzida a `{ id, isPrivate: true, hasPassword }`: por isso os demais campos
 * sao opcionais e a UI usa fallbacks (nome "Sala", teto 8).
 */
interface RoomData {
  room: {
    id: string;
    name?: string;
    isPersistent?: boolean;
    isPrivate: boolean;
    maxParticipants?: number;
    ownerId?: string | null;
    inviteToken?: string;
    expiresAt?: string | null;
    createdAt?: string;
    status?: string;
    /** Sala persistente protegida por senha (passwordHash presente) — pedir senha no join. */
    hasPassword?: boolean;
    /** Quem pede pode apagar a sala (dono ou admin do sistema). */
    canDelete?: boolean;
  };
}

export interface RoomSessionProps {
  roomId: string;
  communityId?: string | null;
  /** false: a pessoa navegou para outra área; a chamada continua montada. */
  visible: boolean;
  onJoinedChange: (joined: boolean) => void;
}

/**
 * Sessão da sala (socket, WebRTC e chat). Vive no `RoomHost` do layout raiz, não
 * na rota: navegar para Amigos ou Ajuda esconde a tela e mantém a ligação.
 */
export function RoomSession({ roomId, communityId, visible, onJoinedChange }: RoomSessionProps) {
  const { toast } = useToast();
  const [room, setRoom] = useState<RoomData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [joined, setJoined] = useState(false);
  const { pendingDestination, requestNavigation, allowNavigation, cancelNavigation } =
    useRoomNavigation(joined);
  useEffect(() => {
    onJoinedChange(joined);
  }, [joined, onJoinedChange]);
  const [isInsecureContext, setIsInsecureContext] = useState(false);
  const [copiedFlag, setCopiedFlag] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const chat = useChat(roomId, socket.socket);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const [chatOpen, setChatOpen] = useState(false);
  // Lista de amigos para chamar alguem para esta sala (so conta logada).
  const [inviteFriendsOpen, setInviteFriendsOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Nome do cadastro quando logado; senão o Guest-xxxx do socket. O backend já
  // identifica o usuário pelo cookie no handshake — este é o nome LOCAL (tile
  // "Você", lista de participantes e autor do chat/upload).
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [account, setAccount] = useState<MeUser | null>(null);
  // Moderacao: config publica (amostragem de tela, idade minima, versao do
  // termo), dialogo do gate de partilha e denuncia de participante.
  const [moderationConfig, setModerationConfig] = useState<ModerationConfig | null>(null);
  const [gateOpen, setGateOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ peerId: string; name: string } | null>(null);
  const screenShareGate = screenShareGateOf(account);
  const screenShareGateRef = useRef(screenShareGate);
  screenShareGateRef.current = screenShareGate;

  useEffect(() => {
    let alive = true;
    api
      .getModerationConfig()
      .then((c) => alive && setModerationConfig(c))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Admin mudou a configuracao (moderation:config): o intervalo de amostragem
  // e o gate passam a usar o valor novo sem sair da sala.
  useEffect(() => socket.onModerationConfig((c) => setModerationConfig(c)), [socket]);

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
        setAccount(res.user);
      })
      .catch(() => {
        setCurrentUserId(null);
        setAccountName(null);
        setAccountEmail(null);
      });
  }, []);

  const webrtc = useWebRTC(socket, roomId, chat.roomTicket);

  // Peers atuais para callbacks de socket (fora do ciclo de render).
  const webrtcPeersRef = useRef(webrtc.peers);
  webrtcPeersRef.current = webrtc.peers;

  // Amostragem de tela para o assistente (so enquanto EU compartilho e o
  // servidor tem a analise de tela ligada).
  useScreenModeration({
    roomId,
    stream: webrtc.localScreenStream,
    enabled: moderationConfig?.screen === true,
    intervalSec: moderationConfig?.frameIntervalSec ?? 20,
    ticket: chat.roomTicket,
  });

  // Gate mudou no servidor (idade/consentimento salvos em qualquer aba).
  useEffect(
    () =>
      socket.onMeScreenShare((gate) => {
        setAccount((prev) => (prev ? { ...prev, screenShare: gate } : prev));
      }),
    [socket],
  );

  // Papel de admin concedido/removido por outro admin: o menu muda sem recarregar.
  useEffect(
    () =>
      socket.onMeAdmin((event) => {
        setAccount((prev) => (prev ? applyMeAdmin(prev, event) : prev));
      }),
    [socket],
  );

  // Partilha encerrada a forca: para a UI, avisa a causa.
  const { screenShareStoppedBy, clearScreenShareStop } = webrtc;
  useEffect(() => {
    if (!screenShareStoppedBy) return;
    toast(
      screenShareStoppedBy === 'assistant'
        ? 'Sua partilha de tela foi encerrada pelo assistente de moderação.'
        : screenShareStoppedBy === 'owner'
          ? 'Sua partilha de tela foi encerrada pelo dono da sala.'
          : 'Partilha de tela não liberada. Veja Configurações > Privacidade.',
      'error',
    );
    clearScreenShareStop();
  }, [screenShareStoppedBy, clearScreenShareStop, toast]);

  // Aviso de moderacao so para o autor (texto ou tela com severidade media).
  useEffect(
    () =>
      socket.onModerationWarning((data) => {
        if (data.roomId && data.roomId !== roomId) return;
        toast(data.text, 'error');
      }),
    [socket, roomId, toast],
  );

  // Dono da sala: denuncia ou alerta do assistente sobre um peer.
  const [notice, setNotice] = useState<{ peerId: string; name: string; kind: 'frame' | 'report' | 'text' } | null>(null);
  useEffect(
    () =>
      socket.onModerationNotice((data) => {
        if (data.roomId !== roomId) return;
        const peerName = webrtcPeersRef.current.get(data.peerId)?.name ?? 'participante';
        setNotice({ peerId: data.peerId, name: peerName, kind: data.kind });
        toast(
          data.kind === 'report'
            ? `Denúncia sobre ${peerName}`
            : `Alerta do assistente sobre ${peerName}`,
          'info',
        );
      }),
    [socket, roomId, toast],
  );

  useEffect(() => {
    const publish = (active: boolean) => {
      document.documentElement.dataset.scaleCallActive = String(active);
      window.dispatchEvent(new CustomEvent('scale:call-state', { detail: { active } }));
    };
    publish(joined);
    return () => publish(false);
  }, [joined]);

  const toggleMediaMute = webrtc.toggleMute;
  useEffect(() => {
    const toggleMute = () => {
      if (!joined) return;
      const muted = toggleMediaMute();
      if (muted !== null) toast(muted ? 'Microfone silenciado' : 'Microfone ativado', 'info');
    };
    window.addEventListener('scale:toggle-mute', toggleMute);
    return () => window.removeEventListener('scale:toggle-mute', toggleMute);
  }, [joined, toggleMediaMute, toast]);
  const displayName = accountName ?? socket.guestName;

  // Fotos de perfil na chamada: a propria vem de /api/me/avatar; a dos outros
  // participantes logados, pela rota da sala (room ticket no header).
  const registeredPeerIds = Array.from(webrtc.peers.values())
    .filter((p) => p.isRegistered)
    .map((p) => p.peerId);
  const peerAvatars = usePeerAvatars(roomId, registeredPeerIds, chat.roomTicket);
  const ownAvatar = avatarUrl(account?.avatarUpdatedAt);
  const callAvatars = useMemo(() => {
    const map = new Map(peerAvatars);
    if (ownAvatar) map.set(LOCAL_ID, ownAvatar);
    return map;
  }, [peerAvatars, ownAvatar]);
  // Transmissão escolhida para o palco (null = foco automático: a de outra
  // pessoa vence a sua). Lateral e faixa de miniaturas escrevem aqui.
  const [focusedShareId, setFocusedShareId] = useState<string | null>(null);
  // Mudo, a faixa enviada fica desligada (só silêncio). Para avisar "Você
  // está mudo" quando a pessoa fala assim mesmo, mede uma CÓPIA ligada da
  // faixa — ela nunca é enviada a ninguém e é parada ao desmutar.
  const [mutedProbe, setMutedProbe] = useState<MediaStream | null>(null);
  useEffect(() => {
    const track = webrtc.isMuted ? webrtc.localStream?.getAudioTracks()[0] : undefined;
    if (!track || track.readyState !== 'live') {
      setMutedProbe(null);
      return;
    }
    const copy = track.clone();
    copy.enabled = true;
    setMutedProbe(new MediaStream([copy]));
    return () => copy.stop();
  }, [webrtc.isMuted, webrtc.localStream]);
  // Halo e barrinhas de "falando" na lateral e nos cartões. Local mudo não conta.
  const speaking = useSpeaking([
    { id: LOCAL_ID, stream: webrtc.isMuted ? null : webrtc.localStream },
    { id: MUTED_PROBE_ID, stream: mutedProbe },
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
        // Convite da URL vai em header: sala privada so devolve os detalhes
        // (nome, teto, expiracao) para dono ou convite valido.
        const res = await fetch(`/api/rooms/${roomId}`, {
          credentials: 'include',
          headers: roomInviteHeaders(urlInviteTokenRef.current ?? undefined),
        });

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
  const isRoomOwner = room?.room.ownerId != null && room?.room.ownerId === currentUserId;
  const requiresPassword = Boolean(room?.room.hasPassword && !inviteToken && !isRoomOwner);

  // Join room when connected. `initMedia`/`connectToPeers` são useCallback
  // estáveis do useWebRTC — destruturados aqui para o effect não depender da
  // identidade do objeto `webrtc` (memoizado, mas muda quando peers/mídia
  // mudam, o que causaria re-execução/loop antes do join).
  const { initMedia, connectToPeers, switchMicrophone, isMutedNow } = webrtc;

  // Troca de microfone ao vivo (escolhido nas configurações).
  useEffect(
    () =>
      subscribeAudioDeviceChange(({ kind, deviceId }) => {
        // Antes de entrar não liga o microfone: o initMedia já usa o salvo.
        if (kind !== 'input' || !joined) return;
        void switchMicrophone(deviceId).then((ok) => {
          if (!ok) toast('Não foi possível trocar o microfone', 'error');
        });
      }),
    [switchMicrophone, toast, joined],
  );

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

  const performJoin = useCallback(
    (mode: 'first' | 'reconnect' = 'first'): void => {
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
          .joinRoom(
            roomId,
            socket.guestName,
            inviteToken,
            roomPassword.trim() || undefined,
            // Mudo/sem microfone na entrada: os outros veem o icone desde o inicio.
            isMutedNow(),
          )
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
    },
    [socket, roomId, initMedia, connectToPeers, isMutedNow, inviteToken, requiresPassword, roomPassword],
  );

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

  // Aviso não bloqueante quando o socket CAI (backend caiu, rede instável) —
  // só na transição conectado → desconectado, nunca na conexão inicial. O
  // effect de reconnect acima refaz o join assim que o socket voltar.
  useDisconnectNotice(socket.connected, () => {
    toast('Desconectado — tentando reconectar...', 'error');
  });

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
  const handleLeave = useCallback(
    (destination = '/') => {
      allowNavigation();
      socket.leaveRoom(roomId).catch(() => {});
      webrtc.cleanupMedia();
      window.location.href = destination;
    },
    [socket, roomId, webrtc, allowNavigation],
  );

  // Logoff (menu de perfil): encerra a chamada sem o aviso de "sair da página";
  // quem disparou recarrega a página em seguida.
  useEffect(() => {
    const endCall = () => {
      allowNavigation();
      socket.leaveRoom(roomId).catch(() => {});
      webrtc.cleanupMedia();
    };
    window.addEventListener('scale:end-call', endCall);
    return () => window.removeEventListener('scale:end-call', endCall);
  }, [allowNavigation, socket, roomId, webrtc]);

  // Sala apagada por outra pessoa: limpa a midia e volta para a home com aviso.
  const navigateFromDeletedRoom = useCallback(
    (href: string) => {
      allowNavigation();
      window.location.href = href;
    },
    [allowNavigation],
  );
  const deletingByMeRef = useRoomDeleted(
    socket,
    roomId,
    webrtc.cleanupMedia,
    navigateFromDeletedRoom,
  );

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
  const isExpired = room?.room.expiresAt ? new Date(room.room.expiresAt) < new Date() : false;

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
          <Button onClick={() => (window.location.href = '/')}>Voltar ao Início</Button>
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
          <p className="text-sm text-ink-muted">
            {isExpired
              ? 'Crie uma nova sala para continuar.'
              : 'Tente novamente mais tarde ou entre em outra sala.'}
          </p>
          <Button onClick={() => (window.location.href = '/')}>Criar Nova Sala</Button>
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
          className="w-full max-w-md bg-surface-secondary border border-line rounded-2xl p-6 space-y-4"
        >
          <div className="text-4xl">
            <Icon name="lock" size={36} />
          </div>
          <h1 className="text-xl font-semibold text-white">Sala protegida por senha</h1>
          <p className="text-sm text-ink-muted">
            Esta sala exige a senha definida pelo dono para entrar. A senha não é salva no
            navegador.
          </p>
          <input
            type="password"
            value={roomPassword}
            onChange={(e) => setRoomPassword(e.target.value)}
            placeholder="Senha da sala"
            aria-label="Senha da sala"
            minLength={8}
            required
            className="w-full rounded bg-surface-tertiary p-2 text-sm text-ink-primary placeholder:text-ink-muted focus:outline-none focus:ring-1 focus:ring-accent"
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
  const inviteLink = isPrivate && inviteToken ? roomUrl(roomId, inviteToken) : roomUrl(roomId);

  const isOwner = room?.room.ownerId != null && room?.room.ownerId === currentUserId;
  // Nomes para o autocomplete de menções: quem está na sala agora (guestNames)
  const currentPeers = [displayName, ...Array.from(webrtc.peers.values()).map((p) => p.name)];

  // Partilha de tela com gate: parar nunca pergunta; iniciar passa pelo
  // dialogo (idade + termo + confirmacao) e so entao pede a tela ao navegador.
  const startOrStopScreenShare = async (confirmed: boolean) => {
    const result = await webrtc.toggleScreenShare({
      canShare: () => confirmed && screenShareGateRef.current.allowed,
    });
    if (result === 'gated') {
      setGateOpen(true);
      return;
    }
    if (result === null) {
      toast('Compartilhamento não iniciado. Consulte o aviso da captura.', 'info');
    } else {
      toast(result ? 'Compartilhamento de tela iniciado' : 'Compartilhamento de tela encerrado', 'info');
    }
  };

  const stopPeerShare = (peerId: string) => {
    const peerName = webrtc.peers.get(peerId)?.name ?? 'participante';
    socket
      .emitModerationStopShare(roomId, peerId)
      .then(() => toast(`Partilha de ${peerName} encerrada`, 'info'))
      .catch((err: unknown) =>
        toast(err instanceof Error && err.message ? err.message : 'Não foi possível encerrar a partilha.', 'error'),
      );
  };

  const leaveFromMiniBar = () => handleLeave(window.location.pathname + window.location.search);

  return (
    <>
      <div hidden={!visible} inert={!visible}>
        <AppShell
          activeSection="room"
          title={roomName}
          contextSidebar={
            <ParticipantList
              peers={webrtc.peers}
              localName={displayName}
              localMuted={webrtc.isMuted}
              localScreenSharing={webrtc.isScreenSharing}
              channelName={roomName}
              maxParticipants={room?.room.maxParticipants ?? 8}
              speaking={speaking}
              onWatch={setFocusedShareId}
              onReport={(peerId) => {
                const peer = webrtc.peers.get(peerId);
                if (peer) setReportTarget({ peerId, name: peer.name });
              }}
              onStopShare={isOwner ? stopPeerShare : undefined}
            />
          }
          accountSlot={
            <ProfileMenu
              name={displayName}
              email={accountEmail}
              isAuthenticated={currentUserId !== null}
              user={account}
              onUserChange={(user) => {
                setAccount(user);
                setAccountName(user.name);
              }}
            />
          }
          actions={
            <div className="flex items-center gap-2">
              {communityId && <Link href={`/communities?c=${encodeURIComponent(communityId)}`} className="btn-secondary text-sm px-3 py-2">Voltar à comunidade</Link>}
              <Badge variant={socket.connected ? 'success' : 'error'}>
                {socket.connected ? 'Conectado' : 'Reconectando'}
              </Badge>
              {room?.room.canDelete && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Apagar sala"
                  title="Apagar sala"
                  aria-haspopup="dialog"
                >
                  <Icon name="trash" />
                </Button>
              )}
            </div>
          }
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <a href="#room-controls" className="skip-link">
              Ir para os controles da sala
            </a>
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
                  description="Não foi possível usar o microfone solicitado. Abra Configurações, na seção Áudio, para escolher outro ou tentar novamente após conferir a permissão. Você ainda pode ouvir os participantes e compartilhar tela."
                />
              </div>
            )}

            {(webrtc.screenShareError || webrtc.isScreenSharing) && (
              <div
                role="status"
                aria-live="polite"
                className="mx-4 mt-3 rounded-lg border border-line bg-surface-secondary px-4 py-2 text-sm text-ink-secondary"
              >
                {webrtc.screenShareError ||
                  (webrtc.screenAudioAvailable
                    ? 'Tela com áudio. Use fones para reduzir eco.'
                    : 'Tela sem áudio. A fonte escolhida não forneceu áudio; o microfone continua independente.')}
              </div>
            )}

            {/* Main content */}
            <div className="relative flex-1 flex min-h-0 overflow-hidden">
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
                  onStopShare={() => void startOrStopScreenShare(false)}
                  avatars={callAvatars}
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
                  guestName={displayName}
                />
              )}
            </div>

            {/* Controls */}
            <div id="room-controls">
              <RoomControls
                isSpeaking={speaking.has(LOCAL_ID)}
                talkingWhileMuted={webrtc.isMuted && speaking.has(MUTED_PROBE_ID)}
                isMuted={webrtc.isMuted}
                isDeafened={webrtc.isDeafened}
                isScreenSharing={webrtc.isScreenSharing}
                controlsDisabled={!socket.connected}
                onToggleMute={() => {
                  // toggleMute retorna o NOVO estado (boolean) ou null quando não há
                  // stream local — evita ler isMuted stale logo após o toggle.
                  const result = webrtc.toggleMute();
                  if (result === null) {
                    toast(
                      'Microfone indisponível. Escolha um dispositivo e verifique a permissão.',
                      'error',
                    );
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
                onToggleScreenShare={() => void startOrStopScreenShare(false)}
                onLeave={() => {
                  if (requestNavigation('/')) handleLeave();
                }}
                inviteLink={inviteLink}
                chatUnread={chat.unread}
                showChat={chatOpen}
                onToggleChat={() => setChatOpen((prev) => !prev)}
                onInviteFriend={
                  currentUserId !== null ? () => setInviteFriendsOpen(true) : undefined
                }
              />
            </div>

            {inviteFriendsOpen && (
              <InviteFriendsDialog roomId={roomId} onClose={() => setInviteFriendsOpen(false)} />
            )}

            {gateOpen && (
              <ScreenShareGateDialog
                gate={screenShareGate}
                config={moderationConfig}
                onClose={() => setGateOpen(false)}
                onGateChange={(gate) => {
                  screenShareGateRef.current = gate;
                  setAccount((prev) => (prev ? { ...prev, screenShare: gate } : prev));
                }}
                onConfirm={() => {
                  setGateOpen(false);
                  void startOrStopScreenShare(true);
                }}
              />
            )}

            {reportTarget && (
              <ReportDialog
                roomId={roomId}
                target={reportTarget}
                onSubmit={(payload) => socket.emitModerationReport(payload)}
                onClose={() => setReportTarget(null)}
              />
            )}

            {notice && isOwner && (
              <div className="mx-4 mb-3">
                <Banner
                  variant="warning"
                  title={
                    notice.kind === 'report'
                      ? `Denúncia sobre ${notice.name}`
                      : `Alerta do assistente sobre ${notice.name}`
                  }
                  description={
                    notice.kind === 'frame'
                      ? 'A amostra da tela compartilhada foi sinalizada.'
                      : notice.kind === 'text'
                        ? 'Uma mensagem foi sinalizada.'
                        : 'Um participante fez uma denúncia.'
                  }
                  action={
                    <>
                      {webrtc.peers.get(notice.peerId)?.isScreenSharing && (
                        <Button variant="danger" size="sm" onClick={() => { stopPeerShare(notice.peerId); setNotice(null); }}>
                          Encerrar partilha dele
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => setNotice(null)} aria-label="Dispensar aviso">
                        Dispensar
                      </Button>
                    </>
                  }
                />
              </div>
            )}

            {confirmDelete && (
              <DeleteRoomDialog
                roomId={roomId}
                roomName={roomName}
                onCancel={() => setConfirmDelete(false)}
                onDeleteStart={() => {
                  deletingByMeRef.current = true;
                }}
                onDeleteError={() => {
                  deletingByMeRef.current = false;
                }}
                onDeleted={() => {
                  allowNavigation();
                  webrtc.cleanupMedia();
                  setFlash('Sala apagada', 'success');
                  window.location.href = '/';
                }}
              />
            )}
            {pendingDestination && (
              <LeaveRoomDialog
                onCancel={cancelNavigation}
                onLeave={() => handleLeave(pendingDestination)}
              />
            )}
          </div>
        </AppShell>
      </div>
      {!visible && joined && (
        <MiniCallBar
          roomId={roomId}
          roomName={roomName}
          connected={socket.connected}
          participants={webrtc.peers.size + 1}
          isMuted={webrtc.isMuted}
          isSpeaking={speaking.has(LOCAL_ID)}
          onToggleMute={() => {
            const result = webrtc.toggleMute();
            if (result === null) toast('Microfone indisponível.', 'error');
          }}
          onLeave={leaveFromMiniBar}
        />
      )}
    </>
  );
}
