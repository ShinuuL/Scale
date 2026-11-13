import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommunitySettingsDialog } from '../CommunityDialogs';
import { api, type CommunityDetail } from '@/lib/api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const none = { manageChannels: false, manageInvites: false, manageMessages: false, kickMembers: false };
const all = { manageChannels: true, manageInvites: true, manageMessages: true, kickMembers: true };
const role = { id: 'r1', name: 'Moderador', color: '#22aa88', permissions: { ...none, manageMessages: true } };
function detail(overrides: Partial<CommunityDetail>): CommunityDetail {
  return {
    community: { id: 'c1', name: 'Grupo', ownerId: 'dono', iconVersion: null },
    myRole: 'OWNER',
    myPermissions: all,
    roles: [role],
    channels: [{ id: 'ch1', name: 'geral', kind: 'TEXT', position: 0 }],
    members: [
      { userId: 'dono', name: 'Dono', username: null, role: 'OWNER', customRoleId: null },
      { userId: 'u2', name: 'Bia', username: null, role: 'MEMBER', customRoleId: null },
    ],
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Cargos personalizados', () => {
  it('dono cria cargo com cor e permissões e atribui a um membro', async () => {
    vi.spyOn(api, 'listCommunityInvites').mockResolvedValue({ invites: [] });
    const create = vi.spyOn(api, 'createCommunityRole').mockResolvedValue();
    const assign = vi.spyOn(api, 'setMemberCustomRole').mockResolvedValue();
    const onChanged = vi.fn();
    render(<CommunitySettingsDialog detail={detail({})} meId="dono" onClose={vi.fn()} onChanged={onChanged} onGone={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Editar cargo Moderador' })).toBeTruthy();
    expect(screen.getAllByText(/Apagar mensagens de outros/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Nome do cargo'), { target: { value: 'VIP' } });
    const checks = screen.getAllByLabelText('Expulsar membros');
    fireEvent.click(checks[checks.length - 1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Criar cargo' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'VIP', permissions: expect.objectContaining({ kickMembers: true }) })));
    fireEvent.change(screen.getByLabelText('Cargo de Bia'), { target: { value: 'r1' } });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('c1', 'u2', 'r1'));
  });

  it('membro com cargo só vê o que o cargo permite', () => {
    const invites = vi.spyOn(api, 'listCommunityInvites').mockResolvedValue({ invites: [] });
    render(<CommunitySettingsDialog detail={detail({ myRole: 'MEMBER', myPermissions: { ...none, manageChannels: true } })} meId="u2" onClose={vi.fn()} onChanged={vi.fn()} onGone={vi.fn()} />);
    expect(screen.getByText('Canais')).toBeTruthy();
    expect(screen.queryByText('Cargos')).toBeNull();
    expect(screen.queryByText('Convites')).toBeNull();
    expect(screen.queryByRole('button', { name: /Expulsar/ })).toBeNull();
    expect(invites).not.toHaveBeenCalled();
  });
});
