import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { DirectMessage } from '@scale/shared';
import { DirectChat } from '@/components/friends/DirectChat';
import { api } from '@/lib/api';

const friend = { id: 'bia', username: 'bia', name: 'Bia', avatarUpdatedAt: null };

function msg(id: string, senderId: string, content: string, createdAt: string): DirectMessage {
  return { id, senderId, recipientId: senderId === 'ana' ? 'bia' : 'ana', content, createdAt };
}

describe('DirectChat', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('carrega o histórico, envia com Enter e não duplica o eco do socket', async () => {
    vi.spyOn(api, 'getDirectMessages').mockResolvedValue({
      messages: [msg('1', 'bia', 'oi, Ana', '2026-10-23T10:00:00.000Z')],
      hasMore: false,
    });
    const sent = msg('2', 'ana', 'oi, Bia', '2026-10-23T10:01:00.000Z');
    const send = vi.spyOn(api, 'sendDirectMessage').mockResolvedValue(sent);

    const { rerender } = render(
      <DirectChat meId="ana" friend={friend} incoming={[]} onRemoveFriend={() => {}} />,
    );
    expect(await screen.findByText('oi, Ana')).toBeTruthy();

    const input = screen.getByLabelText('Mensagem para Bia');
    fireEvent.change(input, { target: { value: '  oi, Bia  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledWith('bia', 'oi, Bia'));
    expect(await screen.findByText('oi, Bia')).toBeTruthy();

    // O mesmo id chega de novo pelo socket: continua uma vez só.
    rerender(<DirectChat meId="ana" friend={friend} incoming={[sent]} onRemoveFriend={() => {}} />);
    expect(screen.getAllByText('oi, Bia')).toHaveLength(1);
  });

  it('desfazer amizade pede confirmação', async () => {
    vi.spyOn(api, 'getDirectMessages').mockResolvedValue({ messages: [], hasMore: false });
    const onRemove = vi.fn();
    render(<DirectChat meId="ana" friend={friend} incoming={[]} onRemoveFriend={onRemove} />);
    expect(await screen.findByText(/Nenhuma mensagem ainda/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Desfazer amizade com Bia' }));
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Desfazer' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
