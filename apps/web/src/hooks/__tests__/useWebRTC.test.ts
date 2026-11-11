import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { useWebRTC } from '@/hooks/useWebRTC';
import { ScreenShareNotAllowedError, type UseSocketReturn } from '@/hooks/useSocket';

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
      if (typeof kind !== 'string') transceiver.sender.track = kind;
      this.transceivers.push(transceiver);
      return transceiver;
    },
  );
  getTransceivers = vi.fn((): RTCRtpTransceiver[] => this.transceivers as unknown as RTCRtpTransceiver[]);
  addTrack = vi.fn();
  close = vi.fn();
  restartIce = vi.fn();
  setConfiguration = vi.fn();
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
  | 'peerAudioState'
  | 'moderationAction'
  | 'reconnect';

let getUserMediaMock: ReturnType<typeof vi.fn>;

function createHookMock(myId: string) {
  const handlers = new Map<EventName, Array<(payload: unknown) => void>>();
  type Payload<K extends keyof UseSocketReturn> = UseSocketReturn[K] extends (cb: (data: infer P) => void) => unknown ? P : never;
  const register = <T,>(event: EventName) => (cb: (payload: T) => void) => {
    handlers.set(event, [...(handlers.get(event) ?? []), cb as (payload: unknown) => void]);
    return () => {};
  };

  const hook: UseSocketReturn = {
    socket: { id: myId } as unknown as Socket,
    connected: true,
    isConnected: vi.fn(() => true),
    joinRoom: vi.fn().mockResolvedValue({ success: true, peers: [], history: [] }),
    leaveRoom: vi.fn().mockResolvedValue(undefined),
    emitOffer: vi.fn().mockResolvedValue(undefined),
    emitAnswer: vi.fn().mockResolvedValue(undefined),
    emitIceCandidate: vi.fn().mockResolvedValue(undefined),
    onPeerJoined: vi.fn(register<Payload<'onPeerJoined'>>('peerJoined')),
    onPeerLeft: vi.fn(register<Payload<'onPeerLeft'>>('peerLeft')),
    onSignalOffer: vi.fn(register<Payload<'onSignalOffer'>>('signalOffer')),
    onSignalAnswer: vi.fn(register<Payload<'onSignalAnswer'>>('signalAnswer')),
    onSignalIceCandidate: vi.fn(register<Payload<'onSignalIceCandidate'>>('signalIceCandidate')),
    emitScreenShareState: vi.fn().mockResolvedValue(undefined),
    onScreenShareState: vi.fn(register<Payload<'onScreenShareState'>>('screenShareState')),
    emitAudioState: vi.fn(),
    onPeerAudioState: vi.fn(register<Payload<'onPeerAudioState'>>('peerAudioState')),
    onReconnect: vi.fn(register<void>('reconnect')),
    onRoomDeleted: vi.fn(() => () => {}),
    onModerationAction: vi.fn(register<Payload<'onModerationAction'>>('moderationAction')),
    onModerationWarning: vi.fn(() => () => {}),
    onModerationConfig: vi.fn(() => () => {}),
    onModerationNotice: vi.fn(() => () => {}),
    onMeScreenShare: vi.fn(() => () => {}),
    emitModerationReport: vi.fn().mockResolvedValue(undefined),
    emitModerationStopShare: vi.fn().mockResolvedValue(undefined),
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('dispositivos e ciclo de vida da captura', () => {
  it('troca microfone mantendo mute e sender de voz; falha preserva a captura anterior', async () => {
    const { hook, emit } = createHookMock('me-100');
    const first = createMockTrack('audio');
    const second = createMockTrack('audio');
    getUserMediaMock.mockResolvedValueOnce(new MockMediaStream([first]))
      .mockResolvedValueOnce(new MockMediaStream([second]))
      .mockRejectedValueOnce(new DOMException('Negado', 'NotAllowedError'));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.initMedia(); });
    await emit('signalOffer', { fromPeerId: 'me-050', name: 'Ana', isRegistered: false, offer: { type: 'offer' } });
    act(() => { result.current.toggleMute(); });
    await act(async () => { await result.current.switchMicrophone('usb'); });
    expect(getUserMediaMock).toHaveBeenLastCalledWith({ audio: expect.objectContaining({ deviceId: { exact: 'usb' } }), video: false });
    expect(first.stop).toHaveBeenCalledOnce();
    expect(second.enabled).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(pcInstances[0].transceivers).toHaveLength(1);
    expect(pcInstances[0].transceivers[0].sender.track).toBe(second);
    await act(async () => { await result.current.switchMicrophone('bad-device'); });
    expect(result.current.localStream?.getAudioTracks()).toEqual([second]);
    expect(second.stop).not.toHaveBeenCalled();
  });

  it('microfone removido tenta padrão sem desmutar; captura pendente é parada após cleanup', async () => {
    const { hook } = createHookMock('me-100');
    const first = createMockTrack('audio');
    const fallback = createMockTrack('audio');
    getUserMediaMock.mockResolvedValueOnce(new MockMediaStream([first])).mockResolvedValueOnce(new MockMediaStream([fallback]));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.initMedia(); });
    act(() => { result.current.toggleMute(); });
    await act(async () => { first.onended?.(new Event('ended')); });
    expect(fallback.enabled).toBe(false);
    expect(result.current.localStream?.getAudioTracks()).toEqual([fallback]);
    let resolveCapture: (stream: MockMediaStream) => void = () => {};
    const late = createMockTrack('audio');
    getUserMediaMock.mockReturnValueOnce(new Promise<MockMediaStream>((resolve) => { resolveCapture = resolve; }));
    let pending: Promise<unknown> = Promise.resolve();
    act(() => { pending = result.current.switchMicrophone('late'); });
    act(() => { result.current.cleanupMedia(); });
    await act(async () => { resolveCapture(new MockMediaStream([late])); await pending; });
    expect(late.stop).toHaveBeenCalledOnce();
    expect(result.current.localStream).toBeNull();
  });

  it('replaceTrack rejeitado reverte peers já trocados e preserva captura anterior', async () => {
    const { hook, emit } = createHookMock('me-100');
    const original = createMockTrack('audio');
    const rejected = createMockTrack('audio');
    getUserMediaMock.mockResolvedValueOnce(new MockMediaStream([original])).mockResolvedValueOnce(new MockMediaStream([rejected]));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.initMedia(); });
    for (const peerId of ['me-040', 'me-050']) await emit('signalOffer', { fromPeerId: peerId, name: 'Ana', isRegistered: false, offer: { type: 'offer' } });
    pcInstances[1].transceivers[0].sender.replaceTrack.mockRejectedValueOnce(new DOMException('Requer renegociação', 'InvalidModificationError'));
    await act(async () => { await result.current.switchMicrophone('usb'); });
    expect(result.current.localStream?.getAudioTracks()).toEqual([original]);
    expect(original.stop).not.toHaveBeenCalled();
    expect(rejected.stop).toHaveBeenCalledOnce();
    for (const pc of pcInstances) expect(pc.transceivers[0].sender.track).toBe(original);
  });

  it('falha inicial de microfone mantém mute ao recuperar permissão', async () => {
    const { hook } = createHookMock('me-100');
    const mic = createMockTrack('audio');
    getUserMediaMock.mockRejectedValueOnce(new DOMException('Negado', 'NotAllowedError')).mockResolvedValueOnce(new MockMediaStream([mic]));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.initMedia(); });
    expect(result.current.isMuted).toBe(true);
    await act(async () => { await result.current.switchMicrophone(''); });
    expect(mic.enabled).toBe(false);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.mediaError).toBeNull();
  });

  it('inicialização simultânea compartilha um único pedido de permissão', async () => {
    const { hook } = createHookMock('me-100');
    getUserMediaMock.mockResolvedValue(new MockMediaStream([createMockTrack('audio')]));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await Promise.all([result.current.initMedia(), result.current.initMedia()]); });
    expect(getUserMediaMock).toHaveBeenCalledOnce();
  });
});

