'use client';

import { useRef, useState, type FormEvent } from 'react';
import { MESSAGE_SEARCH_MAX, MESSAGE_SEARCH_MIN, splitHighlight, type MessageSearchHit } from '@scale/shared';
import { api } from '@/lib/api';
import { AppModal } from '@/components/ui/AppModal';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';

const timeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const SNIPPET = 160;

/** Recorta ~160 caracteres em volta da primeira ocorrencia (o destaque vem de splitHighlight). */
function snippetOf(content: string, q: string): string {
  if (content.length <= SNIPPET) return content;
  const parts = splitHighlight(content, q);
  let at = 0;
  for (const part of parts) {
    if (part.hit) break;
    at += part.text.length;
  }
  const start = Math.max(0, Math.min(at - 40, content.length - SNIPPET));
  return `${start > 0 ? '...' : ''}${content.slice(start, start + SNIPPET)}${start + SNIPPET < content.length ? '...' : ''}`;
}

export function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {splitHighlight(text, query).map((part, index) =>
        part.hit ? (
          <mark key={index} className="rounded bg-brand-500/30 px-0.5 text-ink-primary">
            {part.text}
          </mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

const dayStart = (value: string): string | undefined => (value ? new Date(`${value}T00:00:00`).toISOString() : undefined);
const dayEnd = (value: string): string | undefined => (value ? new Date(`${value}T23:59:59.999`).toISOString() : undefined);

export function MessageSearchDialog({
  communityId,
  channels,
  members,
  defaultChannelId,
  onClose,
  onOpen,
}: {
  communityId: string;
  channels: ReadonlyArray<{ id: string; name: string }>;
  members: ReadonlyArray<{ userId: string; name: string }>;
  defaultChannelId?: string;
  onClose: () => void;
  /** Abre o canal do resultado e pede para rolar ate a mensagem. */
  onOpen: (hit: MessageSearchHit) => void;
}) {
  const [q, setQ] = useState('');
  const [channelId, setChannelId] = useState(defaultChannelId ?? '');
  const [authorId, setAuthorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [results, setResults] = useState<MessageSearchHit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  async function run(next?: string) {
    const term = q.trim();
    if (term.length < MESSAGE_SEARCH_MIN) {
      setError(`Digite ao menos ${MESSAGE_SEARCH_MIN} caracteres.`);
      return;
    }
    if (from && to && from > to) {
      setError('A data inicial deve ser anterior à final.');
      return;
    }
    const id = ++seq.current;
    setBusy(true);
    setError('');
    try {
      const page = await api.searchCommunityMessages(communityId, {
        q: term,
        channelId: channelId || undefined,
        authorId: authorId || undefined,
        from: dayStart(from),
        to: dayEnd(to),
        cursor: next,
      });
      if (id !== seq.current) return;
      setResults((prev) => (next ? [...prev, ...page.results] : page.results));
      setCursor(page.nextCursor);
      setSearched(term);
    } catch (err) {
      if (id !== seq.current) return;
      const status = (err as { status?: number }).status;
      setError(status === 429 ? 'Muitas buscas. Aguarde um minuto.' : 'Não foi possível buscar.');
    } finally {
      if (id === seq.current) setBusy(false);
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run();
  };

  const field = 'w-full rounded-lg border border-line bg-surface-primary px-3 py-2 text-sm text-ink-primary';
  return (
    <AppModal title="Buscar mensagens" icon="search" onClose={onClose} closeLabel="Fechar busca" size="lg">
      <form onSubmit={submit} className="space-y-3" role="search" aria-label="Buscar mensagens na comunidade">
        <div>
          <label htmlFor="message-search-q" className="mb-1 block text-sm text-ink-muted">Texto</label>
          <input
            id="message-search-q"
            type="search"
            autoFocus
            value={q}
            minLength={MESSAGE_SEARCH_MIN}
            maxLength={MESSAGE_SEARCH_MAX}
            onChange={(event) => setQ(event.target.value)}
            className={field}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="message-search-channel" className="mb-1 block text-sm text-ink-muted">Canal</label>
            <select id="message-search-channel" value={channelId} onChange={(event) => setChannelId(event.target.value)} className={field}>
              <option value="">Todos os canais</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>{channel.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="message-search-author" className="mb-1 block text-sm text-ink-muted">Autor</label>
            <select id="message-search-author" value={authorId} onChange={(event) => setAuthorId(event.target.value)} className={field}>
              <option value="">Qualquer pessoa</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>{member.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="message-search-from" className="mb-1 block text-sm text-ink-muted">De</label>
            <input id="message-search-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="message-search-to" className="mb-1 block text-sm text-ink-muted">Até</label>
            <input id="message-search-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className={field} />
          </div>
        </div>
        <Button type="submit" disabled={busy}>Buscar</Button>
      </form>
      {error && <Banner variant="error" className="mt-3">{error}</Banner>}
      <div className="mt-4" aria-live="polite">
        {busy && <p role="status" className="text-sm text-ink-muted">Buscando...</p>}
        {!busy && searched && results.length === 0 && !cursor && (
          <p className="text-sm text-ink-muted">Nenhuma mensagem encontrada.</p>
        )}
        {results.length > 0 && (
          <ul aria-label="Resultados da busca" className="divide-y divide-line">
            {results.map((hit) => (
              <li key={hit.id}>
                <button
                  type="button"
                  onClick={() => onOpen(hit)}
                  className="w-full rounded-lg px-2 py-3 text-left hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  <span className="flex flex-wrap items-baseline gap-2 text-xs text-ink-muted">
                    <strong className="text-sm text-ink-primary">{hit.author.name}</strong>
                    <span>em #{hit.channelName}</span>
                    <time dateTime={hit.createdAt}>{timeFormatter.format(new Date(hit.createdAt))}</time>
                  </span>
                  <span className="mt-1 block whitespace-pre-wrap break-words text-sm text-ink-muted">
                    <Highlighted text={snippetOf(hit.content, searched)} query={searched} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {cursor && !busy && (
          <Button variant="ghost" size="sm" className="mt-2" onClick={() => void run(cursor)}>
            {results.length === 0 ? 'Continuar buscando em mensagens mais antigas' : 'Carregar mais resultados'}
          </Button>
        )}
      </div>
    </AppModal>
  );
}
