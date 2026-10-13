'use client';

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ChatMessage } from '@/hooks/useChat';

function getWsUrl(): string {
  // Porta do backend para HTTP simples. Exposta como variável (default 4000)
  // porque o backend pode rodar em outra porta — ver .env (PORT).
  // Deliberadamente NAO usamos uma URL fixa aqui: o hostname vem de
  // window.location para que acesso remoto (Tailscale/IP) continue valendo.
  const port = process.env.NEXT_PUBLIC_BACKEND_PORT || '4000';

  if (typeof window !== 'undefined') {
    // On HTTPS pages (Tailscale cert via Caddy), signaling must stay on the same
    // origin: Caddy proxies /socket.io to the backend. Mixed http(s)://host:port
    // would be blocked by the browser.
    if (window.location.protocol === 'https:') {
      return window.location.origin;
    }
    // Plain HTTP (default): connect straight to the backend port.
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  return process.env.NEXT_PUBLIC_WS_URL || `http://localhost:${port}`;
}

export interface PeerInfo {
  peerId: string;
  userId: string | null;
  name: string;
  guestName?: string;
}

export interface JoinRoomResult {
  success: boolean;
  peers: PeerInfo[];
  history: ChatMessage[];
}

export interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
  joinRoom: (
    roomId: string,
    guestName?: string,
    inviteToken?: string,
    password?: string,
  ) => Promise<JoinRoomResult>;
  leaveRoom: (roomId: string) => Promise<void>;
  emitOffer: (roomId: string, targetPeerId: string, offer: RTCSessionDescriptionInit) => Promise<void>;
  emitAnswer: (roomId: string, targetPeerId: string, answer: RTCSessionDescriptionInit) => Promise<void>;
  emitIceCandidate: (roomId: string, targetPeerId: string, candidate: RTCIceCandidate) => Promise<void>;
  onPeerJoined: (cb: (peer: PeerInfo) => void) => () => void;
  onPeerLeft: (cb: (data: { peerId: string }) => void) => () => void;
  onSignalOffer: (cb: (data: { fromPeerId: string; userId: string | null; name: string; offer: RTCSessionDescriptionInit }) => void) => () => void;
  onSignalAnswer: (cb: (data: { fromPeerId: string; userId: string | null; name: string; answer: RTCSessionDescriptionInit }) => void) => () => void;
  onSignalIceCandidate: (cb: (data: { fromPeerId: string; userId: string | null; candidate: RTCIceCandidateInit }) => void) => () => void;
  emitScreenShareState: (roomId: string, targetPeerId: string, isScreenSharing: boolean) => Promise<void>;
  onScreenShareState: (cb: (data: { fromPeerId: string; isScreenSharing: boolean }) => void) => () => void;
  onReconnect: (cb: () => void) => () => void;
  guestName: string;
  setGuestName: (name: string) => void;
}

