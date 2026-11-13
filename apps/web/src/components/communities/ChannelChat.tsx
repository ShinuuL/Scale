'use client';

import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type FormEvent } from 'react';
import { CHAT_EDIT_WINDOW_MS, CHAT_MESSAGE_MAX } from '@scale/shared';
import { api, type ChannelMessage } from '@/lib/api';
import type { ChannelMessagesAction, ChannelMessagesState } from '@/hooks/useChannelMessages';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Icon } from '@/components/ui/Icon';
import { ConfirmDialog } from './ConfirmDialog';
import { PinnedPanel, ReactionBar, ReplyQuote, jumpToMessage, messageAnchorId } from './MessageExtras';
import type { ChannelReaction } from '@scale/shared';

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

const EMPTY_MESSAGES: ChannelMessage[] = [];
const timeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

function MessageEditForm({
  value,
  onChange,
  onSave,
  onCancel,
  busy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label className="sr-only" htmlFor="edit-channel-message">
        Editar mensagem
      </label>
      <textarea
        autoFocus
        id="edit-channel-message"
        value={value}
        maxLength={CHAT_MESSAGE_MAX}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="w-full rounded-lg border border-line bg-surface-secondary p-2 text-sm text-ink-primary"
      />
      <Button type="submit" size="sm" disabled={busy || !value.trim()}>
        Salvar
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  );
}

