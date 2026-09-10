'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

function getWsUrl(): string {
  if (typeof window !== 'undefined') {
    // On HTTPS pages (Tailscale cert via Caddy), signaling must stay on the same
    // origin: Caddy proxies /socket.io to the backend. Mixed http(s)://host:4000
    // would be blocked by the browser.
    if (window.location.protocol === 'https:') {
      return window.location.origin;
    }
    // Plain HTTP (default): connect straight to the backend port, as before.
    return `${window.location.protocol}//${window.location.hostname}:4000`;
  }
  return process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';
}
const WS_URL = getWsUrl();

export interface PeerInfo {
  peerId: string;
  userId: string | null;
  name: string;
  guestName?: string;
}

export interface UseSocketReturn {
  socket: Socket | null;
  connected: boolean;
  joinRoom: (
    roomId: string,
    guestName?: string,
    inviteToken?: string,
  ) => Promise<{ success: boolean; peers: PeerInfo[] }>;
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
    const socket = io(WS_URL, {
      auth: { guestName },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('room:peer-joined', (data: PeerInfo) => {
      callbacksRef.current.peerJoined.forEach((cb) => cb(data));
    });

    socket.on('room:peer-left', (data: { peerId: string }) => {
      callbacksRef.current.peerLeft.forEach((cb) => cb(data));
    });

    socket.on('signal:offer', (data: { fromPeerId: string; userId: string | null; name: string; offer: RTCSessionDescriptionInit }) => {
      callbacksRef.current.signalOffer.forEach((cb) => cb(data));
    });

    socket.on('signal:answer', (data: { fromPeerId: string; userId: string | null; name: string; answer: RTCSessionDescriptionInit }) => {
      callbacksRef.current.signalAnswer.forEach((cb) => cb(data));
    });

    socket.on('signal:ice-candidate', (data: { fromPeerId: string; userId: string | null; candidate: RTCIceCandidateInit }) => {
      callbacksRef.current.signalIceCandidate.forEach((cb) => cb(data));
    });

    socket.on('signal:screen-share-state', (data: { fromPeerId: string; isScreenSharing: boolean }) => {
      callbacksRef.current.screenShareState.forEach((cb) => cb(data));
    });

    // Fired after the socket.io manager successfully re-establishes the
    // connection (socket.id may have changed). Consumers use this to re-join
    // the room and recover signaling state.
    socket.on('reconnect', () => {
      callbacksRef.current.reconnect.forEach((cb) => cb());
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [guestName]);

  const joinRoom = useCallback(
    (
      roomId: string,
      guestNameArg?: string,
      inviteToken?: string,
    ): Promise<{ success: boolean; peers: PeerInfo[] }> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket) {
          reject(new Error('Socket not connected'));
          return;
        }

        const payload: { roomId: string; inviteToken?: string; guestName?: string } = { roomId };
        if (inviteToken) payload.inviteToken = inviteToken;
        if (guestNameArg) payload.guestName = guestNameArg;
        else payload.guestName = guestName;

        socket.emit('join-room', payload, (response: { success?: boolean; peers?: PeerInfo[]; error?: string }) => {
          if (response.error) {
            reject(new Error(response.error));
            return;
          }
          resolve({ success: response.success ?? true, peers: response.peers ?? [] });
        });
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
      socket.emit('leave-room', { roomId }, () => resolve());
    });
  }, []);

  const emitOffer = useCallback(
    (roomId: string, targetPeerId: string, offer: RTCSessionDescriptionInit): Promise<void> => {
      return new Promise((resolve, reject) => {
        const socket = socketRef.current;
        if (!socket) return reject(new Error('Socket not connected'));
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
        if (!socket) return reject(new Error('Socket not connected'));
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
        if (!socket) return reject(new Error('Socket not connected'));
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
        if (!socket) return reject(new Error('Socket not connected'));
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

  return {
    socket: socketRef.current,
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
  };
}
