import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { moderationReportSchema } from '@scale/shared';
import { ReportDialog } from '@/components/room/ReportDialog';
import { ParticipantList } from '@/components/room/ParticipantList';
import type { PeerConnection } from '@/hooks/useWebRTC';

const ROOM_ID = '11111111-1111-4111-8111-111111111111';

function peer(peerId: string, name: string, isScreenSharing = false): PeerConnection {
  return {
    peerId,
    name,
    isRegistered: true,
    connection: {} as RTCPeerConnection,
    stream: null,
    screenStream: null,
    audioMuted: false,
    videoMuted: false,
    isScreenSharing,
  };
}

describe('ReportDialog', () => {
  it('exige motivo, envia payload válido pelo schema e confirma', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ReportDialog roomId={ROOM_ID} target={{ peerId: 'peer-1', name: 'Ana' }} onSubmit={onSubmit} onClose={() => {}} />);
    screen.getByRole('dialog', { name: 'Denunciar Ana' });

    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Escolha um motivo.');
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Motivo/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Bullying ou assédio' }));
    fireEvent.change(screen.getByLabelText('Detalhes (opcional)'), { target: { value: '  Ofensas repetidas no chat  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const payload = onSubmit.mock.calls[0][0];
    expect(payload).toEqual({
      roomId: ROOM_ID,
      targetPeerId: 'peer-1',
      reason: 'bullying',
      details: 'Ofensas repetidas no chat',
    });
    expect(moderationReportSchema.safeParse(payload).success).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent('Denúncia enviada');
  });

  it('limita os detalhes a 300 caracteres e mostra o erro do servidor', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('Rate limit exceeded'));
    render(<ReportDialog roomId={ROOM_ID} target={{ peerId: 'peer-1', name: 'Ana' }} onSubmit={onSubmit} onClose={() => {}} />);
    const details = screen.getByLabelText('Detalhes (opcional)') as HTMLTextAreaElement;
    fireEvent.change(details, { target: { value: 'x'.repeat(350) } });
    expect(details.value).toHaveLength(300);
    fireEvent.click(screen.getByRole('button', { name: /Motivo/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Outro' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar denúncia' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Muitas denúncias seguidas');
  });
});

describe('ParticipantList: menu de denúncia e encerrar partilha', () => {
  it('mostra "Denunciar" só para os outros e "Encerrar partilha" só para o dono com peer ao vivo', async () => {
    const onReport = vi.fn();
    const onStopShare = vi.fn();
    const peers = new Map<string, PeerConnection>([
      ['p1', peer('p1', 'Ana', true)],
      ['p2', peer('p2', 'Bia', false)],
    ]);
    render(
      <ParticipantList peers={peers} localName="Eu" localMuted={false} localScreenSharing onReport={onReport} onStopShare={onStopShare} />,
    );
    expect(screen.queryByRole('button', { name: 'Opções de Eu' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Opções de Ana' }));
    expect(await screen.findByRole('menuitem', { name: 'Encerrar partilha' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Denunciar' }));
    expect(onReport).toHaveBeenCalledWith('p1');

    fireEvent.click(screen.getByRole('button', { name: 'Opções de Bia' }));
    await screen.findByRole('menuitem', { name: 'Denunciar' });
    expect(screen.queryByRole('menuitem', { name: 'Encerrar partilha' })).toBeNull();
  });

  it('sem onStopShare (não é dono) nunca oferece encerrar partilha', async () => {
    const peers = new Map<string, PeerConnection>([['p1', peer('p1', 'Ana', true)]]);
    render(<ParticipantList peers={peers} localMuted={false} localScreenSharing={false} onReport={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opções de Ana' }));
    await screen.findByRole('menuitem', { name: 'Denunciar' });
    expect(screen.queryByRole('menuitem', { name: 'Encerrar partilha' })).toBeNull();
  });
});
