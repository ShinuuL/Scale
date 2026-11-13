import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { moderationNotice, outranks } from '@scale/shared';
import { MemberList, type Member } from '../CommunityParts';
import { AuditPanel, BansPanel, ModerationDialog, auditText } from '../ModerationDialogs';
import { CommunitySettingsDialog } from '../CommunityDialogs';
import { api, type CommunityDetail } from '@/lib/api';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => vi.restoreAllMocks());

const all = { manageChannels: true, manageInvites: true, manageMessages: true, kickMembers: true };
const members: Member[] = [
  { userId: 'dono', name: 'Dono', username: null, role: 'OWNER', customRoleId: null },
  { userId: 'u2', name: 'Bia', username: null, role: 'MEMBER', customRoleId: null, timeoutUntil: new Date(Date.now() + 60_000).toISOString() },
  { userId: 'u3', name: 'Caio', username: null, role: 'MEMBER', customRoleId: null },
];

describe('hierarquia e aviso', () => {
  it('ninguem age sobre o dono nem sobre igual', () => {
    expect(outranks({ role: 'ADMIN' }, { role: 'OWNER' })).toBe(false);
    expect(outranks({ role: 'ADMIN' }, { role: 'ADMIN' })).toBe(false);
    expect(outranks({ role: 'MEMBER', customRoleId: 'r' }, { role: 'MEMBER' })).toBe(true);
  });
  it('texto do aviso ao alvo traz motivo', () => {
    expect(moderationNotice({ communityId: 'c', communityName: 'Grupo', action: 'ban', until: null, reason: 'spam' })).toBe('Você foi banido de Grupo. Motivo: spam');
  });
});

describe('menu de contexto do membro', () => {
  it('mostra castigar, expulsar e banir so para quem posso moderar e marca castigado', async () => {
    const onModerate = vi.fn();
    render(<MemberList members={members} canModerate={(m) => m.role !== 'OWNER'} onModerate={onModerate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opções de Dono' }));
    await screen.findByRole('menuitem', { name: 'Ver perfil' });
    expect(screen.queryByRole('menuitem', { name: 'Castigar' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Ver perfil' }));
    cleanup();
    render(<MemberList members={members} canModerate={(m) => m.role !== 'OWNER'} onModerate={onModerate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opções de Bia, de castigo' }));
    expect(await screen.findByRole('menuitem', { name: 'Remover castigo' })).toBeTruthy();
    cleanup();
    render(<MemberList members={members} canModerate={(m) => m.role !== 'OWNER'} onModerate={onModerate} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opções de Caio' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Banir' }));
    expect(onModerate).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u3' }), 'ban');
  });
});

describe('dialogo de moderacao', () => {
  it('castigo envia duracao e motivo', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<ModerationDialog action="timeout" member={{ name: 'Caio' }} onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Motivo (opcional)'), { target: { value: ' flood ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar castigo' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith({ duration: '10m', reason: 'flood' }));
    expect(onClose).toHaveBeenCalled();
  });
  it('erro 403 explica a hierarquia', async () => {
    const onConfirm = vi.fn().mockRejectedValue({ status: 403 });
    render(<ModerationDialog action="ban" member={{ name: 'Caio' }} onConfirm={onConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Banir membro' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/não pode agir/);
  });
});

describe('banidos e auditoria', () => {
  it('lista banidos e desbane', async () => {
    const list = vi.spyOn(api, 'listCommunityBans')
      .mockResolvedValueOnce({ bans: [{ userId: 'u9', name: 'Zé', reason: 'spam', bannedById: 'dono', createdAt: new Date().toISOString() }] })
      .mockResolvedValueOnce({ bans: [] });
    const unban = vi.spyOn(api, 'unbanCommunityMember').mockResolvedValue();
    render(<BansPanel communityId="c1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Desbanir Zé' }));
    await waitFor(() => expect(unban).toHaveBeenCalledWith('c1', 'u9'));
    expect(await screen.findByText('Ninguém foi banido.')).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });
  it('auditoria pagina com carregar mais', async () => {
    const entry = (id: string, action: 'member.kick' | 'channel.create') => ({ id, action, actorId: 'dono', actorName: 'Dono', targetId: 'x', targetName: 'Alvo', reason: null, detail: null, createdAt: new Date().toISOString() });
    const get = vi.spyOn(api, 'getCommunityAudit')
      .mockResolvedValueOnce({ entries: [entry('a', 'member.kick')], nextCursor: 'a' })
      .mockResolvedValueOnce({ entries: [entry('b', 'channel.create')], nextCursor: null });
    render(<AuditPanel communityId="c1" />);
    expect(await screen.findByText('Dono · Expulsou Alvo')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('Dono · Criou o canal Alvo')).toBeTruthy();
    expect(get).toHaveBeenLastCalledWith('c1', 'a');
    expect(auditText({ ...entry('c', 'member.kick'), action: 'member.timeout', detail: '1 hora' })).toBe('Dono · Castigou Alvo por 1 hora');
  });
  it('configuracoes tem abas Banidos e Auditoria', async () => {
    vi.spyOn(api, 'listCommunityInvites').mockResolvedValue({ invites: [] });
    vi.spyOn(api, 'getCommunityAudit').mockResolvedValue({ entries: [], nextCursor: null });
    const detail: CommunityDetail = {
      community: { id: 'c1', name: 'Grupo', ownerId: 'dono' }, myRole: 'OWNER', myPermissions: all, roles: [],
      channels: [{ id: 'ch1', name: 'geral', kind: 'TEXT', position: 0 }], members,
    };
    render(<CommunitySettingsDialog detail={detail} meId="dono" onClose={vi.fn()} onChanged={vi.fn()} onGone={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Banidos' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Auditoria' }));
    expect(await screen.findByText('Nenhuma ação registrada.')).toBeTruthy();
  });
});