describe('tela com áudio independente', () => {
  const acceptOffer = (emit: ReturnType<typeof createHookMock>['emit']) => emit('signalOffer', {
    fromPeerId: 'me-050', name: 'Ana', isRegistered: false, offer: { type: 'offer' },
  });

  it('envia vídeo e loopback separados, mute só afeta mic e parada limpa ambos sem perder voz', async () => {
    const { hook, emit } = createHookMock('me-100');
    const mic = createMockTrack('audio');
    const video = createMockTrack('video');
    const loopback = createMockTrack('audio');
    getUserMediaMock.mockResolvedValue(new MockMediaStream([mic]));
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(new MockMediaStream([video, loopback]) as unknown as MediaStream);
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.initMedia(); });
    await acceptOffer(emit);
    await act(async () => { expect(await result.current.toggleScreenShare()).toBe(true); });
    const pc = pcInstances[0];
    expect(pc.transceivers).toHaveLength(3);
    expect(pc.transceivers.map((t) => t.sender.track)).toEqual([mic, video, loopback]);
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true, selfBrowserSurface: 'exclude' }));
    act(() => { result.current.toggleMute(); });
    expect(mic.enabled).toBe(false);
    expect(loopback.enabled).toBe(true);
    await act(async () => { await result.current.toggleScreenShare(); });
    expect(video.stop).toHaveBeenCalledOnce();
    expect(loopback.stop).toHaveBeenCalledOnce();
    expect(pc.transceivers.map((t) => t.sender.track)).toEqual([mic, null, null]);
    expect(result.current.isMuted).toBe(true);
    expect(result.current.isScreenSharing).toBe(false);
  });

  it('reusa senders ao compartilhar novamente e remove só loopback quando áudio termina', async () => {
    const { hook, emit } = createHookMock('me-100');
    const first = new MockMediaStream([createMockTrack('video'), createMockTrack('audio')]);
    const nextAudio = createMockTrack('audio');
    const nextVideo = createMockTrack('video');
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValueOnce(first as unknown as MediaStream)
      .mockResolvedValueOnce(new MockMediaStream([nextVideo, nextAudio]) as unknown as MediaStream);
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await acceptOffer(emit);
    await act(async () => { await result.current.toggleScreenShare(); await result.current.toggleScreenShare(); await result.current.toggleScreenShare(); });
    expect(pcInstances[0].transceivers).toHaveLength(3);
    await act(async () => { nextAudio.onended?.(new Event('ended')); });
    expect(result.current.screenAudioAvailable).toBe(false);
    expect(result.current.isScreenSharing).toBe(true);
    expect(pcInstances[0].transceivers.map((t) => t.sender.track)).toEqual([null, nextVideo, null]);
    await act(async () => { nextVideo.onended?.(new Event('ended')); });
    expect(result.current.isScreenSharing).toBe(false);
  });

  it('peer novo recebe tela ativa como offerer e answerer; mic tardio não substitui loopback', async () => {
    const { hook, emit } = createHookMock('me-100');
    const loopback = createMockTrack('audio');
    const video = createMockTrack('video');
    const mic = createMockTrack('audio');
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(new MockMediaStream([video, loopback]) as unknown as MediaStream);
    getUserMediaMock.mockResolvedValue(new MockMediaStream([mic]));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.toggleScreenShare(); });
    await emit('peerJoined', { peerId: 'me-200', name: 'Bia', isRegistered: false });
    await acceptOffer(emit);
    await act(async () => { await result.current.initMedia(); });
    for (const pc of pcInstances) expect(pc.transceivers.map((t) => t.sender.track)).toEqual([mic, video, loopback]);
    expect(hook.emitScreenShareState).toHaveBeenCalledWith(ROOM_ID, 'me-200', true);
    expect(hook.emitScreenShareState).toHaveBeenCalledWith(ROOM_ID, 'me-050', true);
  });

  it('falha na troca de tela informa erro e permite parar e tentar novamente', async () => {
    const { hook, emit } = createHookMock('me-100');
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockImplementation(async () => new MockMediaStream([createMockTrack('video')]) as unknown as MediaStream);
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await acceptOffer(emit);
    await act(async () => { await result.current.toggleScreenShare(); await result.current.toggleScreenShare(); });
    const videoTransceiver = pcInstances[0].transceivers[1];
    videoTransceiver.sender.replaceTrack.mockRejectedValueOnce(new DOMException('Requer negociação', 'InvalidModificationError'));
    await act(async () => { await result.current.toggleScreenShare(); });
    expect(result.current.screenShareError).toContain('não aceitou');
    expect(videoTransceiver.direction).toBe('recvonly');
    await act(async () => { await result.current.toggleScreenShare(); await result.current.toggleScreenShare(); });
    expect(videoTransceiver.direction).toBe('sendonly');
    expect(videoTransceiver.sender.track?.kind).toBe('video');
    expect(result.current.screenShareError).toBeNull();
  });

  it('fila alteração de tela durante offer pendente e negocia após a answer', async () => {
    const { hook, emit } = createHookMock('me-100');
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(new MockMediaStream([createMockTrack('video')]) as unknown as MediaStream);
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await emit('peerJoined', { peerId: 'me-200', name: 'Bia', isRegistered: false });
    await act(async () => { await result.current.toggleScreenShare(); });
    expect(hook.emitOffer).toHaveBeenCalledTimes(1);
    await emit('signalAnswer', { fromPeerId: 'me-200', answer: { type: 'answer' } });
    expect(hook.emitOffer).toHaveBeenCalledTimes(2);
    expect(result.current.screenAudioAvailable).toBe(false);
  });

  it('agrega voz e loopback sem vídeo/duplicação; deafen vale para ambos e ended remove só a faixa encerrada', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await acceptOffer(emit);
    const mic = createMockTrack('audio');
    const loopback = createMockTrack('audio');
    const video = createMockTrack('video');
    const screen = new MockMediaStream([video, loopback]);
    await act(async () => {
      pcInstances[0].ontrack?.({ track: mic, streams: [] } as unknown as RTCTrackEvent);
      pcInstances[0].ontrack?.({ track: video, streams: [screen] } as unknown as RTCTrackEvent);
      result.current.toggleDeafen();
      pcInstances[0].ontrack?.({ track: loopback, streams: [screen] } as unknown as RTCTrackEvent);
      pcInstances[0].ontrack?.({ track: loopback, streams: [screen] } as unknown as RTCTrackEvent);
    });
    let peer = result.current.peers.get('me-050');
    expect(peer?.stream?.getAudioTracks()).toEqual([mic, loopback]);
    expect(peer?.stream?.getVideoTracks()).toHaveLength(0);
    expect(peer?.screenStream?.getTracks()).toEqual([video]);
    expect(mic.enabled).toBe(false);
    expect(loopback.enabled).toBe(false);
    // Uma pausa/removal na captura pode apenas silenciar o receiver; não o
    // removemos no mute, pois replaceTrack pode voltar sem novo ontrack.
    act(() => { loopback.onmute?.(new Event('mute')); loopback.onunmute?.(new Event('unmute')); });
    expect(result.current.peers.get('me-050')?.stream?.getAudioTracks()).toHaveLength(2);
    act(() => { loopback.onended?.(new Event('ended')); });
    peer = result.current.peers.get('me-050');
    expect(peer?.stream?.getAudioTracks()).toEqual([mic]);
  });

  it('cancelamento não anuncia tela iniciada e cleanup encerra picker que resolve tarde', async () => {
    const { hook } = createHookMock('me-100');
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockRejectedValueOnce(new DOMException('Cancelado', 'NotAllowedError'));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { expect(await result.current.toggleScreenShare()).toBeNull(); });
    expect(result.current.screenShareError).toContain('cancelado');
    expect(result.current.isScreenSharing).toBe(false);
    let resolvePicker: (stream: MediaStream) => void = () => {};
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockReturnValueOnce(new Promise((resolve) => { resolvePicker = resolve; }));
    let pending: Promise<boolean | null | 'gated'> = Promise.resolve(null);
    act(() => { pending = result.current.toggleScreenShare(); });
    act(() => { result.current.cleanupMedia(); });
    const video = createMockTrack('video');
    await act(async () => { resolvePicker(new MockMediaStream([video]) as unknown as MediaStream); await pending; });
    expect(video.stop).toHaveBeenCalledOnce();
    expect(result.current.localScreenStream).toBeNull();
  });
});

