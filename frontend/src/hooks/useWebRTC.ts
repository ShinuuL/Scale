'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import type { UseSocketReturn, PeerInfo } from './useSocket';

export interface PeerConnection {
  peerId: string;
  userId: string | null;
  name: string;
  connection: RTCPeerConnection;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  audioMuted: boolean;
  videoMuted: boolean;
  isScreenSharing: boolean;
}

export interface UseWebRTCHReturn {
  peers: Map<string, PeerConnection>;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  isMuted: boolean;
  isDeafened: boolean;
  isScreenSharing: boolean;
  audioMuted: boolean;
  /** Erro de mídia (ex.: 'insecure-context', 'getUserMedia-unavailable', 'NotAllowedError'). null = ok. */
  mediaError: string | null;
  /**
   * Alterna mute e retorna o NOVO estado (true = mudo) para feedback imediato
   * na UI sem ler estado stale; retorna `null` quando não há stream local
   * (contexto inseguro / permissão negada).
   */
  toggleMute: () => boolean | null;
  /**
   * Alterna deafen e retorna o NOVO estado (true = surdo); retorna `null`
   * quando não há peers para silenciar.
   */
  toggleDeafen: () => boolean | null;
  /**
   * Alterna screen share. Retorna `true` (compartilhando) / `false` (parou) ou
   * `null` quando bloqueado (contexto inseguro / getDisplayMedia indisponível).
   */
  toggleScreenShare: () => Promise<boolean | null>;
  initMedia: () => Promise<void>;
  cleanupMedia: () => void;
  /**
   * Inicia offers para peers que já estavam na sala (existingPeers do ack de
   * join-room). Mesh bidirecional: não depende só do room:peer-joined enviado
   * pelos antigos — se esse evento se perder, o novato ainda conecta.
   */
  connectToPeers: (peers: PeerInfo[]) => Promise<void>;
}

const DEFAULT_ICE_SERVERS: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const MAX_PEERS = 8;

// ─── ICE / connection recovery ────────────────────────────────
const ICE_RESTART_MAX_ATTEMPTS = 3;
const ICE_DISCONNECTED_WAIT_MS = 3000;
const ICE_RESTART_DEDUPE_MS = 3000;

interface IceRestartState {
  attempts: number;
  lastAttemptAt: number;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
}

async function fetchIceServers(): Promise<RTCConfiguration> {
  try {
    const url = typeof window !== 'undefined' ? '/api/turn/credentials' : `${process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:4000'}/api/turn/credentials`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return DEFAULT_ICE_SERVERS;
    const data = (await res.json()) as { iceServers?: RTCIceServer[] };
    if (data.iceServers && data.iceServers.length > 0) {
      return { iceServers: data.iceServers };
    }
    return DEFAULT_ICE_SERVERS;
  } catch {
    return DEFAULT_ICE_SERVERS;
  }
}

interface PeerMeta {
  peerId: string;
  userId: string | null;
  name: string;
}

