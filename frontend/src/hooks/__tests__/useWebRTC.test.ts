import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useWebRTC } from '@/hooks/useWebRTC';
import type { UseSocketReturn } from '@/hooks/useSocket';

// ─── Mocks de WebRTC (jsdom não implementa RTCPeerConnection) ──
// Registry de instâncias para os testes inspecionarem signalingState e
// descrições aplicadas.
let pcInstances: MockRTCPeerConnection[] = [];

class MockRTCSessionDescription {
  type: RTCSdpType;
  sdp?: string;

  constructor(init: RTCSessionDescriptionInit) {
    this.type = init.type;
    this.sdp = init.sdp;
  }

  toJSON(): RTCSessionDescriptionInit {
    return { type: this.type, sdp: this.sdp };
  }
}

class MockRTCPeerConnection {
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;

  getSenders = vi.fn(() => [] as RTCRtpSender[]);
  addTrack = vi.fn();
  close = vi.fn();
  restartIce = vi.fn();
  createOffer = vi.fn(
    async () => ({ type: 'offer', sdp: 'local-offer-sdp' }) as RTCSessionDescriptionInit,
  );
  createAnswer = vi.fn(
    async () => ({ type: 'answer', sdp: 'local-answer-sdp' }) as RTCSessionDescriptionInit,
  );
  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    this.localDescription = desc as RTCSessionDescription;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
  });
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    if (desc.type === 'rollback') {
      this.remoteDescription = null;
      this.signalingState = 'stable';
      return;
    }
    this.remoteDescription = desc as RTCSessionDescription;
    this.signalingState = desc.type === 'offer' ? 'have-remote-offer' : 'stable';
  });
  addIceCandidate = vi.fn(async () => undefined);

  constructor(config?: RTCConfiguration) {
    void config;
    pcInstances.push(this);
  }
}

const ROOM_ID = 'room-test';
type EventName =
  | 'peerJoined'
  | 'peerLeft'
  | 'signalOffer'
  | 'signalAnswer'
  | 'signalIceCandidate'
  | 'screenShareState'
  | 'reconnect';

function createHookMock(myId: string) {
  const handlers = new Map<EventName, Array<(payload: unknown) => void>>();
  const register = (event: EventName) => (cb: (payload: unknown) => void) => {
    handlers.set(event, [...(handlers.get(event) ?? []), cb]);
    return () => {};
  };

  const hook: UseSocketReturn = {
    socket: { id: myId } as unknown as Socket,
    connected: true,
    joinRoom: vi.fn().mockResolvedValue({ success: true, peers: [], history: [] }),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    emitOffer: vi.fn().mockResolvedValue(undefined),
    emitAnswer: vi.fn().mockResolvedValue(undefined),
    emitIceCandidate: vi.fn().mockResolvedValue(undefined),
    onPeerJoined: vi.fn(register('peerJoined')),
    onPeerLeft: vi.fn(register('peerLeft')),
    onSignalOffer: vi.fn(register('signalOffer')),
    onSignalAnswer: vi.fn(register('signalAnswer')),
    onSignalIceCandidate: vi.fn(register('signalIceCandidate')),
    emitScreenShareState: vi.fn().mockResolvedValue(undefined),
    onScreenShareState: vi.fn(register('screenShareState')),
    onReconnect: vi.fn(register('reconnect')),
    guestName: 'Test',
    setGuestName: vi.fn(),
  };

  const emit = async (event: EventName, payload: unknown) => {
    await act(async () => {
      for (const cb of handlers.get(event) ?? []) {
        await (cb as (p: unknown) => Promise<void> | void)(payload);
      }
    });
  };

  return { hook, handlers, emit };
}

beforeEach(() => {
  pcInstances = [];
  vi.stubGlobal('RTCPeerConnection', MockRTCPeerConnection as unknown as typeof RTCPeerConnection);
  vi.stubGlobal(
    'RTCSessionDescription',
    MockRTCSessionDescription as unknown as typeof RTCSessionDescription,
  );
  // fetchIceServers() roda no mount — no network em teste.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ iceServers: [] }) }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shouldInitiate (regra determinística de quem inicia offer)', () => {
  it('inicia offer para peer com id MAIOR (myId < remotePeerId → true)', async () => {
    const { hook, emit } = createHookMock('me-100');
    renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('peerJoined', { peerId: 'me-200', userId: null, name: 'Bia' });

    expect(hook.emitOffer).toHaveBeenCalledTimes(1);
    expect(hook.emitOffer).toHaveBeenCalledWith(
      ROOM_ID,
      'me-200',
      expect.objectContaining({ type: 'offer' }),
    );
  });

  it('NÃO inicia offer para peer com id MENOR (myId > remotePeerId → false)', async () => {
    const { hook, emit } = createHookMock('me-100');
    renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('peerJoined', { peerId: 'me-050', userId: null, name: 'Ana' });

    // Regra: o socket id menor oferece → devemos esperar a offer do outro lado.
    expect(hook.emitOffer).not.toHaveBeenCalled();
    expect(pcInstances).toHaveLength(0);
  });
});

