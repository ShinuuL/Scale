import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useWebRTC } from '@/hooks/useWebRTC';
import type { UseSocketReturn } from '@/hooks/useSocket';

// ─── Mocks de WebRTC (jsdom não implementa RTCPeerConnection) ──
// Registry de instâncias para os testes inspecionarem signalingState e
// descrições aplicadas.
let pcInstances: MockRTCPeerConnection[] = [];

// ─── Mocks de mídia (jsdom não implementa MediaStream/MediaStreamTrack) ──
let trackCounter = 0;
let streamCounter = 0;

function createMockTrack(kind: 'audio' | 'video'): MediaStreamTrack {
  trackCounter += 1;
  return {
    kind,
    id: `track-${kind}-${trackCounter}`,
    enabled: true,
    muted: false,
    readyState: 'live',
    onended: null,
    onmute: null,
    onunmute: null,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

class MockMediaStream {
  id: string;
  private tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    streamCounter += 1;
    this.id = `stream-${streamCounter}`;
    this.tracks = [...tracks];
  }

  getTracks(): MediaStreamTrack[] {
    return [...this.tracks];
  }

  getAudioTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'audio');
  }

  getVideoTracks(): MediaStreamTrack[] {
    return this.tracks.filter((t) => t.kind === 'video');
  }

  addTrack(track: MediaStreamTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: MediaStreamTrack): void {
    this.tracks = this.tracks.filter((t) => t !== track);
  }

  getId(): string {
    return this.id;
  }
}

class MockRTCRtpSender {
  track: MediaStreamTrack | null = null;
  replaceTrack = vi.fn(async (track: MediaStreamTrack | null): Promise<void> => {
    this.track = track;
  });
  setStreams = vi.fn();
}

class MockRTCRtpTransceiver {
  direction: RTCRtpTransceiverDirection;
  currentDirection: RTCRtpTransceiverDirection | null = null;
  mid: string | null = null;
  sender: MockRTCRtpSender;
  receiver: { track: MediaStreamTrack };
  /** Streams passadas em `addTransceiver({ streams })` (associação de msid). */
  streams: MediaStream[];
  /** Origem — JSEP 5.10 só reaproveita na offer remota os criados por addTrack. */
  origin: 'addTransceiver' | 'addTrack' | 'remote' = 'addTransceiver';

