import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getSavedDeviceId } from '@/lib/audioDevices';
import { isBluetoothCallMic } from '@/components/ui/AudioSettings';
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
    expect(screen.queryByRole('button', { name: /Saída de áudio/ })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Saída de áudio' })).toHaveTextContent('Padrão do sistema');
    expect(screen.getByText(/o sistema alterna entre alto-falante e fone/)).toBeInTheDocument();
  });

  it('Android (só a saída padrão, com permissão) mostra a saída só leitura', async () => {
    Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: vi.fn(), configurable: true });
    (navigator.mediaDevices.enumerateDevices as ReturnType<typeof vi.fn>).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Microfone', groupId: '' },
      { kind: 'audiooutput', deviceId: 'default', label: 'Padrão', groupId: '' },
    ]);
    render(<SettingsDialog user={null} onClose={() => {}} />);
    expect(await screen.findByRole('textbox', { name: 'Saída de áudio' })).toHaveTextContent('Padrão do sistema');
  });

  it('padrão aparece como "Padrão do sistema", nunca "Nenhum aparelho"', async () => {
    render(<SettingsDialog user={null} onClose={() => {}} />);
    const mic = await screen.findByRole('button', { name: /Microfone/ });
    await waitFor(() => expect(mic).toHaveTextContent('Padrão do sistema'));
    expect(screen.queryByText('Nenhum aparelho')).toBeNull();
  });

  it('sem nomes (antes da permissão) mantém a escolha salva', async () => {
    window.localStorage.setItem('scale.audio.input', 'mic-salvo');
    render(<SettingsDialog user={null} onClose={() => {}} />);
    await screen.findByRole('button', { name: /Permitir acesso ao microfone/ });
    expect(getSavedDeviceId('input')).toBe('mic-salvo');
  });

  it('escolher "Padrão do sistema" salva string vazia', async () => {
    (navigator.mediaDevices.enumerateDevices as ReturnType<typeof vi.fn>).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Headset', groupId: '' },
    ]);
    window.localStorage.setItem('scale.audio.input', 'mic-1');
    render(<SettingsDialog user={null} onClose={() => {}} />);
    const mic = await screen.findByRole('button', { name: /Microfone/ });
    await waitFor(() => expect(mic).toHaveTextContent('Headset'));
    fireEvent.click(mic);
    fireEvent.click(await screen.findByRole('option', { name: 'Padrão do sistema' }));
    expect(getSavedDeviceId('input')).toBe('');
  });

  it('escolher o microfone na lista salva o aparelho', async () => {
    (navigator.mediaDevices.enumerateDevices as ReturnType<typeof vi.fn>).mockResolvedValue([
      { kind: 'audioinput', deviceId: 'mic-1', label: 'Headset', groupId: '' },
      { kind: 'audioinput', deviceId: 'mic-2', label: 'Webcam', groupId: '' },
    ]);
    render(<SettingsDialog user={null} onClose={() => {}} />);
    const mic = await screen.findByRole('button', { name: /Microfone/ });
    fireEvent.click(mic);
    fireEvent.click(await screen.findByRole('option', { name: 'Webcam' }));
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
