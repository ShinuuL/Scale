import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUserRow } from '@scale/shared';
import AdminUsersPage from '../page';
import { api, type MeUser } from '@/lib/api';

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

const me: MeUser = {
  id: 'ana',
  name: 'Ana',
  email: 'ana@example.test',
  createdAt: '2026-11-06T10:00:00.000Z',
  isAdmin: true,
  adminSource: 'db',
};

function row(partial: Partial<AdminUserRow> & Pick<AdminUserRow, 'id' | 'name'>): AdminUserRow {
  return {
    username: null,
    emailMasked: 'xx***@example.test',
    createdAt: '2026-11-01T10:00:00.000Z',
    admin: null,
    grantedBy: null,
    grantedAt: null,
    isSelf: false,
    ...partial,
  };
}

const root = row({ id: 'root', name: 'Raiz', admin: 'env' });
const self = row({ id: 'ana', name: 'Ana', admin: 'db', isSelf: true, grantedBy: { id: 'root', name: 'Raiz' } });
const bruno = row({ id: 'bruno', name: 'Bruno', username: 'bruno' });
const carla = row({ id: 'carla', name: 'Carla', admin: 'db', grantedBy: { id: 'root', name: 'Raiz' } });

describe('/admin/users', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockReset();
    vi.spyOn(api, 'getMe').mockResolvedValue({ user: me });
    vi.spyOn(api, 'getAdminRoleAudit').mockResolvedValue({ entries: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lista os usuários com papel e e-mail mascarado', async () => {
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [root, self, bruno, carla], nextCursor: null });
    render(<AdminUsersPage />);
    expect(await screen.findByText('Bruno')).toBeInTheDocument();
    expect(screen.getByText('Raiz (.env)')).toBeInTheDocument();
    expect(screen.getAllByText('Admin')).toHaveLength(2);
    expect(screen.getByText('Usuário')).toBeInTheDocument();
    expect(screen.getByText('@bruno')).toBeInTheDocument();
    expect(screen.getAllByText('xx***@example.test').length).toBe(4);
  });

  it('busca chama a api com q só depois do debounce', async () => {
    const getUsers = vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [bruno], nextCursor: null });
    render(<AdminUsersPage />);
    await screen.findByText('Bruno');
    expect(getUsers).toHaveBeenLastCalledWith(expect.objectContaining({ q: undefined, filter: 'all' }));
    getUsers.mockClear();
    vi.useFakeTimers();
    fireEvent.change(screen.getByLabelText('Buscar por nome, @nome ou e-mail'), { target: { value: 'bru' } });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(getUsers).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(getUsers).toHaveBeenCalledWith(expect.objectContaining({ q: 'bru', filter: 'all' }));
  });

  it('filtro Admins refaz a busca com filter=admins', async () => {
    const getUsers = vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [bruno], nextCursor: null });
    render(<AdminUsersPage />);
    await screen.findByText('Bruno');
    fireEvent.click(screen.getByRole('radio', { name: 'Admins' }));
    await waitFor(() =>
      expect(getUsers).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'admins' })),
    );
  });

  it('"Tornar admin" pede confirmação e só então chama o servidor', async () => {
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [bruno], nextCursor: null });
    const grant = vi
      .spyOn(api, 'grantAdmin')
      .mockResolvedValue({ ...bruno, admin: 'db', grantedBy: { id: 'ana', name: 'Ana' } });
    render(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tornar Bruno admin' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(grant).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(grant).toHaveBeenCalledWith('bruno'));
    expect(await screen.findByRole('button', { name: 'Remover admin de Bruno' })).toBeInTheDocument();
  });

  it('"Remover admin" confirma e chama revoke; cancelar não chama', async () => {
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [carla], nextCursor: null });
    const revoke = vi.spyOn(api, 'revokeAdmin').mockResolvedValue({ ...carla, admin: null, grantedBy: null });
    render(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remover admin de Carla' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(revoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remover admin de Carla' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(revoke).toHaveBeenCalledWith('carla'));
  });

  it('raiz e o próprio usuário têm "Remover admin" inativo com o motivo', async () => {
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [root, self], nextCursor: null });
    const revoke = vi.spyOn(api, 'revokeAdmin');
    render(<AdminUsersPage />);
    const rootBtn = await screen.findByRole('button', { name: 'Remover admin de Raiz' });
    const selfBtn = screen.getByRole('button', { name: 'Remover admin de Ana' });
    expect(rootBtn).toHaveAttribute('aria-disabled', 'true');
    expect(selfBtn).toHaveAttribute('aria-disabled', 'true');
    expect(rootBtn).toHaveAccessibleDescription('Admin raiz: só pode ser removido no .env');
    expect(selfBtn).toHaveAccessibleDescription('Você não pode remover o seu próprio acesso');
    fireEvent.click(rootBtn);
    fireEvent.click(selfBtn);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('"Carregar mais" busca com o cursor e acrescenta à lista', async () => {
    const getUsers = vi
      .spyOn(api, 'getAdminUsers')
      .mockResolvedValueOnce({ users: [bruno], nextCursor: 'c1' })
      .mockResolvedValueOnce({ users: [carla], nextCursor: null });
    render(<AdminUsersPage />);
    await screen.findByText('Bruno');
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Carla')).toBeInTheDocument();
    expect(screen.getByText('Bruno')).toBeInTheDocument();
    expect(getUsers).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c1' }));
    expect(screen.queryByRole('button', { name: 'Carregar mais' })).not.toBeInTheDocument();
  });

  it('erro env_admin vira mensagem em português', async () => {
    vi.spyOn(api, 'getAdminUsers').mockResolvedValue({ users: [carla], nextCursor: null });
    vi.spyOn(api, 'revokeAdmin').mockRejectedValue({ error: 'env_admin', status: 409 });
    render(<AdminUsersPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remover admin de Carla' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remover' }));
    expect(await screen.findByText('Admin raiz: só pode ser removido no .env.')).toBeInTheDocument();
  });
});
