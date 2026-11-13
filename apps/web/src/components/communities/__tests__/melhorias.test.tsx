import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { CommunityRail, MemberList, type Member } from '../CommunityParts';

const communities = [
  { id: 'a', name: 'Alfa', role: 'MEMBER' as const },
  { id: 'b', name: 'Beta', role: 'MEMBER' as const },
  { id: 'c', name: 'Gama', role: 'MEMBER' as const },
];

describe('CommunityRail reordenar', () => {
  it('Alt+Seta move a comunidade', () => {
    const onReorder = vi.fn();
    render(<CommunityRail communities={communities} onSelect={vi.fn()} onCreate={vi.fn()} onJoin={vi.fn()} onReorder={onReorder} />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Gama' }), { key: 'ArrowUp', altKey: true });
    expect(onReorder).toHaveBeenCalledWith(['a', 'c', 'b']);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Alfa' }), { key: 'ArrowUp', altKey: true });
    expect(onReorder).toHaveBeenCalledTimes(1);
  });

  it('arrastar e soltar reordena', () => {
    const onReorder = vi.fn();
    render(<CommunityRail communities={communities} onSelect={vi.fn()} onCreate={vi.fn()} onJoin={vi.fn()} onReorder={onReorder} />);
    const items = screen.getAllByTestId('community-rail-item');
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent.dragStart(items[0]!, { dataTransfer });
    fireEvent.dragOver(items[2]!, { dataTransfer });
    fireEvent.drop(items[2]!, { dataTransfer });
    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
  });
});

describe('MemberList adicionar amigo', () => {
  const members: Member[] = [
    { userId: 'me', name: 'Eu', username: 'eu', role: 'OWNER' },
    { userId: 'x', name: 'Xavier', username: 'xavier', role: 'MEMBER' },
    { userId: 'y', name: 'Yara', username: 'yara', role: 'MEMBER' },
    { userId: 'z', name: 'Zeca', username: null, role: 'MEMBER' },
  ];
  it('mostra o botão só para quem não é amigo e tem @nome', async () => {
    const onAddFriend = vi.fn().mockResolvedValue(undefined);
    render(
      <MemberList
        members={members}
        friendStatus={(m) => (m.userId === 'me' ? 'self' : m.userId === 'y' ? 'friend' : 'none')}
        onAddFriend={onAddFriend}
      />,
    );
    expect(screen.queryByRole('button', { name: /Eu como amigo/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Yara/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Zeca/ })).toBeNull();
    expect(screen.getByText('Amigo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Xavier como amigo' }));
    expect(onAddFriend).toHaveBeenCalledWith(members[1]);
  });
});
