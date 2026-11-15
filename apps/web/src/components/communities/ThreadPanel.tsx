'use client';

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  CHANNEL_THREAD_NAME_MAX,
  CHAT_MESSAGE_MAX,
  formatCountdown,
  formatThreadReplies,
  type ChannelThreadSummary,
} from '@scale/shared';
import { api, type ChannelMessage } from '@/lib/api';
import { threadBus } from '@/lib/threadEvents';
import { AppModal } from '@/components/ui/AppModal';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Icon } from '@/components/ui/Icon';
import { useCooldown } from './slowMode';

const timeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Rotulo do rodape da mensagem de origem: "N respostas · Abrir tópico". */
export const threadFooterLabel = (thread: Pick<ChannelThreadSummary, 'replyCount'>): string =>
  `${formatThreadReplies(thread.replyCount)} · Abrir tópico`;

/** Dialogo "Abrir tópico": nome 1..80 a partir de uma mensagem do canal. */
export function CreateThreadDialog({
  channelId,
  message,
  onClose,
  onCreated,
}: {
  channelId: string;
  message: ChannelMessage;
  onClose: () => void;
  onCreated: (thread: ChannelThreadSummary) => void;
}) {
  const [name, setName] = useState(
    message.content.replace(/\s+/g, ' ').trim().slice(0, CHANNEL_THREAD_NAME_MAX),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      onCreated((await api.createChannelThread(channelId, message.id, name.trim())).thread);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 409
          ? 'Esta mensagem já tem um tópico.'
          : status === 403
            ? 'Você não pode abrir tópicos neste canal.'
            : 'Não foi possível abrir o tópico.',
      );
      setBusy(false);
    }
  }
  return (
    <AppModal
      title="Abrir tópico"
      icon="chat"
      onClose={onClose}
      locked={busy}
      closeLabel="Cancelar tópico"
    >
      <form className="space-y-3" onSubmit={(event) => void submit(event)}>
        <Input
          label="Nome do tópico"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={CHANNEL_THREAD_NAME_MAX}
          required
          autoFocus
        />
        {error && <Banner variant="error">{error}</Banner>}
        <Button type="submit" disabled={busy || !name.trim()}>
          Abrir tópico
        </Button>
      </form>
    </AppModal>
  );
}

/**
 * Painel lateral do topico: historico paginado, compositor proprio e arquivar
 * (quem gerencia mensagens). Permissoes vem do canal pai (servidor decide).
 */
