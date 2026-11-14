'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  COMMUNITY_EVENT_DESCRIPTION_MAX,
  COMMUNITY_EVENT_TITLE_MAX,
  communityEventInputSchema,
  countEventsSoon,
  isEventUpcoming,
  type CommunityEvent,
} from '@scale/shared';
import { AppModal } from '@/components/ui/AppModal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { api, type ApiError } from '@/lib/api';

/**
 * Fase 4: eventos agendados. Botao "Eventos" no cabecalho da comunidade (com
 * selo das proximas 24 h) e modal com a lista + formulario. Recarrega quando
 * `refreshKey` muda (o pai incrementa a cada `community:changed`).
 */
export interface EventChannel { id: string; name: string }

const fieldClass = 'mt-1 block w-full rounded-lg border border-line bg-surface-primary p-2 text-sm text-ink-primary';
const dateFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const timeFormat = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "sáb., 14 de nov. 20:00 até 22:00" (fim em outro dia mostra a data inteira). */
export function formatEventWhen(startsAt: string, endsAt: string | null): string {
  const start = new Date(startsAt);
  if (!endsAt) return dateFormat.format(start);
  const end = new Date(endsAt);
  const sameDay = start.toDateString() === end.toDateString();
  return `${dateFormat.format(start)} até ${sameDay ? timeFormat.format(end) : dateFormat.format(end)}`;
}

