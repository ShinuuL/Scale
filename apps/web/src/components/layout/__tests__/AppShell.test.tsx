import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppShell } from '../AppShell';

vi.mock('next/link', () => ({ default: ({ onClick, ...props }: ComponentProps<'a'>) => <a {...props} onClick={(event) => { onClick?.(event); event.preventDefault(); }} /> }));

function mockViewport(compact: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: compact, addEventListener: vi.fn(), removeEventListener: vi.fn() });
}

beforeEach(() => {
  mockViewport(false);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
});

describe('AppShell navigation and context', () => {
  it('allows the route to block leaving without blocking a new-tab action', () => {
    const guard = vi.fn().mockReturnValue(false);
    render(<AppShell activeSection="room" onNavigate={guard}>Chamada</AppShell>);
    const link = screen.getByRole('link', { name: 'Amigos' });
    const regularClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    fireEvent(link, regularClick);
    expect(guard).toHaveBeenCalledWith('/friends');
    expect(regularClick.defaultPrevented).toBe(true);
    guard.mockClear();
    fireEvent.click(link, { ctrlKey: true });
    expect(guard).not.toHaveBeenCalled();
  });

  it('mounts the compact context once, only when opened, and closes after selection', async () => {
    mockViewport(true);
    const select = vi.fn();
    render(<AppShell activeSection="friends" contextSidebar={<button id="unique-context" onClick={select}>Conversa da equipe</button>}>Mensagens</AppShell>);
    expect(screen.queryByRole('button', { name: 'Conversa da equipe' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abrir painel lateral' }));
    expect(await screen.findByRole('dialog', { name: 'Painel lateral' })).toBeInTheDocument();
    expect(document.querySelectorAll('#unique-context')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Conversa da equipe' }));
    expect(select).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('moves focus to the destination after the compact dialog closes', async () => {
    mockViewport(true);
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
    render(<AppShell activeSection="rooms" contextSidebar={<button data-context-focus-target="new-room">Criar uma sala</button>}><input id="new-room" aria-label="Nome da sala" /></AppShell>);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir painel lateral' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Criar uma sala' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Nome da sala' })));
    requestFrame.mockRestore();
  });

});
