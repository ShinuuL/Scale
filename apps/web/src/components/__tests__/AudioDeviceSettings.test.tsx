import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AudioDeviceSettings } from '../room/AudioDeviceSettings';
import type { AudioDevicesState } from '@/hooks/useAudioDevices';

function devices(): AudioDevicesState {
  return {
    inputs: [],
    outputs: [],
    microphoneId: '',
    outputId: '',
    canSelectOutput: false,
    canRequestOutput: false,
    error: null,
    notice: null,
    selectInput: vi.fn().mockResolvedValue(undefined),
    selectOutput: vi.fn().mockResolvedValue(undefined),
    requestOutput: vi.fn().mockResolvedValue(undefined),
    reportOutputError: vi.fn(),
  };
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
  it('Escape fecha o painel aberto e devolve o foco ao summary', () => {
    render(<AudioDeviceSettings devices={devices()} busy={false} />);
    const summary = screen.getByLabelText('Dispositivos de áudio');
    fireEvent.click(summary);
    const details = summary.closest('details');
    expect(details).toHaveAttribute('open');
    const microphone = screen.getByLabelText('Microfone');
    microphone.focus();
    fireEvent.keyDown(microphone, { key: 'Escape' });
    expect(details).not.toHaveAttribute('open');
    expect(summary).toHaveFocus();
  });

  it('clique externo fecha o painel sem impedir a ação do outro controle', () => {
    const openChat = vi.fn();
    render(
      <>
        <AudioDeviceSettings devices={devices()} busy={false} />
        <button type="button" onClick={openChat}>
          Abrir chat
        </button>
      </>,
    );
    const summary = screen.getByLabelText('Dispositivos de áudio');
    fireEvent.click(summary);
    const chat = screen.getByRole('button', { name: 'Abrir chat' });
    fireEvent.pointerDown(chat);
    expect(summary.closest('details')).not.toHaveAttribute('open');
    chat.focus();
    fireEvent.click(chat);
    expect(openChat).toHaveBeenCalledOnce();
    expect(chat).toHaveFocus();
  });

  it('interação interna preserva seleção e autorização; Escape atua só no painel com foco', () => {
    const state = { ...devices(), canSelectOutput: true, canRequestOutput: true };
    render(
      <>
        <AudioDeviceSettings devices={state} busy={false} />
        <AudioDeviceSettings devices={devices()} busy={false} />
      </>,
    );
    const summaries = screen.getAllByLabelText('Dispositivos de áudio');
    summaries.forEach((summary) => fireEvent.click(summary));
    const authorize = screen.getByRole('button', { name: 'Autorizar outra saída' });
    fireEvent.pointerDown(authorize);
    fireEvent.click(authorize);
    expect(state.requestOutput).toHaveBeenCalledOnce();
    expect(summaries[0].closest('details')).toHaveAttribute('open');
    // Reabre o segundo painel para verificar que Escape não o fecha por engano.
    fireEvent.click(summaries[1]);
    const microphone = screen.getAllByLabelText('Microfone')[0];
    microphone.focus();
    fireEvent.keyDown(microphone, { key: 'Escape' });
    expect(summaries[0].closest('details')).not.toHaveAttribute('open');
    expect(summaries[1].closest('details')).toHaveAttribute('open');
    expect(summaries[0]).toHaveFocus();
  });
});