  constructor(kind: 'audio' | 'video', init?: RTCRtpTransceiverInit) {
    this.direction = init?.direction ?? 'sendrecv';
    this.sender = new MockRTCRtpSender();
    this.receiver = { track: createMockTrack(kind) };
    this.streams = [...(init?.streams ?? [])];
  }
}

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
  transceivers: MockRTCRtpTransceiver[] = [];

  getSenders = vi.fn((): RTCRtpSender[] =>
    this.transceivers.map((t) => t.sender as unknown as RTCRtpSender),
  );
  addTransceiver = vi.fn(
    (kind: string | MediaStreamTrack, init?: RTCRtpTransceiverInit): MockRTCRtpTransceiver => {
      const trackKind = typeof kind === 'string' ? kind : kind.kind;
      const transceiver = new MockRTCRtpTransceiver(
        trackKind === 'video' ? 'video' : 'audio',
        init,
      );
      this.transceivers.push(transceiver);
      return transceiver;
    },
  );
  getTransceivers = vi.fn((): RTCRtpTransceiver[] => [...this.transceivers]);
  addTrack = vi.fn();
  close = vi.fn();
  restartIce = vi.fn();
  createOffer = vi.fn(
    async () => ({ type: 'offer', sdp: 'local-offer-sdp' }) as RTCSessionDescriptionInit,
  );
  createAnswer = vi.fn(
    async () => ({ type: 'answer', sdp: 'local-answer-sdp' }) as RTCSessionDescriptionInit,
  );
  private nextMid = 0;

  /** Associa a um m-line os transceivers ainda sem mid (offer local). */
  private assignMids(): void {
    this.transceivers.forEach((t) => {
      if (t.mid === null) t.mid = String(this.nextMid++);
    });
  }

  /**
   * Offer remota (as offers dos testes sempre trazem m=audio): JSEP 5.10 —
   * reaproveita só transceiver de áudio NÃO associado criado por addTrack;
   * senão cria um NOVO recvonly. Um criado por addTransceiver fica órfão.
   */
  private applyRemoteOffer(): void {
    const audio = this.transceivers.filter((t) => t.receiver.track.kind === 'audio');
    if (audio.some((t) => t.mid !== null)) return;
    const reusable = audio.find((t) => t.origin === 'addTrack');
    if (reusable) {
      reusable.mid = String(this.nextMid++);
      return;
    }
    const created = new MockRTCRtpTransceiver('audio', { direction: 'recvonly' });
    created.origin = 'remote';
    created.mid = String(this.nextMid++);
    this.transceivers.push(created);
  }

  setLocalDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    if (desc.type === 'offer') this.assignMids();
    this.localDescription = desc as RTCSessionDescription;
    this.signalingState = desc.type === 'offer' ? 'have-local-offer' : 'stable';
  });
  setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit) => {
    if (desc.type === 'rollback') {
      this.remoteDescription = null;
      this.signalingState = 'stable';
      return;
    }
    if (desc.type === 'offer') this.applyRemoteOffer();
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

let getUserMediaMock: ReturnType<typeof vi.fn>;

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
    onRoomDeleted: vi.fn(() => () => {}),
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
  // jsdom não implementa MediaStream: o ontrack monta `new MediaStream([track])`
  // quando a faixa remota chega SEM stream associada (caso replaceTrack).
  vi.stubGlobal('MediaStream', MockMediaStream as unknown as typeof MediaStream);
  // getUserMedia é bloqueado fora de https/localhost: jsdom reporta localhost,
  // mas o hook lê window.isSecureContext — garantimos o valor.
  vi.stubGlobal('isSecureContext', true);
  // jsdom não implementa navigator.mediaDevices.
  getUserMediaMock = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getUserMedia: getUserMediaMock, getDisplayMedia: vi.fn() },
    configurable: true,
    writable: true,
  });
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

    await emit('peerJoined', { peerId: 'me-200', isRegistered: false, name: 'Bia' });

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

    await emit('peerJoined', { peerId: 'me-050', isRegistered: false, name: 'Ana' });

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
    await emit('peerJoined', { peerId: 'me-200', isRegistered: false, name: 'Bia' });
    expect(hook.emitOffer).toHaveBeenCalledTimes(1);
    expect(pcInstances).toHaveLength(1);
    expect(pcInstances[0].signalingState).toBe('have-local-offer');

    // 2) Chega offer remota (ex.: renegociação de screen-share) com negociação
    //    pendente — como polite, fazemos rollback implícito e aceitamos.
    await emit('signalOffer', {
      fromPeerId: 'me-200',
      isRegistered: false,
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
      isRegistered: false,
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
      isRegistered: false,
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

    await emit('peerJoined', { peerId: 'me-200', isRegistered: false, name: 'Bia' });
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
      isRegistered: false,
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

// ─── Bug: "o colega não me ouvia até certo ponto" ─────────────
// O backend emite room:peer-joined ANTES do ack do join-room, então a offer
// do outro lado chega ao novato enquanto o prompt de permissão do microfone
// ainda está aberto. O PC do novato nascia SEM transceiver de áudio → o SDP
// negociado ficava sem `m=audio` e o áudio só aparecia quando alguma
// renegociação fortuita arrastava o transceiver pendente (o "começou a me
// ouvir do nada"). A correção cria o transceiver de áudio SEMPRE, antes de
// qualquer offer, e anexa a faixa depois com replaceTrack (que não exige
// renegociação).
describe('transceiver de áudio e corrida initMedia x signaling', () => {
  /** MediaStream local com uma faixa de áudio "real". */
  function makeLocalStream(): MediaStream {
    return new MockMediaStream([createMockTrack('audio')]) as unknown as MediaStream;
  }

  /** Primeiro transceiver de áudio do PC. */
  function audioTransceiver(pc: MockRTCPeerConnection): MockRTCRtpTransceiver {
    const audio = pc.transceivers.filter((t) => t.receiver.track.kind === 'audio');
    const found = audio.find((t) => t.mid !== null) ?? audio[0];
    if (!found) throw new Error('PC sem transceiver de áudio');
    return found;
  }

  it('cria SEMPRE um transceiver de áudio sendrecv, mesmo sem mídia local', async () => {
    const { hook, emit } = createHookMock('me-100');
    renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('peerJoined', { peerId: 'me-200', isRegistered: false, name: 'Bia' });

    const pc = pcInstances[0];
    expect(pc.addTransceiver).toHaveBeenCalledWith(
      'audio',
      expect.objectContaining({ direction: 'sendrecv' }),
    );
    expect(audioTransceiver(pc).direction).toBe('sendrecv');
    // Sem streams locais: o init não deve carregar `streams` (nada para associar).
    expect(pc.addTransceiver.mock.calls[0][1]).not.toHaveProperty('streams');
    // Offer criada DEPOIS — o m-line de áudio já vem na negociação inicial.
    expect(pc.createOffer).toHaveBeenCalledTimes(1);
  });

  it('faixa anexada tarde: replaceTrack no transceiver de áudio, sem addTrack e sem nova offer', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    // 1) Offer de um peer chega ANTES do getUserMedia resolver
    //    (só acontece quando somos o lado impolite: socket id MAIOR).
    await emit('signalOffer', {
      fromPeerId: 'me-050',
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });
    expect(hook.emitAnswer).toHaveBeenCalledTimes(1);
    const pc = pcInstances[0];
    pc.createOffer.mockClear();
    hook.emitOffer.mockClear();
    const transceiver = audioTransceiver(pc);
    expect(transceiver.sender.track).toBeNull(); // ainda não há mídia

    // 2) O prompt de permissão resolve → initMedia
    getUserMediaMock.mockResolvedValue(makeLocalStream());
    await act(async () => {
      await result.current.initMedia();
    });

    // 3) A faixa entra pelo transceiver já NEGOCIADO (replaceTrack não exige
    //    renegociação) — o peer remoto passa a receber o áudio.
    const audioTrack = result.current.localStream?.getAudioTracks()[0];
    expect(audioTrack).toBeDefined();
    expect(transceiver.sender.replaceTrack).toHaveBeenCalledWith(audioTrack);
    expect(transceiver.sender.track).toBe(audioTrack);
    // Nada de addTrack (criaria um SEGUNDO transceiver de áudio) nem de
    // renegociação: o transceiver já foi negociado com a mídia ainda ausente.
    expect(pc.addTrack).not.toHaveBeenCalled();
    expect(pc.createOffer).not.toHaveBeenCalled();
    expect(hook.emitOffer).not.toHaveBeenCalled();
  });

  it('quando a mídia JÁ existe, o transceiver nasce com a faixa (msid/streams preservados)', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    getUserMediaMock.mockResolvedValue(makeLocalStream());
    await act(async () => {
      await result.current.initMedia();
    });
    const localStream = result.current.localStream;
    const audioTrack = localStream?.getAudioTracks()[0];

    // Nós somos o lado que oferece (socket id menor).
    await emit('peerJoined', { peerId: 'me-200', isRegistered: false, name: 'Bia' });

    const pc = pcInstances[0];
    // `streams` no init do addTransceiver é o que garante event.streams[0]
    // populado no peer remoto (W3C: "these are the streams that will be put in
    // the event").
    expect(pc.addTransceiver).toHaveBeenCalledWith(
      'audio',
      expect.objectContaining({ direction: 'sendrecv', streams: [localStream] }),
    );
    expect(audioTransceiver(pc).sender.track).toBe(audioTrack);
    expect(pc.addTrack).not.toHaveBeenCalled();
  });

  it('offer tardia (novato): a faixa já pronta é anexada ao transceiver do PC recém-criado', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    getUserMediaMock.mockResolvedValue(makeLocalStream());
    await act(async () => {
      await result.current.initMedia();
    });
    const audioTrack = result.current.localStream?.getAudioTracks()[0];

    await emit('signalOffer', {
      fromPeerId: 'me-050',
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });

    const pc = pcInstances[0];
    expect(audioTransceiver(pc).sender.track).toBe(audioTrack);
    expect(pc.addTrack).not.toHaveBeenCalled();
  });
});