describe('TURN após ticket e retomada', () => {
  it('aguarda ticket e não refaz fetch por mudanças de conexão do socket', async () => {
    const { hook } = createHookMock('me-100');
    const fetchMock = vi.mocked(fetch);
    const { rerender } = renderHook(({ socketHook, ticket }: { socketHook: UseSocketReturn; ticket: string | null }) => useWebRTC(socketHook, ROOM_ID, ticket), {
      initialProps: { socketHook: hook, ticket: null as string | null },
    });
    await act(async () => { window.dispatchEvent(new Event('scale:resume')); });
    await act(async () => { rerender({ socketHook: { ...hook, connected: false }, ticket: null }); });
    await act(async () => { rerender({ socketHook: { ...hook, connected: true }, ticket: null }); });
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => { rerender({ socketHook: hook, ticket: 'room-ticket' }); });
    expect(fetchMock).toHaveBeenCalledOnce();
    await act(async () => { rerender({ socketHook: { ...hook, connected: false }, ticket: 'room-ticket' }); });
    await act(async () => { rerender({ socketHook: { ...hook, connected: true }, ticket: 'room-ticket' }); });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('envia participação no header, atualiza PCs e renova antes da expiração e no resume', async () => {
    vi.useFakeTimers();
    const { hook, emit } = createHookMock('me-100');
    let credential = 0;
    const fetchMock = vi.mocked(fetch).mockImplementation(async () => ({ ok: true, json: async () => ({
      iceServers: [{ urls: 'turn:relay.example', username: `user-${++credential}`, credential: 'ephemeral' }],
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    }) } as Response));
    const { rerender } = renderHook(({ ticket }: { ticket: string | null }) => useWebRTC(hook, ROOM_ID, ticket), { initialProps: { ticket: null as string | null } });
    await emit('signalOffer', { fromPeerId: 'me-050', name: 'Ana', isRegistered: false, offer: { type: 'offer' } });
    await act(async () => { rerender({ ticket: 'room-ticket' }); });
    expect(fetchMock).toHaveBeenLastCalledWith(`/api/turn/credentials?roomId=${ROOM_ID}`, expect.objectContaining({ headers: { 'X-Room-Ticket': 'room-ticket' } }));
    expect(pcInstances[0].setConfiguration).toHaveBeenCalled();
    const before = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(3540000); });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
    const calls = fetchMock.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('scale:resume')); });
    expect(fetchMock).toHaveBeenCalledTimes(calls + 1);
    expect(pcInstances[0].restartIce).toHaveBeenCalledTimes(3);
  });
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
    vi.mocked(hook.emitAnswer).mockClear();

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
    vi.mocked(hook.emitOffer).mockClear();
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
    expect(peer?.stream?.getAudioTracks()).toEqual(remoteAudioStream.getAudioTracks());
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
    expect(peer?.screenStream?.getVideoTracks()).toEqual(remoteScreenStream.getVideoTracks());
    expect(peer?.stream?.getAudioTracks()).toEqual(remoteAudioStream.getAudioTracks());
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