/** Date -> valor de `<input type="datetime-local">` no fuso local. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
const fromLocalInput = (value: string): string | null => {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};
const errorText = (error: unknown, fallback: string): string => {
  const api = error as Partial<ApiError> | null;
  if (api?.status === 429) return 'Muitas ações seguidas. Tente de novo em instantes.';
  if (api?.status === 400 && api.error && api.error !== 'Invalid input') return api.error;
  return fallback;
};

export function CommunityEventsButton({
  communityId,
  canManage,
  voiceChannels,
  refreshKey,
}: {
  communityId: string;
  canManage: boolean;
  voiceChannels: EventChannel[];
  refreshKey: number;
}) {
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [open, setOpen] = useState(false);
  const load = useCallback(async () => {
    try {
      setEvents((await api.listCommunityEvents(communityId)).events);
    } catch {
      /* selo e best effort; o modal mostra o erro ao recarregar */
    }
  }, [communityId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const soon = countEventsSoon(events);
  const label = soon ? `Eventos, ${soon} nas próximas 24 horas` : 'Eventos';
  return (
    <>
      <Tooltip label={label}>
        <button
          type="button"
          aria-label={label}
          onClick={() => setOpen(true)}
          className="relative rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
        >
          <Icon name="clock" />
          {soon > 0 && (
            <span
              data-testid="events-soon-badge"
              aria-hidden
              className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-brand-500 px-1 text-center text-[10px] font-semibold leading-4 text-white"
            >
              {soon > 9 ? '9+' : soon}
            </span>
          )}
        </button>
      </Tooltip>
      {open && (
        <CommunityEventsDialog
          communityId={communityId}
          canManage={canManage}
          voiceChannels={voiceChannels}
          events={events}
          reload={load}
          onChange={setEvents}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

interface FormState { title: string; description: string; start: string; end: string; channelId: string }
const emptyForm: FormState = { title: '', description: '', start: '', end: '', channelId: '' };

export function CommunityEventsDialog({
  communityId,
  canManage,
  voiceChannels,
  events,
  reload,
  onChange,
  onClose,
}: {
  communityId: string;
  canManage: boolean;
  voiceChannels: EventChannel[];
  events: CommunityEvent[];
  reload: () => Promise<void>;
  onChange: (events: CommunityEvent[]) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upcoming = events.filter((event) => isEventUpcoming(event));

  async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      await action();
      await reload();
      return true;
    } catch (caught) {
      setError(errorText(caught, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const startsAt = fromLocalInput(form.start);
    if (!startsAt) { setError('Informe a data e a hora de início.'); return; }
    const parsed = communityEventInputSchema.safeParse({
      title: form.title, description: form.description, startsAt,
      endsAt: fromLocalInput(form.end), channelId: form.channelId || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.path[0] === 'endsAt' ? 'O fim precisa ser depois do início.' : 'Confira o título e as datas.');
      return;
    }
    const input = parsed.data;
    const id = editing;
    const ok = await run(
      () => (id ? api.updateCommunityEvent(id, input) : api.createCommunityEvent(communityId, input)),
      id ? 'Não foi possível salvar o evento.' : 'Não foi possível criar o evento.',
    );
    if (ok) { setForm(emptyForm); setEditing(null); }
  }

  async function toggleInterest(target: CommunityEvent) {
    const next = !target.interested;
    // Otimista; o servidor devolve a contagem real.
    onChange(events.map((e) => (e.id === target.id ? { ...e, interested: next, interestedCount: Math.max(0, e.interestedCount + (next ? 1 : -1)) } : e)));
    try {
      const result = await api.setCommunityEventInterest(target.id, next);
      onChange(events.map((e) => (e.id === target.id ? { ...e, interested: result.interested, interestedCount: result.interestedCount } : e)));
    } catch (caught) {
      onChange(events);
      setError(errorText(caught, 'Não foi possível marcar interesse.'));
    }
  }

  return (
    <AppModal title="Eventos" icon="clock" onClose={onClose} closeLabel="Fechar eventos" size="lg" locked={busy}>
      {error && <p role="alert" className="mb-3 text-sm text-red-400">{error}</p>}
      <section aria-labelledby="events-upcoming-heading">
        <h3 id="events-upcoming-heading" className="mb-2 font-semibold">Próximos eventos</h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-ink-muted">Nenhum evento agendado.</p>
        ) : (
          <ul className="space-y-3">
            {upcoming.map((event) => (
              <li key={event.id} className="rounded-xl border border-line p-3" aria-label={event.title}>
                <p className="font-medium text-ink-primary">{event.title}</p>
                <p className="text-sm text-ink-muted">{formatEventWhen(event.startsAt, event.endsAt)}</p>
                {event.channelName && (
                  <p className="flex items-center gap-1 text-sm text-ink-muted">
                    <Icon name="speaker" size={14} />
                    {event.channelName}
                  </p>
                )}
                {event.description && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-primary">{event.description}</p>}
                <p className="mt-1 text-xs text-ink-muted">Criado por {event.creatorName}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={event.interested ? 'primary' : 'secondary'}
                    aria-pressed={event.interested}
                    onClick={() => void toggleInterest(event)}
                  >
                    {event.interested && <Icon name="check" size={14} />}
                    Tenho interesse
                  </Button>
                  <span className="text-sm text-ink-muted" data-testid="event-interest-count">
                    {event.interestedCount === 1 ? '1 interessado' : `${event.interestedCount} interessados`}
                  </span>
                  {canManage && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Editar ${event.title}`}
                        onClick={() => {
                          setEditing(event.id);
                          setConfirming(null);
                          setForm({
                            title: event.title, description: event.description ?? '', start: toLocalInput(event.startsAt),
                            end: toLocalInput(event.endsAt), channelId: event.channelId ?? '',
                          });
                        }}
                      >
                        Editar
                      </Button>
                      {confirming === event.id ? (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => void run(() => api.cancelCommunityEvent(event.id), 'Não foi possível cancelar o evento.').then(() => setConfirming(null))}
                        >
                          Confirmar cancelamento
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={busy} aria-label={`Cancelar ${event.title}`} onClick={() => setConfirming(event.id)}>
                          Cancelar evento
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canManage && (
        <form onSubmit={(e) => void submit(e)} className="mt-6 space-y-3 border-t border-line pt-4" aria-labelledby="events-form-heading">
          <h3 id="events-form-heading" className="font-semibold">{editing ? 'Editar evento' : 'Novo evento'}</h3>
          <label className="block text-sm">
            Título
            <input className={fieldClass} required maxLength={COMMUNITY_EVENT_TITLE_MAX} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </label>
          <label className="block text-sm">
            Descrição (opcional)
            <textarea className={fieldClass} rows={3} maxLength={COMMUNITY_EVENT_DESCRIPTION_MAX} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Início
              <input type="datetime-local" className={fieldClass} required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            </label>
            <label className="block text-sm">
              Fim (opcional)
              <input type="datetime-local" className={fieldClass} value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
            </label>
          </div>
          <label className="block text-sm">
            Canal de voz (opcional)
            <select className={fieldClass} value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })}>
              <option value="">Nenhum</option>
              {voiceChannels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
          </label>
          <div className="flex justify-end gap-2">
            {editing && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => { setEditing(null); setForm(emptyForm); }}>
                Descartar edição
              </Button>
            )}
            <Button type="submit" disabled={busy}>{editing ? 'Salvar evento' : 'Criar evento'}</Button>
          </div>
        </form>
      )}
    </AppModal>
  );
}
