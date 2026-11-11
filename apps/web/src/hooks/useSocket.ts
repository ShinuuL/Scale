'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ChatMessage } from '@/hooks/useChat';
import {
  moderationActionSchema,
  moderationNoticeSchema,
  moderationReportSchema,
  moderationStopShareSchema,
  moderationWarningSchema,
  roomDeletedEventSchema,
  screenShareGateSchema,
} from '@scale/shared';
import type {
  JoinRoomPayload,
  ModerationActionPayload,
  ModerationNoticePayload,
  ModerationReportPayload,
  ModerationWarningPayload,
  ScreenShareGate,
  PeerAudioStateEvent,
  PeerInfo,
  PeerLeftEvent,
  RoomDeletedEvent,
  ScreenShareStateEvent,
} from '@scale/shared';

/**
 * URL do signaling. Producao (frontend estatico servido pelo Caddy): SEMPRE o
 * mesmo origin — o Caddy encaminha `/socket.io/*` ao backend, tanto em
 * http://localhost:<PROXY_PORT> quanto pelo tunel HTTPS.
 *
 * Dev (`next dev`): o Next nao faz upgrade de WebSocket nos rewrites, entao o
 * next.config.js define `NEXT_PUBLIC_DEV_WS_URL` (backend no host) SO na fase
 * de desenvolvimento. No build exportado ela e vazia.
 */
export function getWsUrl(): string {
  const devUrl = process.env.NEXT_PUBLIC_DEV_WS_URL;
  if (devUrl) return devUrl;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

// Shape do wire definido uma vez para web e server.
export type { PeerInfo } from '@scale/shared';

/** Motivo do servidor para recusar `isScreenSharing: true` (gate de partilha). */
export type ScreenShareDeniedReason = 'guest' | 'age' | 'consent';

/**
 * Ack de `signal:screen-share-state` com `code: 'SCREEN_SHARE_NOT_ALLOWED'`:
 * o servidor nao liberou a partilha (convidado, idade ou consentimento). O
 * useWebRTC para a captura ao receber este erro.
 */
export class ScreenShareNotAllowedError extends Error {
  readonly code = 'SCREEN_SHARE_NOT_ALLOWED' as const;
  constructor(
    message: string,
    readonly reason: ScreenShareDeniedReason,
  ) {
    super(message);
    this.name = 'ScreenShareNotAllowedError';
  }
}

export interface JoinRoomResult {
  success: boolean;
  peers: PeerInfo[];
  history: ChatMessage[];
}

export interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
  /**
   * Estado vivo da conexão, lido direto do socket (não do estado do React).
   * Use dentro de callbacks que rodam fora do ciclo de render — ex.: o re-join
   * disparado no instante da reconexão, quando `connected` ainda não re-renderizou.
   */
  isConnected: () => boolean;
  joinRoom: (
    roomId: string,
    guestName?: string,
    inviteToken?: string,
    password?: string,
    muted?: boolean,
  ) => Promise<JoinRoomResult>;
  leaveRoom: (roomId: string) => Promise<void>;
  emitOffer: (roomId: string, targetPeerId: string, offer: RTCSessionDescriptionInit) => Promise<void>;
  emitAnswer: (roomId: string, targetPeerId: string, answer: RTCSessionDescriptionInit) => Promise<void>;
  emitIceCandidate: (roomId: string, targetPeerId: string, candidate: RTCIceCandidate) => Promise<void>;
  onPeerJoined: (cb: (peer: PeerInfo) => void) => () => void;
  onPeerLeft: (cb: (data: PeerLeftEvent) => void) => () => void;
  onSignalOffer: (cb: (data: { fromPeerId: string; isRegistered: boolean; name: string; offer: RTCSessionDescriptionInit }) => void) => () => void;
  onSignalAnswer: (cb: (data: { fromPeerId: string; isRegistered: boolean; name: string; answer: RTCSessionDescriptionInit }) => void) => () => void;
  onSignalIceCandidate: (cb: (data: { fromPeerId: string; isRegistered: boolean; candidate: RTCIceCandidateInit }) => void) => () => void;
  emitScreenShareState: (roomId: string, targetPeerId: string, isScreenSharing: boolean) => Promise<void>;
  onScreenShareState: (cb: (data: ScreenShareStateEvent) => void) => () => void;
  /** Avisa a sala que o proprio microfone ligou/desligou (sem esperar resposta). */
  emitAudioState: (roomId: string, muted: boolean) => void;
  onPeerAudioState: (cb: (data: PeerAudioStateEvent) => void) => () => void;
  onReconnect: (cb: () => void) => () => void;
  /** A sala foi apagada (dono ou admin): o servidor ja tirou este socket dela. */
  onRoomDeleted: (cb: (data: RoomDeletedEvent) => void) => () => void;
  // ─── Moderacao ────────────────────────────────────────────────
  /** Acao do servidor sobre ESTE socket (ex.: parar a partilha de tela). */
  onModerationAction: (cb: (data: ModerationActionPayload) => void) => () => void;
  /** Aviso so para o autor (texto ou tela com severidade media). */
  onModerationWarning: (cb: (data: ModerationWarningPayload) => void) => () => void;
  /** Dono da sala: denuncia ou alerta sobre um peer. */
  onModerationNotice: (cb: (data: ModerationNoticePayload) => void) => () => void;
  /** Gate de partilha de tela mudou (idade/consentimento salvos pelo REST). */
  onMeScreenShare: (cb: (gate: ScreenShareGate) => void) => () => void;
  /** Denuncia um participante (balde no servidor: 10 / 10 min). */
  emitModerationReport: (payload: ModerationReportPayload) => Promise<void>;
  /** Dono da sala: encerra a partilha de tela de um peer. */
  emitModerationStopShare: (roomId: string, targetPeerId: string) => Promise<void>;
  guestName: string;
  setGuestName: (name: string) => void;
}

