import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { MessageSearchDialog } from '../MessageSearchDialog';

const channelId = '11111111-1111-4111-8111-111111111111';
const hit = { id: '22222222-2222-4222-8222-222222222222', channelId, channelName: 'geral', author: { id: 'u1', name: 'Ana', username: null }, content: 'Reunião de AÇÃO amanhã', createdAt: '2026-11-01T12:00:00.000Z' };

describe('MessageSearchDialog', () => {
  afterEach(() => vi.restoreAllMocks());

  it('busca com filtros, destaca o termo sem HTML cru e abre o resultado', async () => {
    const search = vi.spyOn(api, 'searchCommunityMessages').mockResolvedValue({ results: [hit], nextCursor: null });
    const open = vi.fn();
    render(
      <MessageSearchDialog
        communityId="c1"
        channels={[{ id: channelId, name: 'geral' }]}
        members={[{ userId: 'u1', name: 'Ana' }]}
        onClose={vi.fn()}
        onOpen={open}
      />,
    );
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'acao' } });
    fireEvent.change(screen.getByLabelText('Canal'), { target: { value: channelId } });
    fireEvent.change(screen.getByLabelText('Autor'), { target: { value: 'u1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() => expect(screen.getByText('AÇÃO').tagName).toBe('MARK'));
    expect(search).toHaveBeenCalledWith('c1', expect.objectContaining({ q: 'acao', channelId, authorId: 'u1' }));
    expect(screen.getByText('em #geral')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ana/ }));
    expect(open).toHaveBeenCalledWith(hit);
  });

  it('exige ao menos 2 caracteres e trata limite', async () => {
    const search = vi.spyOn(api, 'searchCommunityMessages').mockRejectedValue({ status: 429 });
    render(<MessageSearchDialog communityId="c1" channels={[]} members={[]} onClose={vi.fn()} onOpen={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/ao menos 2/)).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Texto'), { target: { value: 'ab' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText(/Muitas buscas/)).toBeInTheDocument();
  });
});