describe('switchMicrophone (troca ao vivo)', () => {
  function stream(): MediaStream {
    return new MockMediaStream([createMockTrack('audio')]) as unknown as MediaStream;
  }
  function senderOf(pc: MockRTCPeerConnection): MockRTCRtpSender {
    return pc.transceivers.filter((t) => t.receiver.track.kind === 'audio')[0].sender;
  }

  it('replaceTrack em todos os peers, para a faixa antiga e entrega um MediaStream novo', async () => {
    const { hook, emit } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    getUserMediaMock.mockResolvedValueOnce(stream());
    await act(async () => {
      await result.current.initMedia();
    });
    await emit('peerJoined', { peerId: 'me-200', isRegistered: false, name: 'Bia' });
    await emit('peerJoined', { peerId: 'me-300', isRegistered: false, name: 'Caio' });
    const oldStream = result.current.localStream;
    const oldTrack = oldStream?.getAudioTracks()[0] as MediaStreamTrack;

    const next = stream();
    getUserMediaMock.mockResolvedValueOnce(next);
    let ok = false;
    await act(async () => {
      ok = await result.current.switchMicrophone('mic-2');
    });

    expect(ok).toBe(true);
    expect(getUserMediaMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ audio: expect.objectContaining({ deviceId: { exact: 'mic-2' } }) }),
    );
    const newTrack = next.getAudioTracks()[0];
    expect(pcInstances).toHaveLength(2);
    pcInstances.forEach((pc) => expect(senderOf(pc).replaceTrack).toHaveBeenLastCalledWith(newTrack));
    expect(oldTrack.stop).toHaveBeenCalled();
    expect(result.current.localStream).toBe(next);
    expect(result.current.localStream).not.toBe(oldStream);
  });

  it('mantém o mudo na faixa nova', async () => {
    const { hook } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    getUserMediaMock.mockResolvedValueOnce(stream());
    await act(async () => {
      await result.current.initMedia();
    });
    act(() => {
      result.current.toggleMute();
    });
    expect(result.current.isMuted).toBe(true);

    const next = stream();
    getUserMediaMock.mockResolvedValueOnce(next);
    await act(async () => {
      await result.current.switchMicrophone('');
    });
    expect(next.getAudioTracks()[0].enabled).toBe(false);
    expect(result.current.isMuted).toBe(true);
  });

  it('falha no getUserMedia: mantém a faixa antiga e devolve false', async () => {
    const { hook } = createHookMock('me-100');
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    getUserMediaMock.mockResolvedValueOnce(stream());
    await act(async () => {
      await result.current.initMedia();
    });
    const oldStream = result.current.localStream;
    const oldTrack = oldStream?.getAudioTracks()[0] as MediaStreamTrack;

    getUserMediaMock.mockRejectedValueOnce(new Error('NotFoundError'));
    let ok = true;
    await act(async () => {
      ok = await result.current.switchMicrophone('sumiu');
    });
    expect(ok).toBe(false);
    expect(oldTrack.stop).not.toHaveBeenCalled();
    expect(result.current.localStream).toBe(oldStream);
    // A voz anterior segue viva: não é "microfone indisponível".
    expect(result.current.mediaError).toBeNull();
  });
});