describe('glare / perfect negotiation no signal:offer (Bloqueio critic #4)', () => {
  it('polite (myId < fromPeerId) aceita a offer remota mesmo com offer pendente', async () => {
    const { hook, emit } = createHookMock('me-100');
    renderHook(() => useWebRTC(hook, ROOM_ID));

    // 1) Nossa offer inicial ao peer (estado have-local-offer pendente)
    await emit('peerJoined', { peerId: 'me-200', userId: null, name: 'Bia' });
    expect(hook.emitOffer).toHaveBeenCalledTimes(1);
    expect(pcInstances).toHaveLength(1);
    expect(pcInstances[0].signalingState).toBe('have-local-offer');

    // 2) Chega offer remota (ex.: renegociação de screen-share) com negociação
    //    pendente — como polite, fazemos rollback implícito e aceitamos.
    await emit('signalOffer', {
      fromPeerId: 'me-200',
      userId: null,
      name: 'Bia',
      offer: { type: 'offer', sdp: 'remote-offer-sdp' },
    });

    const pc = pcInstances[0];
    expect(pc.remoteDescription?.sdp).toBe('remote-offer-sdp');
    expect(pc.createAnswer).toHaveBeenCalledTimes(1);
    expect(hook.emitAnswer).toHaveBeenCalledTimes(1);
    expect(hook.emitAnswer).toHaveBeenCalledWith(
      ROOM_ID,
      'me-200',
      expect.objectContaining({ type: 'answer' }),
    );
  });

  it('impolite (myId > fromPeerId) mantém a offer própria e ignora a colidente', async () => {
    const { hook, emit } = createHookMock('me-100');
    renderHook(() => useWebRTC(hook, ROOM_ID));

    // 1) Recebemos a offer inicial do peer (cria o PC e responde normalmente)
    await emit('signalOffer', {
      fromPeerId: 'me-050',
      userId: null,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });
    expect(hook.emitAnswer).toHaveBeenCalledTimes(1);
    expect(pcInstances).toHaveLength(1);
    const pc = pcInstances[0];
    expect(pc.signalingState).toBe('stable');

    // 2) Nossa renegociação (screen-share/ICE) deixou uma offer pendente
    pc.signalingState = 'have-local-offer';
    pc.localDescription = { type: 'offer', sdp: 'our-screen-offer' } as unknown as RTCSessionDescription;
    pc.setRemoteDescription.mockClear();
    pc.createAnswer.mockClear();
    hook.emitAnswer.mockClear();

    // 3) Offer colidente do peer → impolite ignora e mantém a nossa
    await emit('signalOffer', {
      fromPeerId: 'me-050',
      userId: null,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'colliding-offer-sdp' },
    });

    expect(pc.setRemoteDescription).not.toHaveBeenCalled();
    expect(pc.createAnswer).not.toHaveBeenCalled();
    expect(hook.emitAnswer).not.toHaveBeenCalled();
    expect(pc.signalingState).toBe('have-local-offer'); // nossa offer intacta
  });

  it('polite com browser sem rollback implícito: InvalidStateError → rollback explícito + retry', async () => {
    const { hook, emit } = createHookMock('me-100');
    renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('peerJoined', { peerId: 'me-200', userId: null, name: 'Bia' });
    const pc = pcInstances[0];
    expect(pc.signalingState).toBe('have-local-offer');

    // Simula browser antigo: 1ª tentativa de setRemoteDescription(offer) lança
    // InvalidStateError; depois do rollback explícito, aceita.
    let offerCalls = 0;
    pc.setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
      if (desc.type === 'rollback') {
        pc.signalingState = 'stable';
        pc.remoteDescription = null;
        return;
      }
      offerCalls += 1;
      if (offerCalls === 1) {
        const err = new Error('Cannot set remote offer in state have-local-offer') as Error & {
          name: string;
        };
        err.name = 'InvalidStateError';
        throw err;
      }
      pc.remoteDescription = desc as RTCSessionDescription;
      pc.signalingState = 'have-remote-offer';
    });

    await emit('signalOffer', {
      fromPeerId: 'me-200',
      userId: null,
      name: 'Bia',
      offer: { type: 'offer', sdp: 'remote-offer-sdp' },
    });

    expect(offerCalls).toBe(2); // falhou na 1ª → rollback → retry na 2ª
    expect(pc.setRemoteDescription).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'rollback' }),
    );
    expect(pc.remoteDescription?.sdp).toBe('remote-offer-sdp');
    // Após criar e aplicar a answer, a negociação conclui e volta a stable.
    expect(pc.signalingState).toBe('stable');
    expect(hook.emitAnswer).toHaveBeenCalledTimes(1);
    expect(hook.emitAnswer).toHaveBeenCalledWith(
      ROOM_ID,
      'me-200',
      expect.objectContaining({ type: 'answer' }),
    );
  });
});