export function useSocket(guestNameOverride?: string): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  // Socket em estado (não só ref): consumidores re-renderizam quando ele muda e
  // o objeto retornado pelo hook tem identidade estável (via useMemo abaixo).
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [guestName, setGuestName] = useState(guestNameOverride ?? `Guest-${Math.random().toString(36).slice(2, 6)}`);
  const callbacksRef = useRef({
    peerJoined: [] as Array<(peer: PeerInfo) => void>,
    peerLeft: [] as Array<(data: { peerId: string }) => void>,
    signalOffer: [] as Array<(data: { fromPeerId: string; userId: string | null; name: string; offer: RTCSessionDescriptionInit }) => void>,
    signalAnswer: [] as Array<(data: { fromPeerId: string; userId: string | null; name: string; answer: RTCSessionDescriptionInit }) => void>,
    signalIceCandidate: [] as Array<(data: { fromPeerId: string; userId: string | null; candidate: RTCIceCandidateInit }) => void>,
    screenShareState: [] as Array<(data: { fromPeerId: string; isScreenSharing: boolean }) => void>,
    reconnect: [] as Array<() => void>,
  });

  useEffect(() => {
    // getWsUrl() é avaliado AQUI dentro do effect (e não no escopo do módulo):
    // `window.location` só tem o valor certo no cliente, e um import do módulo é
    // avaliado uma única vez. Assim o signaling acompanha o host de acesso
    // (localhost, IP Tailscale ou Caddy HTTPS) em cada conexão.
    const wsUrl = getWsUrl();
    const sock = io(wsUrl, {
      auth: { guestName },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      timeout: 20000,
    });

    sock.on('connect', () => {
      setConnected(true);
      console.debug('[Socket] connected', sock.id, wsUrl);
    });

    sock.on('disconnect', (reason: string) => {
      setConnected(false);
      console.debug('[Socket] disconnected', reason);
    });

    // CORS / tailnet barrier / backend fora do ar: sem este handler o badge fica
    // "Desconectado" sem nenhum motivo visível no console.
    sock.on('connect_error', (err: Error) => {
      console.error('[Socket] connect_error', err.message, err);
      setConnected(false);
    });

    sock.on('room:peer-joined', (data: PeerInfo) => {
      callbacksRef.current.peerJoined.forEach((cb) => cb(data));
    });

    sock.on('room:peer-left', (data: { peerId: string }) => {
      callbacksRef.current.peerLeft.forEach((cb) => cb(data));
    });

    sock.on('signal:offer', (data: { fromPeerId: string; userId: string | null; name: string; offer: RTCSessionDescriptionInit }) => {
      callbacksRef.current.signalOffer.forEach((cb) => cb(data));
    });

    sock.on('signal:answer', (data: { fromPeerId: string; userId: string | null; name: string; answer: RTCSessionDescriptionInit }) => {
      callbacksRef.current.signalAnswer.forEach((cb) => cb(data));
    });

    sock.on('signal:ice-candidate', (data: { fromPeerId: string; userId: string | null; candidate: RTCIceCandidateInit }) => {
      callbacksRef.current.signalIceCandidate.forEach((cb) => cb(data));
    });

    sock.on('signal:screen-share-state', (data: { fromPeerId: string; isScreenSharing: boolean }) => {
      callbacksRef.current.screenShareState.forEach((cb) => cb(data));
    });

    // Reconexão: no socket.io v4 o evento 'reconnect' vive no Manager
    // (sock.io.on), NÃO no Socket — `socket.on('reconnect')` nunca dispara.
    // Registramos ambos por compatibilidade.
    sock.io.on('reconnect', () => {
      console.debug('[Socket] manager reconnect');
      callbacksRef.current.reconnect.forEach((cb) => cb());
    });
    sock.on('reconnect', () => {
      console.debug('[Socket] reconnect (legacy)');
      callbacksRef.current.reconnect.forEach((cb) => cb());
    });

    socketRef.current = sock;
    setSocket(sock);

    return () => {
      sock.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, [guestName]);

  const joinRoom = useCallback(
    (
      roomId: string,
      guestNameArg?: string,
      inviteToken?: string,
      password?: string,
    ): Promise<JoinRoomResult> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket || !socket.connected) {
          reject(new Error('Socket not connected'));
          return;
        }

        const payload: { roomId: string; inviteToken?: string; guestName?: string; password?: string } = {
          roomId,
        };
        if (inviteToken) payload.inviteToken = inviteToken;
        if (password) payload.password = password;
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
      // 1500ms é mais que suficiente para o ack normal em rede local/tailnet.
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
          (response: { success?: boolean; error?: string }) => {
            if (response.error) reject(new Error(response.error));
            else resolve();
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

  const onPeerLeft = useCallback((cb: (data: { peerId: string }) => void): (() => void) => {
    callbacksRef.current.peerLeft.push(cb);
    return () => {
      const idx = callbacksRef.current.peerLeft.indexOf(cb);
      if (idx >= 0) callbacksRef.current.peerLeft.splice(idx, 1);
    };
  }, []);

  const onSignalOffer = useCallback((cb: (data: { fromPeerId: string; userId: string | null; name: string; offer: RTCSessionDescriptionInit }) => void): (() => void) => {
    callbacksRef.current.signalOffer.push(cb);
    return () => {
      const idx = callbacksRef.current.signalOffer.indexOf(cb);
      if (idx >= 0) callbacksRef.current.signalOffer.splice(idx, 1);
    };
  }, []);

  const onSignalAnswer = useCallback((cb: (data: { fromPeerId: string; userId: string | null; name: string; answer: RTCSessionDescriptionInit }) => void): (() => void) => {
    callbacksRef.current.signalAnswer.push(cb);
    return () => {
      const idx = callbacksRef.current.signalAnswer.indexOf(cb);
      if (idx >= 0) callbacksRef.current.signalAnswer.splice(idx, 1);
    };
  }, []);

  const onSignalIceCandidate = useCallback((cb: (data: { fromPeerId: string; userId: string | null; candidate: RTCIceCandidateInit }) => void): (() => void) => {
    callbacksRef.current.signalIceCandidate.push(cb);
    return () => {
      const idx = callbacksRef.current.signalIceCandidate.indexOf(cb);
      if (idx >= 0) callbacksRef.current.signalIceCandidate.splice(idx, 1);
    };
  }, []);

  const onScreenShareState = useCallback((cb: (data: { fromPeerId: string; isScreenSharing: boolean }) => void): (() => void) => {
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

  // Retorno memoizado: a identidade do objeto `socketHook` só muda quando um
  // dep realmente muda (socket novo, connected flip, guestName). Consumidores
  // (useWebRTC, page.tsx, useChat) dependem dele sem recriar listeners a cada
  // render.
  return useMemo<UseSocketReturn>(
    () => ({
      socket,
      connected,
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
      onReconnect,
      guestName,
      setGuestName,
    }),
    [
      socket,
      connected,
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
      onReconnect,
      setGuestName,
    ],
  );
}