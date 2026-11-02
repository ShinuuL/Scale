'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DM_MESSAGE_MAX, type DirectMessage, type PublicUser } from '@scale/shared';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import { UserAvatar } from '@/components/friends/UserAvatar';

export interface DirectChatProps {
  meId: string;
  friend: PublicUser;
  /** Mensagens que chegaram pelo socket desde a abertura (desta conversa). */
  incoming: DirectMessage[];
  onBack?: () => void;
  onRemoveFriend: () => void;
}

const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Junta listas sem repetir id (o socket tambem entrega o que eu enviei). */
function mergeMessages(a: DirectMessage[], b: DirectMessage[]): DirectMessage[] {
  const map = new Map<string, DirectMessage>();
  for (const m of [...a, ...b]) map.set(m.id, m);
  return [...map.values()].sort((x, y) => x.createdAt.localeCompare(y.createdAt));
}

/** Conversa privada com um amigo: historico paginado, envio e tempo real. */
export function DirectChat({ meId, friend, incoming, onBack, onRemoveFriend }: DirectChatProps) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);
    setError(null);
    setConfirmRemove(false);
    stickToBottom.current = true;
    api
      .getDirectMessages(friend.id)
      .then((res) => {
        if (cancelled) return;
        setMessages((prev) => mergeMessages(res.messages, prev));
        setHasMore(res.hasMore);
      })
      .catch(() => {
        if (!cancelled) setError('Não foi possível carregar a conversa.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    inputRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [friend.id]);

  useEffect(() => {
    if (incoming.length > 0) setMessages((prev) => mergeMessages(prev, incoming));
  }, [incoming]);

  // Mensagem nova rola para o fim, salvo se o usuario subiu para ler.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadOlder = async () => {
    const first = messages[0];
    if (!first) return;
    const el = listRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    stickToBottom.current = false;
    try {
      const res = await api.getDirectMessages(friend.id, first.createdAt);
      setMessages((prev) => mergeMessages(res.messages, prev));
      setHasMore(res.hasMore);
      // Mantem a posicao de leitura depois de inserir acima.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch {
      setError('Não foi possível carregar mensagens anteriores.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const msg = await api.sendDirectMessage(friend.id, content);
      stickToBottom.current = true;
      setMessages((prev) => mergeMessages(prev, [msg]));
      setDraft('');
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 429
          ? 'Muitas mensagens seguidas. Aguarde alguns segundos.'
          : status === 403
            ? 'Vocês não são mais amigos.'
            : 'Não foi possível enviar.',
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [draft, sending, friend.id]);

  const onScroll = () => {
    const el = listRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <section aria-label={`Conversa com ${friend.name}`} className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Voltar para a lista de amigos"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 md:hidden"
          >
            <Icon name="arrowLeft" />
          </button>
        )}
        <UserAvatar userId={friend.id} name={friend.name} avatarUpdatedAt={friend.avatarUpdatedAt} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white">{friend.name}</h2>
          {friend.username && <p className="truncate text-xs text-slate-400">@{friend.username}</p>}
        </div>
        {confirmRemove ? (
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-slate-400 sm:inline">Desfazer amizade?</span>
            <Button variant="danger" size="sm" onClick={onRemoveFriend}>
              Desfazer
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
              Cancelar
            </Button>
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(true)} aria-label={`Desfazer amizade com ${friend.name}`}>
            <Icon name="trash" size={14} />
            <span className="hidden sm:inline">Desfazer amizade</span>
          </Button>
        )}
      </header>

      <div
        ref={listRef}
        onScroll={onScroll}
        role="log"
        aria-live="polite"
        aria-label="Mensagens"
        className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-4"
      >
        {hasMore && (
          <div className="flex justify-center pb-2">
            <Button variant="ghost" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
              {loadingOlder ? 'Carregando...' : 'Carregar anteriores'}
            </Button>
          </div>
        )}
        {loading && <p className="text-center text-sm text-slate-400">Carregando conversa...</p>}
        {!loading && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-400">
            Nenhuma mensagem ainda. Diga oi para {friend.name}.
          </p>
        )}
        {messages.map((m, i) => {
          const mine = m.senderId === meId;
          const newDay = i === 0 || dayKey(messages[i - 1].createdAt) !== dayKey(m.createdAt);
          return (
            <div key={m.id}>
              {newDay && (
                <p className="py-2 text-center text-xs text-slate-500">{dayFmt.format(new Date(m.createdAt))}</p>
              )}
              <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    mine
                      ? 'max-w-[80%] rounded-2xl rounded-br-md bg-brand-600/30 px-3 py-2 text-sm text-white'
                      : 'max-w-[80%] rounded-2xl rounded-bl-md bg-white/[0.06] px-3 py-2 text-sm text-slate-100'
                  }
                >
                  <span className="sr-only">{mine ? 'Você' : friend.name}: </span>
                  <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  <time dateTime={m.createdAt} className="mt-0.5 block text-right text-[10px] text-slate-400">
                    {timeFmt.format(new Date(m.createdAt))}
                  </time>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="mx-4 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2 border-t border-white/[0.08] p-3"
      >
        <label htmlFor="dm-input" className="sr-only">
          Mensagem para {friend.name}
        </label>
        <textarea
          id="dm-input"
          ref={inputRef}
          value={draft}
          rows={1}
          maxLength={DM_MESSAGE_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra a linha.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={`Mensagem para ${friend.name}`}
          className="input-base max-h-32 min-h-[40px] flex-1 resize-none"
        />
        <Button type="submit" disabled={!draft.trim() || sending} aria-label="Enviar mensagem" aria-busy={sending}>
          <Icon name="arrowRight" />
        </Button>
      </form>
    </section>
  );
}
