import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CommunityAuditEntry, CommunityVoiceState } from '@scale/shared';
import { MemberList, type Member } from '../CommunityParts';
import { NicknameDialog, nicknameError, nicknameMap, withVoiceNicknames } from '../NicknameDialog';
import { auditText } from '../ModerationDialogs';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const members: Member[] = [
  { userId: 'dono', name: 'Dono', username: null, role: 'OWNER', customRoleId: null },
  { userId: 'u2', name: 'Bia', username: null, role: 'MEMBER', customRoleId: null, nickname: 'Biazinha' },
];

describe('apelido na lista de membros', () => {
  it('mostra o apelido com o nome real no title e no perfil', async () => {
    render(<MemberList members={members} />);
    const label = screen.getByText('Biazinha');
    expect(label.getAttribute('title')).toBe('Bia');
    fireEvent.click(screen.getByRole('button', { name: 'Opções de Biazinha' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Ver perfil' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Biazinha');
    expect(dialog.textContent).toContain('Bia');
  });

  it('"Mudar apelido" so aparece para quem pode editar', async () => {
    const onNickname = vi.fn();
    render(<MemberList members={members} canEditNickname={(m) => m.userId === 'u2'} onNickname={onNickname} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opções de Dono' }));
    await screen.findByRole('menuitem', { name: 'Ver perfil' });
    expect(screen.queryByRole('menuitem', { name: 'Mudar apelido' })).toBeNull();
    cleanup();
    render(<MemberList members={members} canEditNickname={(m) => m.userId === 'u2'} onNickname={onNickname} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opções de Biazinha' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Mudar apelido' }));
    expect(onNickname).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }));
  });
});

describe('dialogo de apelido', () => {
  it('salva com trim e remove com null', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<NicknameDialog member={{ name: 'Bia', nickname: 'Biazinha' }} self onSave={onSave} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Apelido nesta comunidade'), { target: { value: '  Bi  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Bi'));
    expect(onClose).toHaveBeenCalled();
    cleanup();
    render(<NicknameDialog member={{ name: 'Bia', nickname: 'Biazinha' }} self onSave={onSave} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remover apelido' }));
    await waitFor(() => expect(onSave).toHaveBeenLastCalledWith(null));
  });

  it('mostra erro do servidor e mantem aberto', async () => {
    const onClose = vi.fn();
    render(<NicknameDialog member={{ name: 'Caio' }} self={false} onSave={() => Promise.reject(Object.assign(new Error('x'), { status: 429 }))} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Apelido nesta comunidade'), { target: { value: 'C' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect((await screen.findByRole('alert')).textContent).toBe(nicknameError({ status: 429 }));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('apelido em voz e auditoria', () => {
  it('troca o nome nos cartoes de voz', () => {
    const map = nicknameMap(members);
    const states: CommunityVoiceState[] = [{
      channelId: 'c', members: [{ userId: 'u2', name: 'Bia', muted: false, deafened: false, screenSharing: false }],
    }] as CommunityVoiceState[];
    expect(withVoiceNicknames(states, map)[0]?.members[0]?.name).toBe('Biazinha');
  });

  it('rotulos legiveis das novas acoes', () => {
    const base: CommunityAuditEntry = { id: 'a', action: 'member.nickname', actorId: 'x', actorName: 'Dono', targetId: 'u2', targetName: 'Bia', reason: null, detail: 'Bi', createdAt: new Date().toISOString() };
    expect(auditText(base)).toBe('Dono · Mudou o apelido de Bia: Bi');
    expect(auditText({ ...base, action: 'channel.user_limit', targetName: 'Voz', detail: '4 pessoas' })).toBe('Dono · Mudou o limite de pessoas do canal Voz: 4 pessoas');
    expect(auditText({ ...base, action: 'community.welcome', targetName: 'geral', detail: 'mensagem atualizada' })).toBe('Dono · Mudou as boas-vindas em geral: mensagem atualizada');
    expect(auditText({ ...base, action: 'channel.settings', targetName: 'geral', detail: 'aviso ligado, 0 permissões' })).toBe('Dono · Mudou as configurações do canal geral: aviso ligado, 0 permissões');
  });
});