describe('estado de mudo entre peers', () => {
  it('avisa a sala ao silenciar/ativar e expõe o estado atual', async () => {
    const { hook } = createHookMock('me-100');
    getUserMediaMock.mockResolvedValue(new MockMediaStream([createMockTrack('audio')]));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.initMedia(); });
    expect(result.current.isMutedNow()).toBe(false);
    act(() => { result.current.toggleMute(); });
    expect(hook.emitAudioState).toHaveBeenLastCalledWith(ROOM_ID, true);
    expect(result.current.isMutedNow()).toBe(true);
    act(() => { result.current.toggleMute(); });
    expect(hook.emitAudioState).toHaveBeenLastCalledWith(ROOM_ID, false);
  });

  it('sem microfone fica mudo e avisa', async () => {
    const { hook } = createHookMock('me-100');
    getUserMediaMock.mockRejectedValue(new DOMException('Negado', 'NotAllowedError'));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.initMedia(); });
    expect(result.current.isMutedNow()).toBe(true);
    expect(hook.emitAudioState).toHaveBeenLastCalledWith(ROOM_ID, true);
  });

  it('mudo informado antes da conexão vale ao criar o peer e muda com room:peer-audio-state', async () => {
    const { hook, emit } = createHookMock('me-100');
    getUserMediaMock.mockResolvedValue(new MockMediaStream([createMockTrack('audio')]));
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { await result.current.initMedia(); });
    // me-050 < me-100: o outro lado inicia; o estado chega no peer-joined.
    await emit('peerJoined', { peerId: 'me-050', name: 'Ana', isRegistered: false, muted: true });
    await emit('signalOffer', { fromPeerId: 'me-050', name: 'Ana', isRegistered: false, offer: { type: 'offer' } });
    expect(result.current.peers.get('me-050')?.audioMuted).toBe(true);

    await emit('peerAudioState', { peerId: 'me-050', muted: false });
    expect(result.current.peers.get('me-050')?.audioMuted).toBe(false);
  });
});

