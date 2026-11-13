import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ChannelList, MemberList, voiceMemberStatus, type Member } from '../CommunityParts';

const members: Member[] = [
  { userId: 'a', name: 'Ana', username: null, role: 'OWNER' },
  { userId: 'b', name: 'Bruno', username: null, role: 'MEMBER' },
  { userId: 'c', name: 'Caio', username: null, role: 'MEMBER' },
];

describe('presenca na lista de membros', () => {
  it('agrupa Online e Offline com ponto de status acessivel', () => {
    render(<MemberList members={members} isOnline={(member) => member.userId !== 'c'} />);
    expect(screen.getByRole('heading', { name: 'Online — 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Offline — 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opções de Caio, offline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opções de Ana, online' })).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'Online' })).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'Offline' })).toHaveLength(1);
  });

  it('sem presenca mantem os grupos por cargo', () => {
    render(<MemberList members={members} />);
    expect(screen.queryByRole('heading', { name: /Online/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Membros — 2' })).toBeInTheDocument();
  });
});

describe('indicadores do canal de voz', () => {
  it('mostra mudo, deafen, ao vivo e falando por membro', () => {
    render(
      <ChannelList
        name="Comunidade"
        channels={[{ id: 'v1', name: 'Voz', kind: 'VOICE', position: 0 }]}
        voiceStates={[
          {
            channelId: 'v1',
            members: [
              { userId: 'a', name: 'Ana', muted: false, deafened: false, screenSharing: true },
              { userId: 'b', name: 'Bruno', muted: true, deafened: true, screenSharing: false },
            ],
          },
        ]}
        speakingUserIds={new Set(['a', 'b'])}
        onSelect={() => undefined}
        onInvite={() => undefined}
        onSettings={() => undefined}
        canManage={false}
      />,
    );
    const list = screen.getByRole('list', { name: 'Conectados em Voz' });
    const [ana, bruno] = within(list).getAllByRole('listitem');
    expect(ana).toHaveTextContent('Ana, falando, ao vivo');
    expect(ana).toHaveTextContent('Ao vivo');
    expect(ana.querySelector('[data-speaking="true"]')).not.toBeNull();
    // Mudo nunca aparece falando.
    expect(bruno).toHaveTextContent('Bruno, microfone desligado, sem áudio');
    expect(bruno.querySelector('[data-speaking]')).toBeNull();
    expect(bruno.querySelectorAll('svg')).toHaveLength(2);
  });

  it('descreve estados combinados', () => {
    expect(voiceMemberStatus({ userId: 'x', name: 'X', muted: false, deafened: false, screenSharing: false }, false)).toEqual([]);
  });
});
