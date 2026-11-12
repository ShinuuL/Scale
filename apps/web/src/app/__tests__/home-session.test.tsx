import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HomePage from '../page';
import { api } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return { ...original, api: { ...original.api, getMe: vi.fn(), listRooms: vi.fn(), createRoom: vi.fn() } };
});
vi.mock('@/components/layout/AppShell', () => ({ AppShell: ({ accountSlot, children }: { accountSlot: ReactNode; children: ReactNode }) => <main>{accountSlot}{children}</main> }));

const user = { id: 'u1', name: 'Ana', email: 'ana@example.test', createdAt: '2026-01-01', avatarUpdatedAt: null };

beforeEach(() => {
  vi.mocked(api.getMe).mockReset();
  vi.mocked(api.listRooms).mockReset();
  vi.mocked(api.createRoom).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('scale.onboardingDone', 'true');
});

describe('home session states', () => {
  it.each([new TypeError('Failed to fetch'), { status: 503 }])('does not present a failed session lookup as a guest and retries in place', async (error) => {
    vi.mocked(api.getMe).mockRejectedValueOnce(error).mockResolvedValueOnce({ user });
    vi.mocked(api.listRooms).mockResolvedValueOnce({ rooms: [] });
    render(<HomePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar sua conta');
    expect(screen.queryByRole('button', { name: 'Perfil de Convidado' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Entrar na conta' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Criar sala' })).toBeDisabled();
    expect(api.listRooms).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('button', { name: 'Perfil de Ana' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Nenhuma sala persistente ainda')).toBeInTheDocument());
    expect(api.listRooms).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([401, 403])('keeps the guest invitation flow for an explicit %i response', async (status) => {
    vi.mocked(api.getMe).mockRejectedValueOnce({ status });
    render(<HomePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continuar como convidado' }));
    expect(await screen.findByRole('button', { name: 'Perfil de Convidado' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar na conta' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.listRooms).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Código da sala' }), { target: { value: 'room-code' } });
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled();
  });

  it('receives a visitor without session on the landing page', async () => {
    vi.mocked(api.getMe).mockRejectedValueOnce({ status: 401 });
    render(<HomePage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Sua sala de voz, sem complicação.' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Criar conta' })[0]).toHaveAttribute('href', '/register');
    expect(screen.getByRole('button', { name: 'Entrar na sala' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Perfil de Convidado' })).not.toBeInTheDocument();
  });

  it('skips the landing when the guest choice was made in this tab', async () => {
    sessionStorage.setItem('scale.guestBrowse', 'true');
    vi.mocked(api.getMe).mockRejectedValueOnce({ status: 401 });
    render(<HomePage />);
    expect(await screen.findByRole('button', { name: 'Perfil de Convidado' })).toBeInTheDocument();
  });
});
