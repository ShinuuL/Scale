import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { countEventsSoon, isEventUpcoming, type CommunityEvent } from '@scale/shared';
import { CommunityEventsButton, toLocalInput } from '../CommunityEvents';
import { api } from '@/lib/api';

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
function event(extra: Partial<CommunityEvent>): CommunityEvent {
  return {
    id: 'e1', communityId: 'c1', title: 'Noite de jogos', description: null, startsAt: hours(2), endsAt: null,
    channelId: VOICE_ID, channelName: 'Sala de voz', creatorName: 'Ana', interestedCount: 0, interested: false, ...extra,
  };
}
const VOICE_ID = '11111111-1111-4111-8111-111111111111';
const voice = [{ id: VOICE_ID, name: 'Sala de voz' }];

describe('Fase 4: eventos agendados', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('helpers: proximos e contagem das proximas 24 h', () => {
    const now = Date.now();
    expect(isEventUpcoming({ startsAt: hours(-1), endsAt: hours(1) }, now)).toBe(true);
    expect(isEventUpcoming({ startsAt: hours(-1), endsAt: null }, now)).toBe(false);
    expect(countEventsSoon([{ startsAt: hours(2), endsAt: null }, { startsAt: hours(30), endsAt: null }, { startsAt: hours(-1), endsAt: hours(1) }], now)).toBe(2);
    expect(toLocalInput(null)).toBe('');
    expect(toLocalInput(new Date(2026, 10, 14, 9, 5).toISOString())).toBe('2026-11-14T09:05');
  });

  it('mostra o selo, lista e marca interesse', async () => {
    vi.spyOn(api, 'listCommunityEvents').mockResolvedValue({ events: [event({}), event({ id: 'e2', title: 'Depois', startsAt: hours(48) })] });
    const interest = vi.spyOn(api, 'setCommunityEventInterest').mockResolvedValue({ interested: true, interestedCount: 1 });
    render(<CommunityEventsButton communityId="c1" canManage={false} voiceChannels={voice} refreshKey={0} />);
    expect(await screen.findByTestId('events-soon-badge')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'Eventos, 1 nas próximas 24 horas' }));
    const item = await screen.findByRole('listitem', { name: 'Noite de jogos' });
    expect(within(item).getByText('Sala de voz')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Criar evento' })).not.toBeInTheDocument();
    fireEvent.click(within(item).getByRole('button', { name: 'Tenho interesse' }));
    await waitFor(() => expect(interest).toHaveBeenCalledWith('e1', true));
    await waitFor(() => expect(within(item).getByTestId('event-interest-count')).toHaveTextContent('1 interessado'));
    expect(within(item).getByRole('button', { name: 'Tenho interesse' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('gestor cria, recarrega e cancela com confirmacao', async () => {
    const list = vi.spyOn(api, 'listCommunityEvents').mockResolvedValue({ events: [] });
    const create = vi.spyOn(api, 'createCommunityEvent').mockResolvedValue();
    const cancel = vi.spyOn(api, 'cancelCommunityEvent').mockResolvedValue();
    render(<CommunityEventsButton communityId="c1" canManage voiceChannels={voice} refreshKey={0} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('events-soon-badge')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eventos' }));
    expect(await screen.findByText('Nenhum evento agendado.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Torneio' } });
    fireEvent.change(screen.getByLabelText('Início'), { target: { value: toLocalInput(hours(5)) } });
    fireEvent.change(screen.getByLabelText('Fim (opcional)'), { target: { value: toLocalInput(hours(4)) } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar evento' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('O fim precisa ser depois do início.');
    fireEvent.change(screen.getByLabelText('Fim (opcional)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Canal de voz (opcional)'), { target: { value: VOICE_ID } });
    list.mockResolvedValue({ events: [event({ title: 'Torneio' })] });
    fireEvent.click(screen.getByRole('button', { name: 'Criar evento' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('c1', expect.objectContaining({ title: 'Torneio', channelId: VOICE_ID, endsAt: null })));
    const item = await screen.findByRole('listitem', { name: 'Torneio' });
    fireEvent.click(within(item).getByRole('button', { name: 'Cancelar Torneio' }));
    fireEvent.click(within(item).getByRole('button', { name: 'Confirmar cancelamento' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('e1'));
  });

  it('refreshKey novo (community:changed) recarrega a lista', async () => {
    const list = vi.spyOn(api, 'listCommunityEvents').mockResolvedValue({ events: [] });
    const { rerender } = render(<CommunityEventsButton communityId="c1" canManage={false} voiceChannels={voice} refreshKey={0} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    rerender(<CommunityEventsButton communityId="c1" canManage={false} voiceChannels={voice} refreshKey={1} />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});
