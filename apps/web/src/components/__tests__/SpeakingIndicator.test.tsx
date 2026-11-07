import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ParticipantList } from '@/components/room/ParticipantList';
import { RoomControls } from '@/components/room/RoomControls';
import { SpeakingBars } from '@/components/room/SpeakingBars';
import { LOCAL_ID } from '@/components/room/VideoGrid';

const noop = vi.fn();

function controls(props: Partial<Parameters<typeof RoomControls>[0]> = {}) {
  return render(
    <RoomControls
      isMuted={false}
      isDeafened={false}
      isScreenSharing={false}
      onToggleMute={noop}
      onToggleDeafen={noop}
      onToggleScreenShare={noop}
      onLeave={noop}
      {...props}
    />,
  );
}

describe('indicador de quem está falando', () => {
  it('barrinhas animam só quando ativas e respeitam motion-reduce', () => {
    const { rerender } = render(<SpeakingBars active />);
    const bars = screen.getByTestId('speaking-bars');
    expect(bars.dataset.active).toBe('true');
    expect(bars.getAttribute('aria-hidden')).toBe('true');
    const first = bars.firstElementChild as HTMLElement;
    expect(first.className).toContain('animate-eq-bar');
    expect(first.className).toContain('motion-reduce:animate-none');

    rerender(<SpeakingBars active={false} />);
    expect(screen.getByTestId('speaking-bars').dataset.active).toBe('false');
    expect((screen.getByTestId('speaking-bars').firstElementChild as HTMLElement).className).not.toContain(
      'animate-eq-bar',
    );
  });

  it('lista lateral: halo pulsante, barrinhas e "falando" para leitor de tela', () => {
    render(
      <ParticipantList peers={new Map()} localName="Gabriel" localMuted={false} localScreenSharing={false} speaking={new Set([LOCAL_ID])} />,
    );
    expect(screen.getByText(', falando')).toBeTruthy();
    expect(screen.getByTestId('speaking-bars')).toBeTruthy();
    expect(document.querySelector('.animate-speak-pulse')).not.toBeNull();
  });

  it('lista lateral: quem não fala fica sem halo nem barrinhas', () => {
    render(<ParticipantList peers={new Map()} localName="Gabriel" localMuted={false} localScreenSharing={false} speaking={new Set()} />);
    expect(screen.queryByText(', falando')).toBeNull();
    expect(screen.queryByTestId('speaking-bars')).toBeNull();
    expect(document.querySelector('.animate-speak-pulse')).toBeNull();
  });

  it('botão do microfone acende quando a sua voz é captada', () => {
    controls({ isSpeaking: true });
    const mic = screen.getByRole('button', { name: 'Desativar microfone' });
    expect(mic.className).toContain('animate-speak-pulse');
    expect(screen.getByTestId('speaking-bars')).toBeTruthy();
  });

  it('avisa "Você está mudo" quando fala com o microfone desligado', () => {
    const { rerender } = render(
      <RoomControls
        isMuted
        talkingWhileMuted
        isDeafened={false}
        isScreenSharing={false}
        onToggleMute={noop}
        onToggleDeafen={noop}
        onToggleScreenShare={noop}
        onLeave={noop}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe('Você está mudo');
    rerender(
      <RoomControls
        isMuted
        isDeafened={false}
        isScreenSharing={false}
        onToggleMute={noop}
        onToggleDeafen={noop}
        onToggleScreenShare={noop}
        onLeave={noop}
      />,
    );
    expect(screen.queryByText('Você está mudo')).toBeNull();
  });
});
