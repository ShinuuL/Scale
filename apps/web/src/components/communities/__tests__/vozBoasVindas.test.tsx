import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { formatVoiceCount, isVoiceChannelFull, renderWelcomeMessage } from '@scale/shared';
import { ChannelList } from '../CommunityParts';
import { ChannelChat } from '../ChannelChat';
import { VoiceLimitSelect, WelcomeSection } from '../CommunityWelcome';
import { api, type ChannelMessage } from '@/lib/api';
import { useChannelMessages } from '@/hooks/useChannelMessages';

const voice = { id: 'v1', name: 'Sala de voz', kind: 'VOICE' as const, position: 1, userLimit: 2 };
const text = { id: 't1', name: 'geral', kind: 'TEXT' as const, position: 0 };
const members = (count: number) => Array.from({ length: count }, (_, i) => ({ userId: `u${i}`, name: `P${i}`, muted: false, deafened: false, screenSharing: false }));

function renderList(count: number, extra: Partial<Parameters<typeof ChannelList>[0]> = {}) {
  const onSelect = vi.fn();
  render(
    <ChannelList
      name="Comunidade"
      channels={[text, voice]}
      selected="t1"
      voiceStates={[{ channelId: 'v1', members: members(count) }]}
      onSelect={onSelect}
      onInvite={() => undefined}
      onSettings={() => undefined}
      canManage={false}
      {...extra}
    />,
  );
  return onSelect;
}

function message(extra: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: 'm1', channelId: 'canal', author: { id: 'me', name: 'Ana', username: null }, content: 'Oi',
    createdAt: new Date().toISOString(), editedAt: null, deletedAt: null, files: [], replyTo: null,
    reactions: [], pinnedAt: null, pinnedById: null, ...extra,
  };
}
function Harness({ canManage = false }: { canManage?: boolean }) {
  const { state, dispatch } = useChannelMessages('canal');
  return <ChannelChat channelId="canal" name="geral" meId="me" canManage={canManage} state={state} dispatch={dispatch} />;
}

describe('Fase 3: limite do canal de voz', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('helpers do limite', () => {
    expect(formatVoiceCount(3, 4)).toBe('3/4');
    expect(formatVoiceCount(3, null)).toBeNull();
    expect(isVoiceChannelFull(4, 4)).toBe(true);
    expect(isVoiceChannelFull(7, null)).toBe(false);
    expect(isVoiceChannelFull(8, null)).toBe(true);
  });

  it('mostra a contagem e permite entrar com vaga', () => {
    const onSelect = renderList(1);
    expect(screen.getByTestId('voice-count')).toHaveTextContent('1/2');
    fireEvent.click(screen.getByRole('button', { name: 'Entrar no canal de voz Sala de voz, 1 de 2 pessoas' }));
    expect(onSelect).toHaveBeenCalled();
  });

  it('canal cheio aparece como cheio e nao entra', () => {
    const onSelect = renderList(2);
    expect(screen.getByTestId('voice-count')).toHaveTextContent('Cheio 2/2');
    const button = screen.getByRole('button', { name: 'Canal de voz Sala de voz cheio, 2 de 2 pessoas' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('quem ja esta no canal nao e barrado pelo limite', () => {
    renderList(2, { activeVoiceId: 'v1', activeVoiceJoined: true });
    expect(screen.getByRole('button', { name: 'Sala de voz, conectado, 2 de 2 pessoas' })).toHaveTextContent('Conectado 2/2');
  });

  it('seletor grava o limite (e Sem limite = null)', async () => {
    const save = vi.spyOn(api, 'setChannelUserLimit').mockResolvedValue();
    const run = vi.fn(async (action: () => Promise<unknown>) => { await action(); return true; });
    render(<VoiceLimitSelect channel={voice} run={run} />);
    const select = screen.getByLabelText('Limite de pessoas do canal Sala de voz');
    expect(select).toHaveValue('2');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Sem limite', '2 pessoas', '3 pessoas', '4 pessoas', '5 pessoas', '6 pessoas', '7 pessoas', '8 pessoas']);
    fireEvent.change(select, { target: { value: '4' } });
    fireEvent.change(select, { target: { value: '' } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save).toHaveBeenNthCalledWith(1, 'v1', 4);
    expect(save).toHaveBeenNthCalledWith(2, 'v1', null);
  });
});

describe('Fase 3: boas-vindas', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('modelo troca todas as ocorrencias de {nome}', () => {
    expect(renderWelcomeMessage('Oi {nome}! Tchau {nome}.', 'Ana')).toBe('Oi Ana! Tchau Ana.');
  });

  it('secao lista so canais de texto, mostra previa e salva', async () => {
    const save = vi.spyOn(api, 'setCommunityWelcome').mockResolvedValue();
    const run = vi.fn(async (action: () => Promise<unknown>) => { await action(); return true; });
    render(<WelcomeSection communityId="c1" channels={[text, voice]} welcome={null} run={run} />);
    const select = screen.getByLabelText('Canal de boas-vindas');
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Nenhum (desligado)', 'geral']);
    fireEvent.change(select, { target: { value: 't1' } });
    fireEvent.change(screen.getByLabelText('Mensagem de boas-vindas'), { target: { value: ' Olá, {nome}! ' } });
    expect(screen.getByTestId('welcome-preview')).toHaveTextContent('Prévia: Olá, Ana!');
    fireEvent.click(screen.getByRole('button', { name: 'Salvar boas-vindas' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('c1', { channelId: 't1', message: 'Olá, {nome}!' }));
  });

  it('mensagem de sistema tem estilo proprio e nao tem editar/apagar do autor', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({
      messages: [message({ id: 's1', system: true, author: { id: null, name: 'Sistema', username: null }, content: 'Boas-vindas, Ana!' })],
      nextCursor: null,
    });
    render(<Harness />);
    const item = await screen.findByTestId('system-message');
    expect(item).toHaveTextContent('Boas-vindas, Ana!');
    expect(item).toHaveAccessibleName('Mensagem do sistema');
    expect(screen.queryByRole('button', { name: /Editar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Apagar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Responder/ })).toBeNull();
  });

  it('moderador ainda pode apagar a mensagem de sistema', async () => {
    vi.spyOn(api, 'getChannelMessages').mockResolvedValue({
      messages: [message({ id: 's1', system: true, author: { id: null, name: 'Sistema', username: null }, content: 'Boas-vindas, Ana!' })],
      nextCursor: null,
    });
    render(<Harness canManage />);
    expect(await screen.findByRole('button', { name: 'Apagar mensagem do sistema' })).toBeInTheDocument();
  });
});