describe('lado que responde: áudio no transceiver associado à offer (JSEP 5.10)', () => {
  function audioTransceivers(pc: MockRTCPeerConnection): MockRTCRtpTransceiver[] {
    return pc.transceivers.filter((t) => t.receiver.track.kind === 'audio');
  }

  it('não cria transceiver órfão: um único de áudio, associado, sendrecv e com o microfone', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    getUserMediaMock.mockResolvedValue(
      new MockMediaStream([createMockTrack('audio')]) as unknown as MediaStream,
    );
    await act(async () => {
      await result.current.initMedia();
    });
    const localStream = result.current.localStream;
    const micTrack = localStream?.getAudioTracks()[0];

    await emit('signalOffer', {
      fromPeerId: 'me-050',
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });

    const pc = pcInstances[0];
    expect(pc.addTransceiver).not.toHaveBeenCalled();
    const audio = audioTransceivers(pc);
    // Antes da correção: 2 transceivers — o órfão (mid null) levava o microfone
    // e o associado ficava recvonly sem faixa = colega nunca ouvia quem respondeu.
    expect(audio).toHaveLength(1);
    expect(audio[0].mid).not.toBeNull();
    expect(audio[0].direction).toBe('sendrecv');
    expect(audio[0].sender.track).toBe(micTrack);
    expect(audio[0].sender.setStreams).toHaveBeenCalledWith(localStream);
    expect(hook.emitAnswer).toHaveBeenCalledTimes(1);
  });

  it('microfone que chega depois da answer entra no transceiver associado', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('signalOffer', {
      fromPeerId: 'me-050',
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });
    const pc = pcInstances[0];
    const [associated] = audioTransceivers(pc);
    // Já sendrecv na answer, mesmo sem microfone — o replaceTrack tardio dispensa renegociação.
    expect(associated.direction).toBe('sendrecv');
    expect(associated.sender.track).toBeNull();

    getUserMediaMock.mockResolvedValue(
      new MockMediaStream([createMockTrack('audio')]) as unknown as MediaStream,
    );
    await act(async () => {
      await result.current.initMedia();
    });

    expect(audioTransceivers(pc)).toHaveLength(1);
    expect(associated.sender.track).toBe(result.current.localStream?.getAudioTracks()[0]);
    expect(pc.createOffer).not.toHaveBeenCalled();
  });

  it('pede o microfone com cancelamento de eco, supressão de ruído e ganho automático', async () => {
    const { hook } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    getUserMediaMock.mockResolvedValue(
      new MockMediaStream([createMockTrack('audio')]) as unknown as MediaStream,
    );
    await act(async () => {
      await result.current.initMedia();
    });
    expect(getUserMediaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audio: expect.objectContaining({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }),
      }),
    );
  });
});

