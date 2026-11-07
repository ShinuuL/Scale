import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RoomCard } from '../RoomCard';
import { copyText } from '@/lib/clipboard';
vi.mock('@/lib/clipboard', () => ({ copyText: vi.fn() }));
const room = { id: 'room-one', name: 'Equipe', participantCount: 2, isPersistent: true, hasPassword: false, canDelete: true };

describe('RoomCard independent actions', () => {
  it('copying or deleting does not enter the room', async () => {
    vi.mocked(copyText).mockResolvedValue(true);
    const enter = vi.fn();
    const remove = vi.fn();
    render(<RoomCard room={room} onEnter={enter} onDelete={remove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link da sala Equipe' }));
    expect(await screen.findByRole('button', { name: 'Link copiado' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apagar sala Equipe' }));
    expect(remove).toHaveBeenCalledOnce();
    expect(enter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Entrar na sala Equipe' }));
    expect(enter).toHaveBeenCalledOnce();
  });
  it('reports a failed clipboard operation with recovery guidance', async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    render(<RoomCard room={room} onEnter={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar link da sala Equipe' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Não foi possível copiar o link');
  });
});
