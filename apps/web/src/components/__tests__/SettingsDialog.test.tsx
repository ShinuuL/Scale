import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSavedDeviceId } from '@/lib/audioDevices';
import { isBluetoothCallMic } from '@/components/ui/AudioSettings';
import { RouterProvider } from 'react-aria-components';
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
    // react-aria devolve o foco no frame seguinte.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
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

  it('escolher o microfone na lista salva o aparelho', async () => {
    (navigator.mediaDevices.enumerateDevices as ReturnType<typeof vi.fn>).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Headset', groupId: '' },
      { kind: 'audioinput', deviceId: 'mic-2', label: 'Webcam', groupId: '' },
    ]);
    render(<SettingsDialog user={null} onClose={() => {}} />);
    await screen.findByRole('button', { name: /Microfone/ });
    // A lista de aparelhos chega assincrona: em maquina lenta (CI) o clique
    // pode abrir o seletor antes dela. Reabre ate a opcao aparecer.
    const webcam = await waitFor(
      () => {
        if (!screen.queryByRole('listbox')) fireEvent.click(screen.getByRole('button', { name: /Microfone/ }));
        return screen.getByRole('option', { name: 'Webcam' });
      },
      { timeout: 5000 },
    );
    fireEvent.click(webcam);
    expect(getSavedDeviceId('input')).toBe('mic-2');
    expect(screen.queryByRole('listbox')).toBeNull();
    // A lista fechou, o diálogo continua aberto.
    expect(screen.getByRole('dialog', { name: 'Configurações' })).toBeInTheDocument();
  });

  it('avisa quando o microfone escolhido é de fone Bluetooth em modo chamada', async () => {
    (navigator.mediaDevices.enumerateDevices as ReturnType<typeof vi.fn>).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'bt', label: 'Fone de ouvido (WH-1000XM4 Hands-Free AG Audio)', groupId: '' },
      { kind: 'audioinput', deviceId: 'mic', label: 'Microfone (Realtek)', groupId: '' },
    ]);
    window.localStorage.clear();
    render(<SettingsDialog user={null} onClose={() => {}} />);
    const mic = await screen.findByRole('button', { name: /Microfone/ });
    fireEvent.click(mic);
    fireEvent.click(await screen.findByRole('option', { name: /Hands-Free/ }));
    expect(await screen.findByRole('note')).toHaveTextContent('fone sem fio deixa o som metálico');

    fireEvent.click(screen.getByRole('button', { name: /Microfone/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Microfone (Realtek)' }));
    expect(screen.queryByRole('note')).toBeNull();
  });
});

describe('isBluetoothCallMic', () => {
  it('reconhece o modo chamada pelo nome do aparelho', () => {
    expect(isBluetoothCallMic('Headset (Galaxy Buds Hands-Free AG Audio)')).toBe(true);
    expect(isBluetoothCallMic('Microfone Bluetooth')).toBe(true);
    expect(isBluetoothCallMic('Microfone (Realtek High Definition Audio)')).toBe(false);
    expect(isBluetoothCallMic(undefined)).toBe(false);
  });
});

describe('SettingsDialog: seção Administração', () => {
  const base = { id: 'ana', name: 'Ana', email: 'ana@example.test', createdAt: '2026-11-06T10:00:00.000Z' };

  it('aparece só para admin, com os três links, e fecha o diálogo ao navegar', async () => {
    const onClose = vi.fn();
    const navigate = vi.fn();
    // Mesmo papel do AriaRouter: o link navega pelo roteador, sem recarregar.
    const { unmount } = render(
      <RouterProvider navigate={navigate}>
        <SettingsDialog user={{ ...base, isAdmin: true }} onClose={onClose} />
      </RouterProvider>,
    );
    const moderation = await screen.findByRole('link', { name: 'Moderação' });
    expect(moderation).toHaveAttribute('href', '/admin/moderation');
    expect(screen.getByRole('link', { name: 'Métricas' })).toHaveAttribute('href', '/metrics');
    expect(screen.getByRole('link', { name: 'Administradores' })).toHaveAttribute('href', '/admin/users');
    fireEvent.click(screen.getByRole('link', { name: 'Administradores' }));
    expect(onClose).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/admin/users', undefined);
    unmount();
  });

  it('não aparece para conta comum nem convidado', async () => {
    const { unmount } = render(<SettingsDialog user={{ ...base, isAdmin: false }} onClose={vi.fn()} />);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('heading', { name: 'Administração' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Administradores' })).not.toBeInTheDocument();
    unmount();
    render(<SettingsDialog user={null} onClose={vi.fn()} />);
    await screen.findByRole('dialog');
    expect(screen.queryByRole('link', { name: 'Moderação' })).not.toBeInTheDocument();
  });
});
