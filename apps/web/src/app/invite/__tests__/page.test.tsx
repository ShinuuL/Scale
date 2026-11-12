import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import InvitePage from '../page';

vi.mock('next/navigation', () => {
  const router = { push: vi.fn() };
  return { useRouter: () => router };
});

const code = 'abcdefghijklmnopqrstuv';

describe('convite de comunidade', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    window.history.replaceState(null, '', '/invite');
  });

  it('lê o código do fragmento e o remove da URL antes de consultar', async () => {
    window.history.replaceState(null, '', `/invite#${code}`);
    const preview = vi.spyOn(api, 'previewCommunityInvite').mockImplementation(async (received) => {
      expect(window.location.hash).toBe('');
      expect(received).toBe(code);
      return {
        community: { id: 'community', name: 'Equipe', memberCount: 1 },
        alreadyMember: false,
      };
    });
    render(<InvitePage />);
    expect(await screen.findByText('Equipe')).toBeInTheDocument();
    expect(preview).toHaveBeenCalledWith(code);
    expect(JSON.parse(sessionStorage.getItem('scale:community-invite') ?? '{}')).toMatchObject({
      code,
      timestamp: expect.any(Number),
    });
  });

  it('recupera o convite após voltar do login', async () => {
    sessionStorage.setItem(
      'scale:community-invite',
      JSON.stringify({ code, timestamp: Date.now() }),
    );
    const preview = vi
      .spyOn(api, 'previewCommunityInvite')
      .mockResolvedValue({
        community: { id: 'community', name: 'Equipe', memberCount: 2 },
        alreadyMember: false,
      });
    render(<InvitePage />);
    await waitFor(() => expect(preview).toHaveBeenCalledWith(code));
    expect(await screen.findByText('Equipe')).toBeInTheDocument();
  });

  it('descarta convite armazenado há mais de dez minutos', async () => {
    sessionStorage.setItem(
      'scale:community-invite',
      JSON.stringify({ code, timestamp: Date.now() - 600001 }),
    );
    const preview = vi.spyOn(api, 'previewCommunityInvite');
    render(<InvitePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('convite é inválido');
    expect(preview).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('scale:community-invite')).toBeNull();
  });

  it('descarta fragmento inválido sem consultar a API', async () => {
    window.history.replaceState(null, '', '/invite#invalido');
    const preview = vi.spyOn(api, 'previewCommunityInvite');
    render(<InvitePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('convite é inválido');
    expect(window.location.hash).toBe('');
    expect(preview).not.toHaveBeenCalled();
  });
});
