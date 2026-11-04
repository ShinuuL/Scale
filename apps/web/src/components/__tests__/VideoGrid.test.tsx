import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VideoGrid, collectLiveShares, resolveFocus, LOCAL_ID } from '@/components/room/VideoGrid';
import type { PeerConnection } from '@/hooks/useWebRTC';

function stream(kinds: Array<'audio' | 'video'>): MediaStream {
  const tracks = kinds.map((kind, i) => ({ id: `${kind}-${i}`, kind, readyState: 'live' }));
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  } as unknown as MediaStream;
}

function peer(id: string, name: string, sharing: boolean): PeerConnection {
  return {
    peerId: id,
    isRegistered: false,
    name,
    connection: {} as RTCPeerConnection,
    stream: stream(['audio']),
    screenStream: sharing ? stream(['video']) : null,
    audioMuted: false,
    videoMuted: false,
    isScreenSharing: sharing,
  };
}

describe('palco Go Live: regra de foco', () => {
  it('a transmissão de outra pessoa vence a sua por padrão', () => {
    const peers = new Map([['p1', peer('p1', 'Bia', true)]]);
    const shares = collectLiveShares(peers, stream(['video']), 'Gabriel');
    expect(shares.map((s) => s.id)).toEqual([LOCAL_ID, 'p1']);
    expect(resolveFocus(shares, null)?.id).toBe('p1');
  });

  it('foco escolhido vale enquanto a transmissão existir; se acabar, volta ao automático', () => {
    const peers = new Map([
      ['p1', peer('p1', 'Bia', true)],
      ['p2', peer('p2', 'Caio', true)],
    ]);
    const shares = collectLiveShares(peers, null, 'Gabriel');
    expect(resolveFocus(shares, 'p2')?.id).toBe('p2');
    expect(resolveFocus(shares, 'sumiu')?.id).toBe('p1');
  });

  it('peer que parou de transmitir não entra no palco (stream velha ignorada)', () => {
    const stale = { ...peer('p1', 'Bia', true), isScreenSharing: false };
    expect(collectLiveShares(new Map([['p1', stale]]), null, 'Gabriel')).toHaveLength(0);
  });
});

describe('VideoGrid', () => {
  const base = {
    localStream: stream(['audio']),
    isMuted: false,
    localName: 'Gabriel',
  };

  it('sem transmissão: cartões do canal de voz, sem palco', () => {
    render(<VideoGrid {...base} peers={new Map([['p1', peer('p1', 'Bia', false)]])} localScreenStream={null} />);
    expect(screen.getByRole('region', { name: 'Participantes do canal de voz' })).toBeTruthy();
    expect(screen.queryByText('Ao vivo')).toBeNull();
  });

  it('só a própria tela: cartão "Você está transmitindo" em vez do espelho, com prévia opcional', () => {
    render(<VideoGrid {...base} peers={new Map()} localScreenStream={stream(['video'])} />);
    expect(screen.getByText('Você está transmitindo sua tela')).toBeTruthy();
    expect(document.querySelector('video')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /mostrar prévia/i }));
    expect(document.querySelector('video')).not.toBeNull();
  });

  it('miniatura de outra transmissão leva ao foco', () => {
    const focused: string[] = [];
    const peers = new Map([
      ['p1', peer('p1', 'Bia', true)],
      ['p2', peer('p2', 'Caio', true)],
    ]);
    render(
      <VideoGrid {...base} peers={peers} localScreenStream={null} onFocusShare={(id) => focused.push(id)} />,
    );
    expect(screen.getByRole('region', { name: 'Transmissão de Bia' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Assistir transmissão de Caio' }));
    expect(focused).toEqual(['p2']);
  });

  it('áudio dos peers fica numa camada própria (um <audio> por peer, inclusive com palco)', () => {
    const peers = new Map([
      ['p1', peer('p1', 'Bia', true)],
      ['p2', peer('p2', 'Caio', false)],
    ]);
    render(<VideoGrid {...base} peers={peers} localScreenStream={null} />);
    expect(document.querySelectorAll('audio')).toHaveLength(2);
  });

  it('mostra a foto de perfil de quem tem; sem foto ou se a imagem falhar, a inicial', () => {
    const peers = new Map([
      ['p1', peer('p1', 'Bia', false)],
      ['p2', peer('p2', 'Caio', false)],
    ]);
    const avatars = new Map([
      [LOCAL_ID, '/api/me/avatar?v=1'],
      ['p1', 'blob:foto-da-bia'],
    ]);
    render(<VideoGrid {...base} peers={peers} localScreenStream={null} avatars={avatars} />);
    const imgs = Array.from(document.querySelectorAll('img'));
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['/api/me/avatar?v=1', 'blob:foto-da-bia']);
    // Decorativa: o nome ja esta no rotulo do cartao.
    imgs.forEach((i) => expect(i).toHaveAttribute('alt', ''));
    expect(screen.getByText('C')).toBeInTheDocument();

    fireEvent.error(imgs[1]);
    expect(screen.getByText('B')).toBeInTheDocument();
  });
});