describe('moderacao: parar a partilha de tela a forca', () => {
  const acceptOffer = (emit: ReturnType<typeof createHookMock>['emit']) => emit('signalOffer', {
    fromPeerId: 'me-050', name: 'Ana', isRegistered: false, offer: { type: 'offer' },
  });

  it('pre-check recusado devolve "gated" sem chamar getDisplayMedia; parar nunca e bloqueado', async () => {
    const { hook } = createHookMock('me-100');
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(new MockMediaStream([createMockTrack('video')]) as unknown as MediaStream);
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await act(async () => { expect(await result.current.toggleScreenShare({ canShare: () => false })).toBe('gated'); });
    expect(navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
    await act(async () => { expect(await result.current.toggleScreenShare({ canShare: () => true })).toBe(true); });
    await act(async () => { expect(await result.current.toggleScreenShare({ canShare: () => false })).toBe(false); });
    expect(result.current.isScreenSharing).toBe(false);
  });

  it('moderation:action stop-screen-share para a captura e expoe quem parou', async () => {
    const { hook, emit } = createHookMock('me-100');
    const video = createMockTrack('video');
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(new MockMediaStream([video]) as unknown as MediaStream);
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await acceptOffer(emit);
    await act(async () => { await result.current.toggleScreenShare(); });
    expect(result.current.isScreenSharing).toBe(true);

    // Outra sala: ignorado.
    await emit('moderationAction', { roomId: 'outra', action: 'stop-screen-share', category: 'sexual', by: 'assistant' });
    expect(result.current.isScreenSharing).toBe(true);

    await emit('moderationAction', { roomId: ROOM_ID, action: 'stop-screen-share', category: 'sexual', by: 'owner' });
    expect(result.current.isScreenSharing).toBe(false);
    expect(video.stop).toHaveBeenCalledOnce();
    expect(result.current.screenShareStoppedBy).toBe('owner');
    expect(hook.emitScreenShareState).toHaveBeenLastCalledWith(ROOM_ID, 'me-050', false);
    act(() => { result.current.clearScreenShareStop(); });
    expect(result.current.screenShareStoppedBy).toBeNull();
  });

  it('ack SCREEN_SHARE_NOT_ALLOWED no sinal para a captura e informa o motivo', async () => {
    const { hook, emit } = createHookMock('me-100');
    const video = createMockTrack('video');
    vi.mocked(navigator.mediaDevices.getDisplayMedia).mockResolvedValue(new MockMediaStream([video]) as unknown as MediaStream);
    vi.mocked(hook.emitScreenShareState).mockImplementation(async (_room, _peer, sharing) => {
      if (sharing) throw new ScreenShareNotAllowedError('Partilha de tela nao liberada', 'consent');
    });
    const { result } = renderHook(() => useWebRTC(hook, ROOM_ID));
    await acceptOffer(emit);
    await act(async () => { await result.current.toggleScreenShare(); });
    await waitFor(() => expect(result.current.isScreenSharing).toBe(false));
    expect(video.stop).toHaveBeenCalledOnce();
    expect(result.current.screenShareStoppedBy).toBe('gate');
    expect(result.current.screenShareError).toContain('Privacidade');
  });
});