export function useSocket(guestNameOverride?: string): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  // Marca se ESTE socket já conectou alguma vez — o primeiro connect não é
  // reconexão (não deve disparar os callbacks de `onReconnect`).
  const hadConnectedRef = useRef(false);
  // Socket em estado (não só ref): consumidores re-renderizam quando ele muda e
  // o objeto retornado pelo hook tem identidade estável (via useMemo abaixo).
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [guestName, setGuestName] = useState(guestNameOverride ?? `Guest-${Math.random().toString(36).slice(2, 6)}`);
  const callbacksRef = useRef({
    peerJoined: [] as Array<(peer: PeerInfo) => void>,
    peerLeft: [] as Array<(data: PeerLeftEvent) => void>,
    signalOffer: [] as Array<(data: { fromPeerId: string; isRegistered: boolean; name: string; offer: RTCSessionDescriptionInit }) => void>,
    signalAnswer: [] as Array<(data: { fromPeerId: string; isRegistered: boolean; name: string; answer: RTCSessionDescriptionInit }) => void>,
    signalIceCandidate: [] as Array<(data: { fromPeerId: string; isRegistered: boolean; candidate: RTCIceCandidateInit }) => void>,
    screenShareState: [] as Array<(data: ScreenShareStateEvent) => void>,
    peerAudioState: [] as Array<(data: PeerAudioStateEvent) => void>,
    reconnect: [] as Array<() => void>,
    roomDeleted: [] as Array<(data: RoomDeletedEvent) => void>,
    moderationAction: [] as Array<(data: ModerationActionPayload) => void>,
    moderationWarning: [] as Array<(data: ModerationWarningPayload) => void>,
    moderationNotice: [] as Array<(data: ModerationNoticePayload) => void>,
    meScreenShare: [] as Array<(gate: ScreenShareGate) => void>,
  });

  useEffect(() => {
    // getWsUrl() é avaliado AQUI dentro do effect (e não no escopo do módulo):
    // `window.location` só tem o valor certo no cliente, e um import do módulo é
    // avaliado uma única vez. Assim o signaling acompanha o host de acesso
    // (localhost, IP da LAN ou domínio HTTPS) em cada conexão.
    const wsUrl = getWsUrl();
    hadConnectedRef.current = false;
    const sock = io(wsUrl, {
      auth: { guestName },
      // Envia o cookie HttpOnly do login no handshake também quando o socket
      // vai direto à porta do backend (http na LAN) — é por ele que o servidor
      // sabe o nome do usuário logado.
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    // O namespace 'connect' dispara no primeiro connect E em toda reconexão — e
    // só nele `sock.connected` é true. NÃO use o evento 'reconnect' do Manager
    // (sock.io.on): ele dispara antes do ack do CONNECT, quando emits ainda
    // falham com "Socket not connected" (o namespace não está conectado) — era
    // por isso que o re-join após queda nunca acontecia.
    sock.on('connect', () => {
      setConnected(true);
      console.debug('[Socket] connected', sock.id, wsUrl);
      if (hadConnectedRef.current) {
        callbacksRef.current.reconnect.forEach((cb) => cb());
      }
      hadConnectedRef.current = true;
    });

    sock.on('disconnect', (reason: string) => {
      setConnected(false);
      console.debug('[Socket] disconnected', reason);
    });

    // CORS / backend fora do ar: sem este handler o badge fica
    // "Desconectado" sem nenhum motivo visível no console.
    sock.on('connect_error', (err: Error) => {
      console.error('[Socket] connect_error', err.message, err);
      setConnected(false);
    });

    sock.on('room:peer-joined', (data: PeerInfo) => {
      callbacksRef.current.peerJoined.forEach((cb) => cb(data));
    });

    sock.on('room:peer-left', (data: PeerLeftEvent) => {
      callbacksRef.current.peerLeft.forEach((cb) => cb(data));
    });

    sock.on('signal:offer', (data: { fromPeerId: string; isRegistered: boolean; name: string; offer: RTCSessionDescriptionInit }) => {
      callbacksRef.current.signalOffer.forEach((cb) => cb(data));
    });

    sock.on('signal:answer', (data: { fromPeerId: string; isRegistered: boolean; name: string; answer: RTCSessionDescriptionInit }) => {
      callbacksRef.current.signalAnswer.forEach((cb) => cb(data));
    });

    sock.on('signal:ice-candidate', (data: { fromPeerId: string; isRegistered: boolean; candidate: RTCIceCandidateInit }) => {
      callbacksRef.current.signalIceCandidate.forEach((cb) => cb(data));
    });

    sock.on('signal:screen-share-state', (data: ScreenShareStateEvent) => {
      callbacksRef.current.screenShareState.forEach((cb) => cb(data));
    });

    sock.on('room:peer-audio-state', (data: PeerAudioStateEvent) => {
      if (typeof data?.peerId !== 'string' || typeof data.muted !== 'boolean') return;
      callbacksRef.current.peerAudioState.forEach((cb) => cb(data));
    });

    sock.on('room:deleted', (data: unknown) => {
      const parsed = roomDeletedEventSchema.safeParse(data);
      if (!parsed.success) return;
      callbacksRef.current.roomDeleted.forEach((cb) => cb(parsed.data));
    });

    // Moderacao: payloads validados com os schemas do @scale/shared; o que nao
    // bate e ignorado (nunca derruba a chamada).
    sock.on('moderation:action', (data: unknown) => {
      const parsed = moderationActionSchema.safeParse(data);
      if (!parsed.success) return;
      callbacksRef.current.moderationAction.forEach((cb) => cb(parsed.data));
    });
    sock.on('moderation:warning', (data: unknown) => {
      const parsed = moderationWarningSchema.safeParse(data);
      if (!parsed.success) return;
      callbacksRef.current.moderationWarning.forEach((cb) => cb(parsed.data));
    });
    sock.on('moderation:notice', (data: unknown) => {
      const parsed = moderationNoticeSchema.safeParse(data);
      if (!parsed.success) return;
      callbacksRef.current.moderationNotice.forEach((cb) => cb(parsed.data));
    });
    sock.on('me:screen-share', (data: unknown) => {
      const parsed = screenShareGateSchema.safeParse(data);
      if (!parsed.success) return;
      callbacksRef.current.meScreenShare.forEach((cb) => cb(parsed.data));
    });

    // Reconexão: ver o handler de 'connect' acima. Os consumidores recebem o
    // aviso por `onReconnect` já com o socket conectado (podem emitir na hora).

    socketRef.current = sock;
    setSocket(sock);

    return () => {
      sock.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [guestName]);

  // Lê o socket atual direto do ref (sempre atualizado) em vez do estado
  // `connected`, que pode estar um render atrás em callbacks de socket.
  const isConnected = useCallback((): boolean => socketRef.current?.connected === true, []);

  const joinRoom = useCallback(
    (
      roomId: string,
      guestNameArg?: string,
      inviteToken?: string,
      password?: string,
      muted?: boolean,
    ): Promise<JoinRoomResult> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          reject(new Error('Socket not connected'));
          return;
        }

        const payload: JoinRoomPayload = {
          roomId,
        };
        if (inviteToken) payload.inviteToken = inviteToken;
        if (password) payload.password = password;
        if (muted !== undefined) payload.muted = muted;
        if (guestNameArg) payload.guestName = guestNameArg;
        else payload.guestName = guestName;

        socket.emit(
          'join-room',
          payload,
          (response: { success?: boolean; peers?: PeerInfo[]; history?: ChatMessage[]; error?: string }) => {
            if (response.error) {
              reject(new Error(response.error));
              return;
            }
            resolve({
              success: response.success ?? true,
              peers: response.peers ?? [],
              history: response.history ?? [],
            });
          },
        );
      });
    },
    [guestName],
  );

  const leaveRoom = useCallback((roomId: string): Promise<void> => {
    return new Promise((resolve) => {
      const socket = socketRef.current;
      if (!socket) {
        resolve();
        return;
      }
      // Fallback por timeout: se o socket existir mas estiver desconectado (ou
      // o servidor não responder), o callback do emit nunca dispara e a Promise
      // ficaria pendente para sempre — travando o `await leaveRoom` na UI.
      // 1500ms é mais que suficiente para o ack normal em rede local.
      const done = (): void => resolve();
      const timer = setTimeout(done, 1500);
      socket.emit('leave-room', { roomId }, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }, []);

  const emitOffer = useCallback(
    (roomId: string, targetPeerId: string, offer: RTCSessionDescriptionInit): Promise<void> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          return reject(new Error('Socket not connected'));
        }
        socket.emit(
          'signal:offer',
          { roomId, targetPeerId, offer },
          (response: { success?: boolean; error?: string }) => {
            if (response.error) reject(new Error(response.error));
            else resolve();
          },
        );
      });
    },
    [],
  );

  const emitAnswer = useCallback(
    (roomId: string, targetPeerId: string, answer: RTCSessionDescriptionInit): Promise<void> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          return reject(new Error('Socket not connected'));
        }
        socket.emit(
          'signal:answer',
          { roomId, targetPeerId, answer },
          (response: { success?: boolean; error?: string }) => {
            if (response.error) reject(new Error(response.error));
            else resolve();
          },
        );
      });
    },
    [],
  );

  const emitIceCandidate = useCallback(
    (roomId: string, targetPeerId: string, candidate: RTCIceCandidate): Promise<void> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          return reject(new Error('Socket not connected'));
        }
        socket.emit(
          'signal:ice-candidate',
          {
            roomId,
            targetPeerId,
            candidate: {
              candidate: candidate.candidate,
              sdpMid: candidate.sdpMid,
              sdpMLineIndex: candidate.sdpMLineIndex,
              usernameFragment: candidate.usernameFragment,
            },
          },
          (response: { success?: boolean; error?: string }) => {
            if (response.error) reject(new Error(response.error));
            else resolve();
          },
        );
      });
    },
    [],
  );

  const emitScreenShareState = useCallback(
    (roomId: string, targetPeerId: string, isScreenSharing: boolean): Promise<void> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          return reject(new Error('Socket not connected'));
        }
        socket.emit(
          'signal:screen-share-state',
          { roomId, targetPeerId, isScreenSharing },
          (response: { success?: boolean; error?: string; code?: string; reason?: string }) => {
            if (response.error) {
              // Gate de partilha: erro tipado para o useWebRTC parar a captura.
              if (response.code === 'SCREEN_SHARE_NOT_ALLOWED') {
                const reason: ScreenShareDeniedReason =
                  response.reason === 'guest' || response.reason === 'age' ? response.reason : 'consent';
                reject(new ScreenShareNotAllowedError(response.error, reason));
                return;
              }
              reject(new Error(response.error));
            } else resolve();
          },
        );
      });
    },
    [],
  );

  const onPeerJoined = useCallback((cb: (peer: PeerInfo) => void): (() => void) => {
    callbacksRef.current.peerJoined.push(cb);
    return () => {
      const idx = callbacksRef.current.peerJoined.indexOf(cb);
      if (idx >= 0) callbacksRef.current.peerJoined.splice(idx, 1);
    };
  }, []);

  const onPeerLeft = useCallback((cb: (data: PeerLeftEvent) => void): (() => void) => {
    callbacksRef.current.peerLeft.push(cb);
    return () => {
      const idx = callbacksRef.current.peerLeft.indexOf(cb);
      if (idx >= 0) callbacksRef.current.peerLeft.splice(idx, 1);
    };
  }, []);

  const onSignalOffer = useCallback((cb: (data: { fromPeerId: string; isRegistered: boolean; name: string; offer: RTCSessionDescriptionInit }) => void): (() => void) => {
    callbacksRef.current.signalOffer.push(cb);
    return () => {
      const idx = callbacksRef.current.signalOffer.indexOf(cb);
      if (idx >= 0) callbacksRef.current.signalOffer.splice(idx, 1);
    };
  }, []);

  const onSignalAnswer = useCallback((cb: (data: { fromPeerId: string; isRegistered: boolean; name: string; answer: RTCSessionDescriptionInit }) => void): (() => void) => {
    callbacksRef.current.signalAnswer.push(cb);
    return () => {
      const idx = callbacksRef.current.signalAnswer.indexOf(cb);
      if (idx >= 0) callbacksRef.current.signalAnswer.splice(idx, 1);
    };
  }, []);

  const onSignalIceCandidate = useCallback((cb: (data: { fromPeerId: string; isRegistered: boolean; candidate: RTCIceCandidateInit }) => void): (() => void) => {
    callbacksRef.current.signalIceCandidate.push(cb);
    return () => {
      const idx = callbacksRef.current.signalIceCandidate.indexOf(cb);
      if (idx >= 0) callbacksRef.current.signalIceCandidate.splice(idx, 1);
    };
  }, []);

  const emitAudioState = useCallback((roomId: string, muted: boolean): void => {
    const socket = socketRef.current;
    if (!socket || !socket.connected) return;
    socket.emit('peer:audio-state', { roomId, muted }, () => undefined);
  }, []);

  const onPeerAudioState = useCallback((cb: (data: PeerAudioStateEvent) => void): (() => void) => {
    callbacksRef.current.peerAudioState.push(cb);
    return () => {
      const idx = callbacksRef.current.peerAudioState.indexOf(cb);
      if (idx >= 0) callbacksRef.current.peerAudioState.splice(idx, 1);
    };
  }, []);

  const onScreenShareState = useCallback((cb: (data: ScreenShareStateEvent) => void): (() => void) => {
    callbacksRef.current.screenShareState.push(cb);
    return () => {
      const idx = callbacksRef.current.screenShareState.indexOf(cb);
      if (idx >= 0) callbacksRef.current.screenShareState.splice(idx, 1);
    };
  }, []);

  const onReconnect = useCallback((cb: () => void): (() => void) => {
    callbacksRef.current.reconnect.push(cb);
    return () => {
      const idx = callbacksRef.current.reconnect.indexOf(cb);
      if (idx >= 0) callbacksRef.current.reconnect.splice(idx, 1);
    };
  }, []);

  const onRoomDeleted = useCallback((cb: (data: RoomDeletedEvent) => void): (() => void) => {
    callbacksRef.current.roomDeleted.push(cb);
    return () => {
      const idx = callbacksRef.current.roomDeleted.indexOf(cb);
      if (idx >= 0) callbacksRef.current.roomDeleted.splice(idx, 1);
    };
  }, []);

  // ─── Moderacao ────────────────────────────────────────────────
  const onModerationAction = useCallback((cb: (data: ModerationActionPayload) => void): (() => void) => {
    callbacksRef.current.moderationAction.push(cb);
    return () => {
      const idx = callbacksRef.current.moderationAction.indexOf(cb);
      if (idx >= 0) callbacksRef.current.moderationAction.splice(idx, 1);
    };
  }, []);

  const onModerationWarning = useCallback((cb: (data: ModerationWarningPayload) => void): (() => void) => {
    callbacksRef.current.moderationWarning.push(cb);
    return () => {
      const idx = callbacksRef.current.moderationWarning.indexOf(cb);
      if (idx >= 0) callbacksRef.current.moderationWarning.splice(idx, 1);
    };
  }, []);

  const onModerationNotice = useCallback((cb: (data: ModerationNoticePayload) => void): (() => void) => {
    callbacksRef.current.moderationNotice.push(cb);
    return () => {
      const idx = callbacksRef.current.moderationNotice.indexOf(cb);
      if (idx >= 0) callbacksRef.current.moderationNotice.splice(idx, 1);
    };
  }, []);

  const onMeScreenShare = useCallback((cb: (gate: ScreenShareGate) => void): (() => void) => {
    callbacksRef.current.meScreenShare.push(cb);
    return () => {
      const idx = callbacksRef.current.meScreenShare.indexOf(cb);
      if (idx >= 0) callbacksRef.current.meScreenShare.splice(idx, 1);
    };
  }, []);

  const emitModerationReport = useCallback((payload: ModerationReportPayload): Promise<void> => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return reject(new Error('Socket not connected'));
      const parsed = moderationReportSchema.safeParse(payload);
      if (!parsed.success) return reject(new Error('Denúncia inválida'));
      socket.emit('moderation:report', parsed.data, (response: { success?: boolean; error?: string }) => {
        if (response?.error) reject(new Error(response.error));
        else resolve();
      });
    });
  }, []);

  const emitModerationStopShare = useCallback((roomId: string, targetPeerId: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      const socket = socketRef.current;
      if (!socket || !socket.connected) return reject(new Error('Socket not connected'));
      const parsed = moderationStopShareSchema.safeParse({ roomId, targetPeerId });
      if (!parsed.success) return reject(new Error('Pedido inválido'));
      socket.emit('moderation:stop-share', parsed.data, (response: { success?: boolean; error?: string }) => {
        if (response?.error) reject(new Error(response.error));
        else resolve();
      });
    });
  }, []);

  // Retorno memoizado: a identidade do objeto `socketHook` só muda quando um
  // dep realmente muda (socket novo, connected flip, guestName). Consumidores
  // (useWebRTC, page.tsx, useChat) dependem dele sem recriar listeners a cada
  // render.
  return useMemo<UseSocketReturn>(
    () => ({
      socket,
      connected,
      isConnected,
      joinRoom,
      leaveRoom,
      emitOffer,
      emitAnswer,
      emitIceCandidate,
      onPeerJoined,
      onPeerLeft,
      onSignalOffer,
      onSignalAnswer,
      onSignalIceCandidate,
      emitScreenShareState,
      onScreenShareState,
      emitAudioState,
      onPeerAudioState,
      onReconnect,
      onRoomDeleted,
      onModerationAction,
      onModerationWarning,
      onModerationNotice,
      onMeScreenShare,
      emitModerationReport,
      emitModerationStopShare,
      guestName,
      setGuestName,
    }),
    [
      socket,
      connected,
      isConnected,
      guestName,
      joinRoom,
      leaveRoom,
      emitOffer,
      emitAnswer,
      emitIceCandidate,
      onPeerJoined,
      onPeerLeft,
      onSignalOffer,
      onSignalAnswer,
      onSignalIceCandidate,
      emitScreenShareState,
      onScreenShareState,
      emitAudioState,
      onPeerAudioState,
      onReconnect,
      onRoomDeleted,
      onModerationAction,
      onModerationWarning,
      onModerationNotice,
      onMeScreenShare,
      emitModerationReport,
      emitModerationStopShare,
      setGuestName,
    ],
  );
}