function MessageItem({
  message,
  meId,
  canManage,
  color,
  editing,
  editDraft,
  busy,
  onEdit,
  onEditChange,
  onSave,
  onCancel,
  onDelete,
  canPin,
  onReply,
  onReact,
  onTogglePin,
  onJump,
}: {
  canPin: boolean;
  onReply: () => void;
  onReact: (reaction: ChannelReaction) => void;
  onTogglePin: () => void;
  onJump: (id: string) => void;
  message: ChannelMessage;
  meId: string;
  canManage: boolean;
  color?: string;
  editing: boolean;
  editDraft: string;
  busy: boolean;
  onEdit: () => void;
  onEditChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  return (
    <article id={messageAnchorId(message.id)} className="group rounded-md py-3 transition-colors">
      {message.replyTo && <ReplyQuote replyTo={message.replyTo} onJump={onJump} />}
      <div className="flex flex-wrap items-baseline gap-2">
        <strong className="text-sm text-ink-primary" style={color ? { color } : undefined}>{message.author.name}</strong>
        <time className="text-xs text-ink-muted" dateTime={message.createdAt}>
          {timeFormatter.format(new Date(message.createdAt))}
        </time>
        {message.editedAt && !message.deletedAt && (
          <span className="text-xs text-ink-muted">editada</span>
        )}
        {message.pinnedAt && !message.deletedAt && (
          <span className="flex items-center gap-1 text-xs text-ink-muted">
            <Icon name="pin" size={12} />
            fixada
          </span>
        )}
      </div>
      {editing && !message.deletedAt ? (
        <MessageEditForm
          value={editDraft}
          onChange={onEditChange}
          onSave={onSave}
          onCancel={onCancel}
          busy={busy}
        />
      ) : (
        <p
          className={`whitespace-pre-wrap break-words text-sm text-ink-muted ${message.deletedAt ? 'italic' : ''}`}
        >
          {message.deletedAt ? '[mensagem apagada]' : message.content}
        </p>
      )}
      {!message.deletedAt && message.files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {message.files.map((file) =>
            file.mime.startsWith('image/') ? (
              <a key={file.id} href={api.fileUrl(file.id)} target="_blank" rel="noopener noreferrer" aria-label={`Abrir imagem ${file.filename}`}>
                <img src={api.fileUrl(file.id)} alt={file.filename} loading="lazy" className="max-h-72 max-w-full rounded-lg border border-line object-contain sm:max-w-sm" />
              </a>
            ) : (
              <a key={file.id} href={api.fileUrl(file.id)} className="text-sm text-brand-300 underline">{file.filename}</a>
            ),
          )}
        </div>
      )}
      {!message.deletedAt && <ReactionBar message={message} meId={meId} onToggle={onReact} />}
      {!message.deletedAt && !editing && (
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="min-h-8"
            aria-label={`Responder a ${message.author.name}`}
            onClick={onReply}
          >
            Responder
          </Button>
          {canPin && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-8"
              aria-label={`${message.pinnedAt ? 'Desafixar' : 'Fixar'} mensagem de ${message.author.name}`}
              onClick={onTogglePin}
            >
              {message.pinnedAt ? 'Desafixar' : 'Fixar'}
            </Button>
          )}
          {message.author.id === meId &&
            Date.now() - new Date(message.createdAt).getTime() < CHAT_EDIT_WINDOW_MS && (
              <Button
                id={`edit-button-${message.id}`}
                variant="ghost"
                size="sm"
                className="min-h-8"
                aria-label={`Editar mensagem de ${message.author.name}`}
                onClick={onEdit}
              >
                Editar
              </Button>
            )}
          {(message.author.id === meId || canManage) && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-8"
              aria-label={`Apagar mensagem de ${message.author.name}`}
              onClick={onDelete}
            >
              Apagar
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

function Composer({
  name,
  draft,
  onChange,
  onSubmit,
  busy,
  inputRef,
  images,
  onImages,
  replyingTo,
  onCancelReply,
}: {
  replyingTo: ChannelMessage | null;
  onCancelReply: () => void;
  name: string;
  draft: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  images: File[];
  onImages: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <form onSubmit={onSubmit} className="border-t border-line p-4">
      {replyingTo && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-md bg-surface-secondary px-3 py-1 text-xs text-ink-secondary">
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Icon name="reply" size={14} />
            Respondendo a <strong>{replyingTo.author.name}</strong>
          </span>
          <button type="button" className="room-icon-button !h-6 !w-6" aria-label="Cancelar resposta" title="Cancelar resposta" onClick={onCancelReply}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
      <label htmlFor="channel-message" className="sr-only">
        Mensagem
      </label>
      <textarea
        ref={inputRef}
        id="channel-message"
        value={draft}
        onChange={(event) => onChange(event.target.value)}
        maxLength={CHAT_MESSAGE_MAX}
        rows={2}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className="w-full resize-y rounded-lg border border-line bg-surface-secondary p-3 text-sm text-ink-primary"
        placeholder={`Mensagem em ${name}`}
      />
      {images.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2" aria-label="Imagens anexadas">
          {images.map((file, index) => (
            <li key={`${file.name}-${index}`} className="flex items-center gap-1 rounded-md bg-surface-secondary px-2 py-1 text-xs text-ink-secondary">
              <span className="max-w-40 truncate">{file.name}</span>
              <button type="button" className="room-icon-button !h-6 !w-6" aria-label={`Remover ${file.name}`} onClick={() => onImages(images.filter((_, i) => i !== index))}>
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            multiple
            hidden
            onChange={(event) => {
              onImages([...images, ...Array.from(event.target.files ?? [])]);
              event.target.value = '';
            }}
          />
          <button type="button" className="room-icon-button" aria-label="Anexar imagens" title="Anexar imagens" disabled={busy || images.length >= MAX_IMAGES} onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={18} />
          </button>
          <span className="text-xs text-ink-muted">
            {draft.length}/{CHAT_MESSAGE_MAX}
          </span>
        </div>
        <Button type="submit" size="sm" disabled={busy || (!draft.trim() && images.length === 0)}>
          Enviar
        </Button>
      </div>
    </form>
  );
}

export function ChannelChat({
  channelId,
  name,
  meId,
  canManage,
  authorColors,
  state,
  dispatch,
}: {
  channelId: string;
  name: string;
  meId: string;
  canManage: boolean;
  authorColors?: ReadonlyMap<string, string>;
  state: ChannelMessagesState;
  dispatch: Dispatch<ChannelMessagesAction>;
}) {
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const pickImages = (files: File[]) => {
    const valid = files.filter((file) => file.type.startsWith('image/') && file.size <= MAX_IMAGE_BYTES);
    if (valid.length < files.length) setError('Só imagens de até 25 MB.');
    else if (valid.length > MAX_IMAGES) setError(`Máximo de ${MAX_IMAGES} imagens por mensagem.`);
    else setError('');
    setImages(valid.slice(0, MAX_IMAGES));
  };
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ChannelMessage | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [replyingTo, setReplyingTo] = useState<ChannelMessage | null>(null);
  const [pinsOpen, setPinsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const olderBusy = useRef(false);
  const messages = state.channelId === channelId ? state.messages : EMPTY_MESSAGES;
  useEffect(() => {
    if (state.loading) setError('');
  }, [state.loading]);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);
  const cancelEdit = () => {
    const id = editing;
    setEditing(null);
    requestAnimationFrame(() => document.getElementById(`edit-button-${id}`)?.focus());
  };
  async function send(event: FormEvent) {
    event.preventDefault();
    if ((!draft.trim() && images.length === 0) || busy) return;
    setBusy(true);
    setError('');
    try {
      const { message } = images.length > 0
        ? await api.uploadChannelImages(channelId, images, draft.trim())
        : replyingTo
          ? await api.sendChannelMessage(channelId, draft, replyingTo.id)
          : await api.sendChannelMessage(channelId, draft);
      stickToBottom.current = true;
      dispatch({ type: 'message', message });
      setDraft('');
      setImages([]);
      setReplyingTo(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(status === 413 ? 'Imagem grande demais ou cota do canal cheia.' : status === 400 ? 'Formato de imagem não aceito.' : status === 429 ? 'Muitos envios. Aguarde um pouco.' : 'Não foi possível enviar a mensagem.');
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }
  async function saveEdit() {
    if (!editing || !editDraft.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.editChannelMessage(channelId, editing, editDraft);
      dispatch({
        type: 'edit',
        event: {
          channelId,
          messageId: editing,
          content: editDraft.trim(),
          editedAt: new Date().toISOString(),
        },
      });
      cancelEdit();
    } catch {
      setError('Não foi possível editar a mensagem.');
    } finally {
      setBusy(false);
    }
  }
  async function react(messageId: string, reaction: ChannelReaction) {
    try {
      dispatch({ type: 'reaction', event: await api.toggleChannelReaction(channelId, messageId, reaction) });
    } catch (err) {
      setError((err as { status?: number }).status === 429 ? 'Muitas reações. Aguarde um pouco.' : 'Não foi possível reagir.');
    }
  }
  async function togglePin(message: ChannelMessage) {
    try {
      dispatch({ type: 'pin', event: await api.setChannelPin(channelId, message.id, !message.pinnedAt) });
    } catch (err) {
      setError((err as { status?: number }).status === 409 ? 'Limite de mensagens fixadas neste canal.' : 'Não foi possível fixar a mensagem.');
    }
  }
  const jump = (id: string) => {
    if (!jumpToMessage(id)) setError('A mensagem original não está carregada. Use "Carregar anteriores".');
  };
  const pinVersion = messages.filter((message) => message.pinnedAt).length;
  async function older() {
    if (!state.cursor || olderBusy.current) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    setError('');
    stickToBottom.current = false;
    const el = listRef.current;
    const height = el?.scrollHeight ?? 0;
    const top = el?.scrollTop ?? 0;
    try {
      const result = await api.getChannelMessages(channelId, state.cursor);
      dispatch({
        type: 'loaded',
        channelId,
        messages: result.messages,
        cursor: result.nextCursor,
        older: true,
      });
      requestAnimationFrame(() => {
        if (el) el.scrollTop = top + el.scrollHeight - height;
      });
    } catch {
      setError('Não foi possível carregar mensagens anteriores.');
    } finally {
      olderBusy.current = false;
      setLoadingOlder(false);
    }
  }
  return (
    <section aria-label={`Canal ${name}`} className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-4">
        <h2 className="font-semibold text-ink-primary">{name}</h2>
        <button type="button" className="room-icon-button" aria-label="Mensagens fixadas" title="Mensagens fixadas" onClick={() => setPinsOpen(true)}>
          <Icon name="pin" size={18} />
        </button>
      </div>
      <div
        ref={listRef}
        onScroll={(event) => {
          const el = event.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
        className="min-h-0 flex-1 overflow-y-auto p-5"
      >
        {state.cursor && (
          <Button variant="ghost" size="sm" disabled={loadingOlder} onClick={() => void older()}>
            Carregar anteriores
          </Button>
        )}
        {(state.loading || loadingOlder) && (
          <div role="status" className="text-sm text-ink-muted">
            Carregando mensagens...
            <Skeleton className="mt-2 h-12" />
          </div>
        )}
        {!state.loading && messages.length === 0 && !state.error && (
          <p className="text-sm text-ink-muted">Ainda não há mensagens neste canal.</p>
        )}
        <div role="log" aria-live="polite" aria-label="Mensagens">
          {messages.map((message) => (
            <MessageItem
              key={message.id}
              message={message}
              meId={meId}
              canManage={canManage}
              color={message.author.id ? authorColors?.get(message.author.id) : undefined}
              editing={editing === message.id}
              editDraft={editDraft}
              busy={busy}
              onEdit={() => {
                setEditing(message.id);
                setEditDraft(message.content);
              }}
              onEditChange={setEditDraft}
              onSave={() => void saveEdit()}
              onCancel={cancelEdit}
              onDelete={() => setDeleting(message)}
              canPin={canManage}
              onReply={() => {
                setReplyingTo(message);
                inputRef.current?.focus();
              }}
              onReact={(reaction) => void react(message.id, reaction)}
              onTogglePin={() => void togglePin(message)}
              onJump={jump}
            />
          ))}
        </div>
      </div>
      {(error || state.error) && (
        <Banner variant="error" className="mx-4">
          {error || state.error}
        </Banner>
      )}
      <Composer
        name={name}
        draft={draft}
        onChange={setDraft}
        onSubmit={send}
        busy={busy}
        inputRef={inputRef}
        images={images}
        onImages={pickImages}
        replyingTo={replyingTo}
        onCancelReply={() => {
          setReplyingTo(null);
          inputRef.current?.focus();
        }}
      />
      {pinsOpen && (
        <PinnedPanel channelId={channelId} version={pinVersion} onClose={() => setPinsOpen(false)} onJump={jump} />
      )}
      {deleting && (
        <ConfirmDialog
          title="Apagar esta mensagem?"
          description={
            <>
              <p>Esta ação não pode ser desfeita.</p>
              <p className="mt-2 whitespace-pre-wrap">{deleting.content.slice(0, 200)}</p>
            </>
          }
          confirmLabel="Apagar mensagem"
          onConfirm={async () => {
            await api.deleteChannelMessage(channelId, deleting.id);
            dispatch({
              type: 'delete',
              event: { channelId, messageId: deleting.id, deletedAt: new Date().toISOString() },
            });
          }}
          onClose={() => {
            setDeleting(null);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        />
      )}
    </section>
  );
}