export function ThreadPanel({
  threadId,
  channelId,
  meId,
  slowModeSeconds = 0,
  slowModeExempt = false,
  onClose,
}: {
  threadId: string;
  channelId: string;
  meId: string;
  slowModeSeconds?: number;
  slowModeExempt?: boolean;
  onClose: () => void;
}) {
  const [thread, setThread] = useState<ChannelThreadSummary | null>(null);
  const [canSend, setCanSend] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cooldown = useCooldown();
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMessages([]);
    setError('');
    Promise.all([api.getChannelThread(threadId), api.getThreadMessages(threadId)])
      .then(([info, page]) => {
        if (!active) return;
        setThread(info.thread);
        setCanSend(info.canSend);
        setCanManage(info.canManage);
        setMessages(page.messages);
        setCursor(page.nextCursor);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar o tópico.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [threadId]);

  useEffect(
    () =>
      threadBus.subscribe((event) => {
        if (event.type === 'message' && event.message.threadId === threadId) {
          setMessages((list) =>
            list.some((m) => m.id === event.message.id) ? list : [...list, event.message],
          );
        } else if (event.type === 'thread' && event.event.thread.id === threadId) {
          const next = event.event.thread;
          setThread(next);
          if (next.archivedAt) setCanSend(false);
          else
            void api
              .getChannelThread(threadId)
              .then((info) => setCanSend(info.canSend))
              .catch(() => undefined);
        } else if (event.type === 'edit') {
          setMessages((list) =>
            list.map((m) =>
              m.id === event.event.messageId
                ? { ...m, content: event.event.content, editedAt: event.event.editedAt }
                : m,
            ),
          );
        } else if (event.type === 'delete') {
          setMessages((list) =>
            list.map((m) =>
              m.id === event.event.messageId ? { ...m, deletedAt: event.event.deletedAt } : m,
            ),
          );
        }
      }),
    [threadId],
  );

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function older() {
    if (!cursor) return;
    stick.current = false;
    try {
      const page = await api.getThreadMessages(threadId, cursor);
      setMessages((list) => [
        ...page.messages.filter((m) => !list.some((x) => x.id === m.id)),
        ...list,
      ]);
      setCursor(page.nextCursor);
    } catch {
      setError('Não foi possível carregar mensagens anteriores.');
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy || cooldown.remaining > 0) return;
    setBusy(true);
    setError('');
    try {
      const { message } = await api.sendThreadMessage(threadId, draft);
      stick.current = true;
      setMessages((list) => (list.some((m) => m.id === message.id) ? list : [...list, message]));
      setDraft('');
      if (!slowModeExempt) cooldown.start(slowModeSeconds);
    } catch (err) {
      const { status, retryAfterSeconds } = err as { status?: number; retryAfterSeconds?: number };
      if (status === 429 && retryAfterSeconds) cooldown.start(retryAfterSeconds);
      else
        setError(
          status === 409
            ? 'Tópico arquivado: não aceita novas mensagens.'
            : status === 403
              ? 'Você não pode enviar mensagens neste tópico.'
              : status === 429
                ? 'Muitos envios. Aguarde um pouco.'
                : 'Não foi possível enviar a mensagem.',
        );
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    if (!thread) return;
    try {
      const result = await api.setThreadArchived(threadId, !thread.archivedAt);
      setThread(result.thread);
      setCanSend(!result.thread.archivedAt && (await api.getChannelThread(threadId)).canSend);
    } catch {
      setError('Não foi possível alterar o tópico.');
    }
  }

  async function remove(message: ChannelMessage) {
    try {
      await api.deleteChannelMessage(channelId, message.id);
      setMessages((list) =>
        list.map((m) => (m.id === message.id ? { ...m, deletedAt: new Date().toISOString() } : m)),
      );
    } catch {
      setError('Não foi possível apagar a mensagem.');
    }
  }

  const title = thread?.name ?? 'Tópico';
  return (
    <aside
      aria-label={`Tópico ${title}`}
      className="fixed inset-0 z-40 flex flex-col bg-surface-primary md:static md:z-auto md:w-96 md:shrink-0 md:border-l md:border-line"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Icon name="chat" size={18} aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-semibold text-ink-primary">{title}</h3>
          {thread && (
            <p className="text-xs text-ink-muted">
              {formatThreadReplies(thread.replyCount)}
              {thread.archivedAt ? ' · arquivado' : ''}
            </p>
          )}
        </div>
        {canManage && thread && (
          <button
            type="button"
            className="room-icon-button"
            aria-label={thread.archivedAt ? 'Desarquivar tópico' : 'Arquivar tópico'}
            title={thread.archivedAt ? 'Desarquivar tópico' : 'Arquivar tópico'}
            onClick={() => void toggleArchive()}
          >
            <Icon name="archive" size={18} />
          </button>
        )}
        <button
          type="button"
          className="room-icon-button"
          aria-label="Fechar tópico"
          title="Fechar tópico"
          onClick={onClose}
        >
          <Icon name="close" size={18} />
        </button>
      </header>
      <div
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto p-4"
      >
        {cursor && (
          <Button variant="ghost" size="sm" onClick={() => void older()}>
            Carregar anteriores
          </Button>
        )}
        {loading && (
          <p role="status" className="text-sm text-ink-muted">
            Carregando tópico...
          </p>
        )}
        {!loading && messages.length === 0 && !error && (
          <p className="text-sm text-ink-muted">Ainda não há respostas neste tópico.</p>
        )}
        <div role="log" aria-live="polite" aria-label="Mensagens do tópico">
          {messages.map((message) => (
            <article key={message.id} className="py-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <strong className="text-sm text-ink-primary">{message.author.name}</strong>
                <time className="text-xs text-ink-muted" dateTime={message.createdAt}>
                  {timeFormatter.format(new Date(message.createdAt))}
                </time>
                {message.editedAt && !message.deletedAt && (
                  <span className="text-xs text-ink-muted">editada</span>
                )}
              </div>
              <p
                className={`whitespace-pre-wrap break-words text-sm text-ink-muted ${message.deletedAt ? 'italic' : ''}`}
              >
                {message.deletedAt ? '[mensagem apagada]' : message.content}
              </p>
              {!message.deletedAt && (message.author.id === meId || canManage) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-8"
                  aria-label={`Apagar mensagem de ${message.author.name} no tópico`}
                  onClick={() => void remove(message)}
                >
                  Apagar
                </Button>
              )}
            </article>
          ))}
        </div>
      </div>
      {error && (
        <Banner variant="error" className="mx-4">
          {error}
        </Banner>
      )}
      {thread?.archivedAt ? (
        <p
          className="flex items-center gap-2 border-t border-line p-4 text-sm text-ink-muted"
          role="note"
        >
          <Icon name="archive" size={16} />
          Tópico arquivado: não aceita novas mensagens.
        </p>
      ) : !loading && !canSend ? (
        <p
          className="flex items-center gap-2 border-t border-line p-4 text-sm text-ink-muted"
          role="note"
        >
          <Icon name="lock" size={16} />
          Você não tem permissão para enviar mensagens neste tópico.
        </p>
      ) : (
        <form onSubmit={(event) => void send(event)} className="border-t border-line p-4">
          <label htmlFor="thread-message" className="sr-only">
            Mensagem no tópico
          </label>
          <textarea
            id="thread-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={CHAT_MESSAGE_MAX}
            rows={2}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className="w-full resize-y rounded-lg border border-line bg-surface-secondary p-3 text-sm text-ink-primary"
            placeholder={`Responder em ${title}`}
          />
          <div className="mt-2 flex items-center justify-between">
            {cooldown.remaining > 0 ? (
              <span className="flex items-center gap-1 text-xs text-ink-secondary" role="status">
                <Icon name="clock" size={14} />
                Modo lento: aguarde {formatCountdown(cooldown.remaining)}
              </span>
            ) : (
              <span className="text-xs text-ink-muted">
                {draft.length}/{CHAT_MESSAGE_MAX}
              </span>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={busy || cooldown.remaining > 0 || !draft.trim()}
            >
              Enviar
            </Button>
          </div>
        </form>
      )}
    </aside>
  );
}
