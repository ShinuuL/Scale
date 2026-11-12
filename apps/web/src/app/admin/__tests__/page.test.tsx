import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminHubPage from '../page';
import { api, type MeUser } from '@/lib/api';
import { takeFlash } from '@/lib/flash';
import { ADMIN_ONLY_FLASH } from '@/components/admin/moderationLabels';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace, push: vi.fn() }) }));
vi.mock('@/hooks/useUserEvents', () => ({ useUserEvents: () => ({ connected: false }) }));
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children, accountSlot }: { children: ReactNode; accountSlot?: ReactNode }) => (
    <main>
      <div>{accountSlot}</div>
      <div>{children}</div>
    </main>
  ),
}));
vi.mock('@/components/ui/ProfileMenu', () => ({
  ProfileMenu: () => <button type="button">Minha conta</button>,
}));

const admin: MeUser = {
  id: 'ana',
  name: 'Ana',
  email: 'ana@example.test',
  createdAt: '2026-11-06T10:00:00.000Z',
  isAdmin: true,
  adminSource: 'env',
};

describe('/admin (hub)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
    window.sessionStorage.clear();
  });

  it('redireciona quem não é admin para a home com aviso', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: { ...admin, isAdmin: false, adminSource: null } });
    render(<AdminHubPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(takeFlash()?.message).toBe(ADMIN_ONLY_FLASH);
    expect(screen.queryByRole('link', { name: /Moderação/ })).not.toBeInTheDocument();
  });

  it('sem sessão vai para o login', async () => {
    vi.spyOn(api, 'getMe').mockRejectedValue({ error: 'unauthorized', status: 401 });
    render(<AdminHubPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('admin vê os três cartões com os destinos certos', async () => {
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: admin });
    render(<AdminHubPage />);
    const moderation = await screen.findByRole('link', { name: /Moderação/ });
    expect(moderation).toHaveAttribute('href', '/admin/moderation');
    expect(screen.getByRole('link', { name: /Métricas/ })).toHaveAttribute('href', '/metrics');
    expect(screen.getByRole('link', { name: /Administradores/ })).toHaveAttribute('href', '/admin/users');
    expect(replace).not.toHaveBeenCalled();
  });
});
