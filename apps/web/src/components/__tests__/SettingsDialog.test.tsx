import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SettingsDialog } from '@/components/ui/SettingsDialog';

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    writable: true,
    value: {
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'audioinput', deviceId: 'mic-1', label: '', groupId: '' },
        { kind: 'audiooutput', deviceId: 'out-1', label: '', groupId: '' },
      ]),
      getUserMedia: vi.fn().mockRejectedValue(new Error('NotAllowedError')),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
});

afterEach(() => {
  delete (HTMLMediaElement.prototype as { setSinkId?: unknown }).setSinkId;
});

describe('SettingsDialog: seção Áudio', () => {
  it('inclui os seletores de áudio no ciclo de foco e restaura o gatilho ao fechar', async () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: vi.fn(), configurable: true });
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = render(<SettingsDialog user={null} onClose={onClose} />);
    await screen.findByRole('button', { name: /Permitir acesso ao microfone/ });
    const close = screen.getByRole('button', { name: 'Fechar configurações' });
    const speaker = screen.getByLabelText('Saída de áudio');
    // Escape funciona também a partir dos seletores; Shift+Tab mantém o foco no diálogo.
    const mic = screen.getByLabelText('Microfone');
    mic.focus();
    fireEvent.keyDown(mic, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(speaker).toBeInTheDocument();
    close.focus();
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).not.toBe(close);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('convidado vê Áudio com selects rotulados e o botão de permissão', async () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: vi.fn(), configurable: true });
    render(<SettingsDialog user={null} onClose={() => {}} />);
    expect(await screen.findByRole('button', { name: /Permitir acesso ao microfone/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Áudio' })).toBeInTheDocument();
    expect(screen.getByLabelText('Microfone')).toBeInTheDocument();
    expect(screen.getByLabelText('Saída de áudio')).toBeInTheDocument();
  });

  it('sem setSinkId esconde a saída e explica', async () => {
    render(<SettingsDialog user={null} onClose={() => {}} />);
    await screen.findByRole('button', { name: /Permitir acesso ao microfone/ });
    expect(screen.queryByLabelText('Saída de áudio')).toBeNull();
    expect(screen.getByText(/Seu navegador não permite escolher a saída de áudio/)).toBeInTheDocument();
  });
});