export function useWebRTC(
  socketHook: UseSocketReturn,
  roomId: string,
  inviteToken?: string,
): UseWebRTCHReturn {
  const inviteTokenRef = useRef<string | undefined>(inviteToken);
  inviteTokenRef.current = inviteToken; // keep fresh without re-running effects

  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isDeafened, setIsDeafened] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const peersMetaRef = useRef<Map<string, PeerMeta>>(new Map());
  const iceConfigRef = useRef<RTCConfiguration>(DEFAULT_ICE_SERVERS);
  const iceRestartStateRef = useRef<Map<string, IceRestartState>>(new Map());

  // Fetch ICE servers on mount (TURN/STUN from backend)
  useEffect(() => {
    fetchIceServers().then((config) => {
      iceConfigRef.current = config;
    });
  }, []);

  // ─── Broadcast peer map updates ───────────────────────────────
  const broadcastPeersUpdate = useCallback(() => {
    const newMap = new Map<string, PeerConnection>();
    peersRef.current.forEach((pc, id) => {
      newMap.set(id, { ...pc });
    });
    setPeers(newMap);
  }, []);

  // ─── Peer cleanup (also clears ICE recovery state) ────────────
  const cleanupPeer = useCallback(
    (peerId: string, reason?: string) => {
      const existing = peersRef.current.get(peerId);
      if (existing) {
        existing.connection.close();
      }
      peersRef.current.delete(peerId);
      peersMetaRef.current.delete(peerId);
      const state = iceRestartStateRef.current.get(peerId);
      if (state?.disconnectTimer) {
        clearTimeout(state.disconnectTimer);
      }
      iceRestartStateRef.current.delete(peerId);
      broadcastPeersUpdate();
      if (reason) {
        console.debug(`[WebRTC] removed peer ${peerId}: ${reason}`);
      }
    },
    [broadcastPeersUpdate],
  );

  // ─── Reset ICE recovery state on healthy connection ─────────
  const resetIceRestartState = useCallback((peerId: string) => {
    const state = iceRestartStateRef.current.get(peerId);
    if (state?.disconnectTimer) {
      clearTimeout(state.disconnectTimer);
    }
    iceRestartStateRef.current.delete(peerId);
  }, []);

  // ─── ICE restart / renegotiation recovery ────────────────────
  // Called when a peer connection fails or stays disconnected. Tries
  // restartIce() + a fresh offer ({iceRestart:true}); after
  // ICE_RESTART_MAX_ATTEMPTS the peer is dropped.
  const attemptIceRestart = useCallback(
    async (peerId: string, reason: string): Promise<void> => {
      const entry = peersRef.current.get(peerId);
      if (!entry) return;
      const pc = entry.connection;
      if (pc.connectionState === 'closed') return;

      const now = Date.now();
      const prev = iceRestartStateRef.current.get(peerId);
      // Dedupe: connectionState and iceConnectionState may both report the
      // same failure burst; don't burn attempts on duplicates.
      if (prev && now - prev.lastAttemptAt < ICE_RESTART_DEDUPE_MS) return;

      const attempts = (prev?.attempts ?? 0) + 1;
      if (attempts > ICE_RESTART_MAX_ATTEMPTS) {
        cleanupPeer(
          peerId,
          `connection did not recover after ${ICE_RESTART_MAX_ATTEMPTS} ICE restart attempts (${reason})`,
        );
        return;
      }

      if (prev?.disconnectTimer) {
        clearTimeout(prev.disconnectTimer);
      }
      iceRestartStateRef.current.set(peerId, {
        attempts,
        lastAttemptAt: now,
        disconnectTimer: null,
      });

      console.debug(
        `[WebRTC] ICE restart ${attempts}/${ICE_RESTART_MAX_ATTEMPTS} for ${peerId} (${reason})`,
      );
      try {
        // restartIce() asks the ICE agent to restart on the next negotiation;
        // createOffer({iceRestart:true}) carries the new credentials to the
        // remote peer via signaling.
        if (typeof pc.restartIce === 'function') {
          pc.restartIce();
        }
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        await socketHook.emitOffer(roomId, peerId, offer);
      } catch (err) {
        console.error(`[WebRTC] ICE restart failed for ${peerId} (${reason}):`, err);
      }
    },
    [roomId, socketHook, cleanupPeer],
  );

  // ─── Create PeerConnection for a specific remote peer ────────
  const createPeerConnection = useCallback(
    (peerId: string, meta: PeerMeta): RTCPeerConnection => {
      const pc = new RTCPeerConnection(iceConfigRef.current);

      // Add local tracks
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => {
          pc.addTrack(track, localStreamRef.current!);
        });
      }

      // ICE candidates → signaling
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socketHook.emitIceCandidate(roomId, peerId, event.candidate);
        }
      };

      // Handle remote stream
      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        const existing = peersRef.current.get(peerId);
        if (existing && remoteStream) {
          existing.stream = remoteStream;
          broadcastPeersUpdate();
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === 'connected') {
          resetIceRestartState(peerId);
        } else if (state === 'failed') {
          // Connection failed: try to recover by restarting ICE (limited
          // attempts). Dropped only after exhausting the budget.
          void attemptIceRestart(peerId, 'connection-state');
        } else if (state === 'closed') {
          resetIceRestartState(peerId);
        }
        // 'disconnected' is handled below via oniceconnectionstatechange.
      };

      // ICE-level recovery: a temporary network blip usually shows up as
      // 'disconnected' first — give it a moment, then restart ICE.
      pc.oniceconnectionstatechange = () => {
        const iceState = pc.iceConnectionState;
        if (iceState === 'connected') {
          resetIceRestartState(peerId);
        } else if (iceState === 'disconnected') {
          const prev =
            iceRestartStateRef.current.get(peerId) ?? {
              attempts: 0,
              lastAttemptAt: 0,
              disconnectTimer: null,
            };
          if (prev.disconnectTimer) {
            clearTimeout(prev.disconnectTimer);
          }
          const timer = setTimeout(() => {
            const current = iceRestartStateRef.current.get(peerId);
            if (current) {
              current.disconnectTimer = null;
              iceRestartStateRef.current.set(peerId, current);
            }
            const entry = peersRef.current.get(peerId);
            if (
              entry &&
              pc.iceConnectionState === 'disconnected' &&
              pc.connectionState !== 'closed'
            ) {
              void attemptIceRestart(peerId, 'ice-disconnected');
            }
          }, ICE_DISCONNECTED_WAIT_MS);
          prev.disconnectTimer = timer;
          iceRestartStateRef.current.set(peerId, prev);
        } else if (iceState === 'failed') {
          void attemptIceRestart(peerId, 'ice-failed');
        }
      };

      peersRef.current.set(peerId, {
        peerId,
        userId: meta.userId,
        name: meta.name,
        connection: pc,
        stream: null,
        screenStream: null,
        audioMuted: false,
        videoMuted: false,
        isScreenSharing: false,
      });

      return pc;
    },
    [roomId, socketHook, broadcastPeersUpdate, attemptIceRestart, resetIceRestartState],
  );

  // ─── Regra determinística de quem inicia o offer ─────────────
  // O mesh agora é bidirecional (novato também oferece). Para cada par de
  // peers, exatamente UM lado deve criar a offer — senão ambos criam PCs com
  // ofertas pendentes e a negociação colide (glare). Regra: o socket id MENOR
  // inicia; ambos os lados calculam a mesma comparação (conhecem o próprio id
  // e o do outro via signaling).
  const shouldInitiate = useCallback(
    (remotePeerId: string): boolean => {
      const myId = socketHook.socket?.id;
      if (!myId) return false;
      return myId < remotePeerId;
    },
    [socketHook],
  );

  // ─── Conectar a peers já presentes (existingPeers) ───────────
  // O backend entrega a lista de peers no ack de `join-room`. O novato inicia
  // a negociação com eles também (mesh bidirecional), em vez de depender
  // apenas do `room:peer-joined` dos antigos. Dedupe via peersRef + regra
  // shouldInitiate evitam PC duplicado e glare.
  const connectToPeers = useCallback(
    async (peerInfos: PeerInfo[]): Promise<void> => {
      for (const peer of peerInfos) {
        if (peersRef.current.has(peer.peerId)) {
          console.debug('[WebRTC] connectToPeers: already connected to', peer.peerId);
          continue;
        }
        if (peersRef.current.size >= MAX_PEERS) {
          console.warn('[WebRTC] connectToPeers: max peers reached, ignoring', peer.peerId);
          break;
        }
        if (!shouldInitiate(peer.peerId)) {
          console.debug('[WebRTC] connectToPeers: waiting for offer from', peer.peerId);
          continue;
        }
        const meta: PeerMeta = {
          peerId: peer.peerId,
          userId: peer.userId,
          name: peer.name,
        };
        peersMetaRef.current.set(peer.peerId, meta);
        const pc = createPeerConnection(peer.peerId, meta);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await socketHook.emitOffer(roomId, peer.peerId, offer);
          console.debug('[WebRTC] sent offer to existing peer', peer.peerId);
        } catch (err) {
          console.error(`[WebRTC] failed to negotiate with existing peer ${peer.peerId}:`, err);
        }
      }
      broadcastPeersUpdate();
    },
    [roomId, socketHook, createPeerConnection, broadcastPeersUpdate, shouldInitiate],
  );

  // ─── Initialize media (audio only for MVP) ───────────────────
  const initMedia = useCallback(async (): Promise<void> => {
    // getUserMedia exige contexto seguro (https ou localhost). Em
    // http://100.x o objeto navigator.mediaDevices?getUserMedia EXISTE, mas a
    // chamada rejeita com NotAllowedError porque window.isSecureContext é
    // false — detectamos antes e avisamos em vez de falhar em silêncio.
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      console.warn(
        `[WebRTC] initMedia: contexto inseguro (http fora do localhost em ${window.location.host}) — getUserMedia bloqueado. ` +
          'Acesse via https:// ou ative chrome://flags/#unsafely-treat-insecure-origin-as-secure',
      );
      setMediaError('insecure-context');
      setIsMuted(true);
      setAudioMuted(true);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      console.warn(
        '[WebRTC] initMedia: getUserMedia indisponível — acesse via https ou localhost, ou ative ' +
          'chrome://flags/#unsafely-treat-insecure-origin-as-secure',
      );
      setMediaError('getUserMedia-unavailable');
      setIsMuted(true);
      setAudioMuted(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setIsMuted(false);
      setAudioMuted(false);
      setMediaError(null);

      // Add audio track to all existing peer connections (PCs may have been
      // created before media was available)
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        peersRef.current.forEach((pc) => {
          const audioSender = pc.connection.getSenders().find((s) => s.track?.kind === 'audio');
          if (audioSender) {
            audioSender.replaceTrack(audioTrack);
          } else {
            pc.connection.addTrack(audioTrack, stream);
          }
        });
      }
    } catch (err) {
      const e = err as { name?: string; message?: string };
      console.warn(
        `[WebRTC] initMedia falhou: name=${e.name ?? 'unknown'}, message=${e.message ?? String(err)}`,
      );
      console.error('Failed to get user media:', err);
      setMediaError(e.name ?? 'getUserMedia-error');
      // Continue without audio
      setIsMuted(true);
      setAudioMuted(true);
    }
  }, []);

  // ─── Cleanup ──────────────────────────────────────────────────
  const cleanupMedia = useCallback(() => {
    // Stop local stream tracks
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);

    // Stop screen share
    localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localScreenStreamRef.current = null;
    setLocalScreenStream(null);

    // Close all peer connections
    peersRef.current.forEach((pc) => {
      pc.connection.close();
    });
    peersRef.current.clear();
    peersMetaRef.current.clear();
    // Clear ICE recovery state + pending timers
    iceRestartStateRef.current.forEach((state) => {
      if (state.disconnectTimer) {
        clearTimeout(state.disconnectTimer);
      }
    });
    iceRestartStateRef.current.clear();
    broadcastPeersUpdate();
  }, [broadcastPeersUpdate]);

  // ─── Toggle mute ──────────────────────────────────────────────
  const toggleMute = useCallback((): boolean | null => {
    if (!localStreamRef.current) {
      console.warn('[WebRTC] toggleMute: no local stream (insecure context?)');
      return null;
    }
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (!audioTrack) {
      console.warn('[WebRTC] toggleMute: no audio track on local stream');
      return null;
    }
    audioTrack.enabled = !audioTrack.enabled;
    const nowMuted = !audioTrack.enabled;
    setIsMuted(nowMuted);
    setAudioMuted(nowMuted);

    // Update all peer connections
    peersRef.current.forEach((pc) => {
      const sender = pc.connection
        .getSenders()
        .find((s) => s.track?.kind === 'audio');
      if (sender && audioTrack) {
        sender.replaceTrack(audioTrack);
      }
    });

    // Retorna o NOVO estado para a UI dar feedback sem ler estado stale.
    return nowMuted;
  }, []);

  // ─── Toggle deafen (mute remote audio) ────────────────────────
  const toggleDeafen = useCallback((): boolean | null => {
    if (peersRef.current.size === 0) {
      console.warn('[WebRTC] toggleDeafen: no peers to deafen');
      return null;
    }
    const newDeafened = !isDeafened;
    setIsDeafened(newDeafened);
    peersRef.current.forEach((pc) => {
      if (pc.stream) {
        pc.stream.getAudioTracks().forEach((track) => {
          track.enabled = !newDeafened;
        });
      }
    });
    return newDeafened;
  }, [isDeafened]);

  // ─── Toggle screen share ──────────────────────────────────────
  const toggleScreenShare = useCallback(async (): Promise<boolean | null> => {
    if (isScreenSharing) {
      console.debug('[WebRTC] stopping screen share');
      // Stop sharing
      localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
      localScreenStreamRef.current = null;
      setLocalScreenStream(null);
      setIsScreenSharing(false);

      // Remove screen video track from all peer connections
      peersRef.current.forEach((pc) => {
        const videoSender = pc.connection.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          videoSender.replaceTrack(null);
        }
        pc.isScreenSharing = false;
      });

      broadcastPeersUpdate();

      // Renegotiate: create new offer for each peer so they drop the video transceiver
      for (const [peerId, peer] of peersRef.current) {
        try {
          const offer = await peer.connection.createOffer();
          await peer.connection.setLocalDescription(offer);
          socketHook.emitOffer(roomId, peerId, offer);
          socketHook.emitScreenShareState(roomId, peerId, false);
        } catch (err) {
          console.error(`[WebRTC] renegotiation (screen-off) failed for ${peerId}:`, err);
        }
      }
      return false;
    }

    if (typeof window !== 'undefined' && !window.isSecureContext) {
      console.warn(
        '[WebRTC] toggleScreenShare: contexto inseguro — getDisplayMedia bloqueado. ' +
          'Acesse via https:// ou ative chrome://flags/#unsafely-treat-insecure-origin-as-secure',
      );
      setIsScreenSharing(false);
      return null;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getDisplayMedia) {
      console.warn('[WebRTC] toggleScreenShare: getDisplayMedia indisponível — acesse via https ou localhost');
      setIsScreenSharing(false);
      return null;
    }
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      localScreenStreamRef.current = screenStream;
      setLocalScreenStream(screenStream);
      setIsScreenSharing(true);

      // Add screen track to all peer connections
      const videoTrack = screenStream.getVideoTracks()[0];
      if (videoTrack) {
        for (const [peerId, peer] of peersRef.current) {
          const sender = peer.connection.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) {
            await sender.replaceTrack(videoTrack);
          } else {
            peer.connection.addTrack(videoTrack, screenStream);
          }
          peer.isScreenSharing = true;

          // Renegotiate so receiver gets the new video track
          try {
            const offer = await peer.connection.createOffer();
            await peer.connection.setLocalDescription(offer);
            socketHook.emitOffer(roomId, peerId, offer);
            socketHook.emitScreenShareState(roomId, peerId, true);
          } catch (err) {
            console.error(`[WebRTC] renegotiation (screen-on) failed for ${peerId}:`, err);
          }
        }
      }

      // Handle user stopping screen share via browser UI
      videoTrack.onended = async () => {
        console.debug('[WebRTC] screen share ended by browser');
        localScreenStreamRef.current?.getTracks().forEach((t) => t.stop());
        localScreenStreamRef.current = null;
        setLocalScreenStream(null);
        setIsScreenSharing(false);

        peersRef.current.forEach((pc) => {
          const videoSender = pc.connection.getSenders().find((s) => s.track?.kind === 'video');
          if (videoSender) {
            videoSender.replaceTrack(null);
          }
          pc.isScreenSharing = false;
        });

        broadcastPeersUpdate();

        for (const [peerId, peer] of peersRef.current) {
          try {
            const offer = await peer.connection.createOffer();
            await peer.connection.setLocalDescription(offer);
            socketHook.emitOffer(roomId, peerId, offer);
            socketHook.emitScreenShareState(roomId, peerId, false);
          } catch (err) {
            console.error(`[WebRTC] renegotiation (screen-ended) failed for ${peerId}:`, err);
          }
        }
      };

      broadcastPeersUpdate();
      return true;
    } catch (err) {
      console.error('Screen share failed:', err);
      setIsScreenSharing(false);
      return false;
    }
  }, [isScreenSharing, broadcastPeersUpdate, roomId, socketHook]);

  // ─── Socket event handlers ────────────────────────────────────
  useEffect(() => {
    const handlePeerJoined = async (peer: { peerId: string; userId: string | null; name: string }) => {
      console.debug('[WebRTC] room:peer-joined', peer.peerId, peer.name);
      if (peersRef.current.has(peer.peerId)) {
        console.debug('[WebRTC] room:peer-joined: peer already known — skipping duplicate offer', peer.peerId);
        return;
      }
      if (peersRef.current.size >= MAX_PEERS) {
        console.warn('Max peers reached, ignoring new peer');
        return;
      }
      if (!shouldInitiate(peer.peerId)) {
        // Regra determinística: o socket id menor oferece. Se não somos nós,
        // o outro lado vai nos mandar a offer — não criar PC para não colidir.
        console.debug('[WebRTC] room:peer-joined: waiting for offer from', peer.peerId);
        return;
      }

      const meta: PeerMeta = {
        peerId: peer.peerId,
        userId: peer.userId,
        name: peer.name,
      };
      peersMetaRef.current.set(peer.peerId, meta);

      // We are the existing peer — create offer to the new peer
      const pc = createPeerConnection(peer.peerId, meta);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await socketHook.emitOffer(roomId, peer.peerId, offer);
        console.debug('[WebRTC] sent offer to', peer.peerId);
      } catch (err) {
        console.error(`[WebRTC] failed to offer to ${peer.peerId}:`, err);
      }
      broadcastPeersUpdate();
    };

    const handlePeerLeft = (data: { peerId: string }) => {
      console.debug('[WebRTC] room:peer-left', data.peerId);
      cleanupPeer(data.peerId, 'peer-left');
    };

    const handleSignalOffer = async (data: {
      fromPeerId: string;
      userId: string | null;
      name: string;
      offer: RTCSessionDescriptionInit;
    }) => {
      console.debug('[WebRTC] signal:offer from', data.fromPeerId, data.name);
      const meta: PeerMeta = {
        peerId: data.fromPeerId,
        userId: data.userId,
        name: data.name,
      };
      peersMetaRef.current.set(data.fromPeerId, meta);

      let existing = peersRef.current.get(data.fromPeerId);
      const isNew = !existing;

      // True quando o branch de glare (perfect negotiation, lado polite) já
      // aplicou a offer remota — evita aplicar 2x no fluxo comum abaixo.
      let remoteOfferApplied = false;

      if (isNew) {
        existing = {
          peerId: data.fromPeerId,
          userId: data.userId,
          name: data.name,
          connection: createPeerConnection(data.fromPeerId, meta),
          stream: null,
          screenStream: null,
          audioMuted: false,
          videoMuted: false,
          isScreenSharing: false,
        };
      } else if (existing && existing.connection.signalingState !== 'stable') {
        // Glare / colisão de offers: já há negociação pendente com este peer
        // (nossa offer de screen-share ou ICE restart aguardando answer, por
        // exemplo). Descartar a offer remota cegamente quebraria renegociação
        // legítima — aplicamos o "perfect negotiation": o lado POLITE (socket
        // id menor, shouldInitiate === true) abandona a própria offer e aceita
        // a remota; o lado IMPOLITE mantém a própria offer e ignora a
        // colidente. A atribuição é consistente entre os dois lados porque
        // ambos conhecem os dois socket ids.
        if (existing.connection.signalingState === 'closed') {
          return;
        }
        const glarePc = existing.connection;
        if (shouldInitiate(data.fromPeerId)) {
          // Polite: aceitar a offer remota. Browsers modernos fazem rollback
          // implícito da nossa offer ao chamar setRemoteDescription(offer); se
          // o browser for antigo e lançar InvalidStateError, fazemos rollback
          // explícito e tentamos de novo.
          console.debug(
            '[WebRTC] signal:offer: glare (polite) — rolling back our offer to accept from',
            data.fromPeerId,
            glarePc.signalingState,
          );
          try {
            await glarePc.setRemoteDescription(new RTCSessionDescription(data.offer));
          } catch (err) {
            const glareErr = err as { name?: string };
            if (glareErr?.name !== 'InvalidStateError') {
              throw err;
            }
            await glarePc.setRemoteDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
            await glarePc.setRemoteDescription(new RTCSessionDescription(data.offer));
          }
          remoteOfferApplied = true;
        } else {
          // Impolite: manter nossa offer — a offer recebida é colidente/anômala.
          console.debug(
            '[WebRTC] signal:offer: glare (impolite) — keeping our offer with',
            data.fromPeerId,
            glarePc.signalingState,
          );
          return;
        }
      }

      const pc = existing!.connection;
      if (!remoteOfferApplied) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketHook.emitAnswer(roomId, data.fromPeerId, answer);
      console.debug('[WebRTC] sent answer to', data.fromPeerId);
      if (isNew) {
        broadcastPeersUpdate();
      }
    };

    const handleSignalAnswer = async (data: {
      fromPeerId: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      console.debug('[WebRTC] signal:answer from', data.fromPeerId);
      const existing = peersRef.current.get(data.fromPeerId);
      if (existing) {
        await existing.connection.setRemoteDescription(
          new RTCSessionDescription(data.answer),
        );
      }
    };

    const handleSignalIceCandidate = async (data: {
      fromPeerId: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const existing = peersRef.current.get(data.fromPeerId);
      if (existing) {
        try {
          await existing.connection.addIceCandidate(
            new RTCIceCandidate(data.candidate),
          );
        } catch (err) {
          console.warn('Failed to add ICE candidate:', err);
        }
      }
    };

    const unsubPeerJoined = socketHook.onPeerJoined(handlePeerJoined);
    const unsubPeerLeft = socketHook.onPeerLeft(handlePeerLeft);
    const unsubOffer = socketHook.onSignalOffer(handleSignalOffer);
    const unsubAnswer = socketHook.onSignalAnswer(handleSignalAnswer);
    const unsubIce = socketHook.onSignalIceCandidate(handleSignalIceCandidate);

    const handleScreenShareState = (data: {
      fromPeerId: string;
      isScreenSharing: boolean;
    }) => {
      console.debug('[WebRTC] screen-share-state from', data.fromPeerId, data.isScreenSharing);
      const existing = peersRef.current.get(data.fromPeerId);
      if (existing) {
        existing.isScreenSharing = data.isScreenSharing;
        broadcastPeersUpdate();
      }
    };

    const unsubScreenShare = socketHook.onScreenShareState(handleScreenShareState);

    return () => {
      unsubPeerJoined();
      unsubPeerLeft();
      unsubOffer();
      unsubAnswer();
      unsubIce();
      unsubScreenShare();
    };
  }, [roomId, socketHook, createPeerConnection, cleanupPeer, broadcastPeersUpdate, shouldInitiate]);

  // ─── Socket reconnection: re-join room so signaling keeps working ──
  // When the socket.io connection drops (e.g. backend restart / network blip)
  // the backend removes us from the room on disconnect. Re-emit join-room
  // with the same roomId + token so other peers can re-establish their
  // WebRTC connections (they get room:peer-joined again).
  useEffect(() => {
    const rejoinRoom = async () => {
      console.debug('[WebRTC] socket reconnected — re-joining room', roomId);
      try {
        await socketHook.joinRoom(roomId, socketHook.guestName, inviteTokenRef.current);
      } catch (err) {
        console.error('[WebRTC] re-join after socket reconnect failed:', err);
      }
    };
    const unsubReconnect = socketHook.onReconnect(rejoinRoom);
    return unsubReconnect;
  }, [roomId, socketHook]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupMedia();
    };
  }, [cleanupMedia]);

  // Retorno memoizado: identidade estável enquanto peers/streams/estados não
  // mudam. Consumidores (page.tsx) podem depender dele sem loops de render.
  return useMemo<UseWebRTCHReturn>(
    () => ({
      peers,
      localStream,
      localScreenStream,
      isMuted,
      isDeafened,
      isScreenSharing,
      audioMuted,
      mediaError,
      toggleMute,
      toggleDeafen,
      toggleScreenShare,
      initMedia,
      cleanupMedia,
      connectToPeers,
    }),
    [
      peers,
      localStream,
      localScreenStream,
      isMuted,
      isDeafened,
      isScreenSharing,
      audioMuted,
      mediaError,
      toggleMute,
      toggleDeafen,
      toggleScreenShare,
      initMedia,
      cleanupMedia,
      connectToPeers,
    ],
  );
}