describe('ontrack: áudio e tela em streams separadas', () => {
  /** Streams de áudio e de vídeo do peer remoto (o mock precisa ter as faixas). */
  const remoteAudioStream = new MockMediaStream([createMockTrack('audio')]);
  const remoteScreenStream = new MockMediaStream([createMockTrack('video')]);

  function trackEvent(
    kind: 'audio' | 'video',
    track: MediaStreamTrack,
    streams: MediaStream[],
  ): RTCTrackEvent {
    return { track, streams, transceiver: {}, receiver: {} } as unknown as RTCTrackEvent;
  }

  it('ontrack de áudio preenche peer.stream', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('signalOffer', {
      fromPeerId: 'me-050',
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });

    const pc = pcInstances[0];
    const audioTrack = remoteAudioStream.getAudioTracks()[0];
    await act(async () => {
      pc.ontrack?.(trackEvent('audio', audioTrack, [remoteAudioStream] as unknown as MediaStream[]));
    });

    const peer = result.current.peers.get('me-050');
    expect(peer?.stream).toBe(remoteAudioStream as unknown as MediaStream);
    expect(peer?.screenStream).toBeNull();
  });

  it('ontrack de VÍDEO (screen share) preenche screenStream e NÃO destrói o áudio', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('signalOffer', {
      fromPeerId: 'me-050',
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });

    const pc = pcInstances[0];
    const audioTrack = remoteAudioStream.getAudioTracks()[0];
    await act(async () => {
      pc.ontrack?.(trackEvent('audio', audioTrack, [remoteAudioStream] as unknown as MediaStream[]));
    });
    // O screen share usa addTrack(videoTrack, screenStream) — uma MediaStream
    // DIFERENTE, só de vídeo. Antes da correção ela sobrescrevia `stream` e o
    // <audio> ficava com srcObject sem faixa alguma = silêncio.
    await act(async () => {
      pc.ontrack?.(
        trackEvent('video', remoteScreenStream.getVideoTracks()[0], [
          remoteScreenStream as unknown as MediaStream,
        ]),
      );
    });

    const peer = result.current.peers.get('me-050');
    expect(peer?.screenStream).toBe(remoteScreenStream as unknown as MediaStream);
    expect(peer?.stream).toBe(remoteAudioStream as unknown as MediaStream);
    expect(peer?.stream?.getAudioTracks()).toHaveLength(1);
  });

  it('ontrack SEM event.streams (replaceTrack/receiver) monta a stream da própria faixa', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('signalOffer', {
      fromPeerId: 'me-050',
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });

    const pc = pcInstances[0];
    const audioTrack = createMockTrack('audio');
    await act(async () => {
      pc.ontrack?.(trackEvent('audio', audioTrack, []));
    });

    const peer = result.current.peers.get('me-050');
    expect(peer?.stream).not.toBeNull();
    expect(peer?.stream?.getAudioTracks()).toEqual([audioTrack]);
  });
});

