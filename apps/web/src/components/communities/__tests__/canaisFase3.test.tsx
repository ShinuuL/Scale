import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChannelChat } from '../ChannelChat';
import { ChannelPermissionsForm, setOverride } from '../ChannelPermissionsForm';
import { secondsLeft } from '../slowMode';
import { api, type ChannelMessage } from '@/lib/api';
import { useChannelMessages } from '@/hooks/useChannelMessages';

function Harness(props: { canSend?: boolean; announcement?: boolean; slowModeSeconds?: number; slowModeExempt?: boolean }) {
  const { state, dispatch } = useChannelMessages('canal');
  return <ChannelChat channelId="canal" name="geral" meId="me" canManage={false} state={state} dispatch={dispatch} {...props} />;
}
const sent: ChannelMessage = {
  id: 'm1', channelId: 'canal', author: { id: 'me', name: 'Ana', username: null }, content: 'oi', createdAt: new Date().toISOString(),
  editedAt: null, deletedAt: null, files: [], replyTo: null, reactions: [], pinnedAt: null, pinnedById: null,
};

describe('Fase 3: canais', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({ messages: [], nextCursor: null });
  });

  it('secondsLeft arredonda para cima e nunca fica negativo', () => {
    expect(secondsLeft(10_500, 10_000)).toBe(1);
    expect(secondsLeft(5_000, 10_000)).toBe(0);
  });

  it('setOverride remove a sobrescrita que volta toda para herdar', () => {
    const one = setOverride([], 'everyone', 'viewChannel', false);
    expect(one).toEqual([{ target: 'everyone', viewChannel: false, sendMessages: null }]);
    expect(setOverride(one, 'everyone', 'viewChannel', null)).toEqual([]);
  });

  it('canal de avisos sem permissao de envio mostra aviso no lugar do compositor', async () => {
    render(<Harness canSend={false} announcement />);
    expect(await screen.findByText(/Canal de avisos: só quem gerencia/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Enviar' })).toBeNull();
  });

  it('modo lento: apos enviar, contagem regressiva bloqueia o botao', async () => {
    const send = vi.spyOn(api, 'sendChannelMessage').mockResolvedValue({ message: sent });
    render(<Harness slowModeSeconds={30} />);
    fireEvent.change(await screen.findByLabelText('Mensagem'), { target: { value: 'oi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(await screen.findByText(/Modo lento: aguarde 30 s/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Mensagem'), { target: { value: 'de novo' } });
    expect((screen.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('modo lento: 429 do servidor arma a contagem com os segundos restantes', async () => {
    vi.spyOn(api, 'sendChannelMessage').mockRejectedValue({ status: 429, error: 'Modo lento', retryAfterSeconds: 125 });
    render(<Harness slowModeSeconds={300} />);
    fireEvent.change(await screen.findByLabelText('Mensagem'), { target: { value: 'oi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    expect(await screen.findByText(/Modo lento: aguarde 2:05/)).toBeTruthy();
  });

  it('quem gerencia fica isento do modo lento', async () => {
    vi.spyOn(api, 'sendChannelMessage').mockResolvedValue({ message: sent });
    render(<Harness slowModeSeconds={30} slowModeExempt />);
    fireEvent.change(await screen.findByLabelText('Mensagem'), { target: { value: 'oi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar' }));
    await waitFor(() => expect(screen.queryByText(/Modo lento/)).toBeNull());
  });

  it('formulario grava aviso, modo lento e sobrescrita por cargo', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(
      <ChannelPermissionsForm
        channel={{ id: 'ch1', name: 'geral', kind: 'TEXT', position: 0 }}
        roles={[{ id: '5b0f6a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', name: 'VIP', color: '#123456', permissions: { manageChannels: false, manageInvites: false, manageMessages: false, kickMembers: false } }]}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Canal de avisos'));
    fireEvent.change(screen.getByLabelText('Modo lento'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('Ver canal: Todos os membros'), { target: { value: 'deny' } });
    fireEvent.change(screen.getByLabelText('Ver canal: VIP'), { target: { value: 'allow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar permissões' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      announcement: true,
      slowModeSeconds: 300,
      overrides: [
        { target: 'everyone', viewChannel: false, sendMessages: null },
        { target: '5b0f6a8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b', viewChannel: true, sendMessages: null },
      ],
    }));
  });
});
