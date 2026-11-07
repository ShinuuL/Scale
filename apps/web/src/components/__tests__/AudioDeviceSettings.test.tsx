import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AudioDeviceSettings } from '../room/AudioDeviceSettings';
import type { AudioDevicesState } from '@/hooks/useAudioDevices';

function devices(): AudioDevicesState {
  return { inputs: [], outputs: [], microphoneId: '', outputId: '', canSelectOutput: false,
    canRequestOutput: false, error: null, notice: null, selectInput: vi.fn().mockResolvedValue(undefined),
    selectOutput: vi.fn().mockResolvedValue(undefined), requestOutput: vi.fn().mockResolvedValue(undefined), reportOutputError: vi.fn() };
}

describe('configurações de áudio', () => {
  it('permite tentar microfone novamente quando só existe a opção padrão selecionada', () => {
    const state = devices();
    render(<AudioDeviceSettings devices={state} busy={false} />);
    fireEvent.click(screen.getByText('Dispositivos', { exact: true }));
    const select = screen.getByLabelText('Microfone');
    expect(select).toHaveValue('');
    expect(select.querySelectorAll('option')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Tentar microfone novamente' }));
    expect(state.selectInput).toHaveBeenCalledWith('');
    expect(screen.getByLabelText('Saída de áudio')).toBeDisabled();
    expect(screen.getByText(/Este navegador usa a saída padrão/)).toBeVisible();
  });

  it('desabilita repetição da captura enquanto o pedido está em andamento', () => {
    render(<AudioDeviceSettings devices={devices()} busy />);
    fireEvent.click(screen.getByText('Dispositivos', { exact: true }));
    expect(screen.getByRole('button', { name: 'Tentar microfone novamente' })).toBeDisabled();
    expect(screen.getByLabelText('Microfone')).toBeDisabled();
    expect(screen.getByText('Conectando microfone…')).toBeVisible();
  });
});