describe('deafen persistente', () => {
  it('faixa remota que chega DEPOIS do deafen nasce silenciada', async () => {
    const myId = 'me-100';
    const peerId = 'me-050';
    const { hook, emit } = createHookMock(myId);
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('signalOffer', {
      fromPeerId: peerId,
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });
    const pc = pcInstances[0];

    // Já temos um peer na malha → o deafen é permitido.
    expect(result.current.peers.size).toBe(1);
    act(() => {
      expect(result.current.toggleDeafen()).toBe(true);
    });

    // A faixa remota só chega agora (ex.: transceiver de áudio criado sem
    // mídia no outro lado, que anexou depois com replaceTrack).
    const lateTrack = createMockTrack('audio');
    await act(async () => {
      pc.ontrack?.({
        track: lateTrack,
        streams: [],
        transceiver: {},
        receiver: {},
      } as unknown as RTCTrackEvent);
    });

    // Antes da correção a faixa nascia com enabled = true e o deafen era
    // perdido (o estado no React dizia "surdo" mas o áudio voltava).
    expect(lateTrack.enabled).toBe(false);
    expect(result.current.peers.get(peerId)?.stream?.getAudioTracks()[0].enabled).toBe(false);
  });

  it('toggleDeafen aplica enabled em todas as faixas de áudio dos peers', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));

    await emit('signalOffer', {
      fromPeerId: 'me-050',
      isRegistered: false,
      name: 'Ana',
      offer: { type: 'offer', sdp: 'first-offer-sdp' },
    });

    const remoteStream = new MockMediaStream([createMockTrack('audio')]);
    const pc = pcInstances[0];
    await act(async () => {
      pc.ontrack?.({
        track: remoteStream.getAudioTracks()[0],
        streams: [remoteStream as unknown as MediaStream],
        transceiver: {},
        receiver: {},
      } as unknown as RTCTrackEvent);
    });

    const track = remoteStream.getAudioTracks()[0];
    act(() => {
      result.current.toggleDeafen();
    });
    expect(track.enabled).toBe(false);

    act(() => {
      result.current.toggleDeafen();
    });
    expect(track.enabled).toBe(true);
  });
});