'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { Socket } from 'socket.io-client';
import type { ChatApi, ChatMessage } from '@/hooks/useChat';
import { CHAT_FILE_ACCEPT, CHAT_MESSAGE_MAX, MAX_FILES_PER_MESSAGE } from '@scale/shared';
import { chatMessageClientSchema, fileClientSchema } from '@/lib/validation';
import { ChatMessageItem } from '@/components/ChatMessageItem';
import { Icon, type IconName } from '@/components/ui/Icon';

const MENTION_TOKEN_RE = /@(\w[\w .-]{0,49})/g;
const MENTION_TRAILING_RE = /@(\w[\w .-]{0,49})$/;
const MAX_FILES = MAX_FILES_PER_MESSAGE;

function extractMentions(text: string, peers: string[]): string[] {
  const matches = Array.from(text.matchAll(MENTION_TOKEN_RE), (m) => m[1].trim());
  return matches.filter((name) => peers.includes(name)).slice(0, 8);
}

function mimeIconName(mime: string): IconName {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'document';
  if (mime.startsWith('audio/')) return 'music';
  if (mime === 'application/zip') return 'archive';
  return 'paperclip';
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / 1024).toFixed(0)}KB`;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === 'undefined') return true;
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(min-width: 768px)').matches;
    }
    return window.innerWidth >= 768;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isDesktop;
}

export interface ChatPanelProps {
  roomId: string;
  socket: Socket | null;
  chat: ChatApi;
  currentPeers: string[];
  open: boolean;
  onClose: () => void;
  isOwner: boolean;
  guestName: string;
}

export function ChatPanel({
  chat,
  currentPeers,
  open,
  onClose,
  isOwner,
  guestName,
}: ChatPanelProps) {
  const isDesktop = useIsDesktop();

  const [input, setInput] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [filtered, setFiltered] = useState<string[]>([]);
  const [activeOption, setActiveOption] = useState(-1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  // Motivo visível de arquivo recusado ou upload que falhou — antes os dois
  // casos sumiam em silêncio (filtro mudo + `.catch(() => {})`).
  const [uploading, setUploading] = useState(false);
  const mobileDialogRef = useRef<HTMLDialogElement>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Notifica o hook do estado aberto para a lógica de unread
  useEffect(() => {
    chat.setOpen(open);
  }, [open, chat]);

  // Âncora de scroll no fim da lista
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, chat]);

  useEffect(() => {
    if (!open || isDesktop) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = mobileDialogRef.current;
    if (dialog && !dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    inputRef.current?.focus();
    return () => {
      dialog?.close?.();
      previous?.focus();
    };
  }, [open, isDesktop]);

  const handleInputChange = useCallback(
    (value: string) => {
      setInput(value);
      setActiveOption(-1);
      const match = value.match(MENTION_TRAILING_RE);
      if (match) {
        const query = match[1].toLowerCase();
        setFiltered(currentPeers.filter((name) => name.toLowerCase().includes(query)));
        setShowMention(true);
      } else {
        setFiltered([]);
        setShowMention(false);
      }
    },
    [currentPeers],
  );

  const selectOption = useCallback((name: string) => {
    setInput((prev) => prev.replace(MENTION_TRAILING_RE, `@${name} `));
    setShowMention(false);
    setFiltered([]);
    setActiveOption(-1);
    inputRef.current?.focus();
  }, []);

  const send = useCallback(() => {
    if (uploading) return;
    const parsed = chatMessageClientSchema.safeParse(input);
    const hasFiles = selectedFiles.length > 0;
    if ((!parsed.success || input.trim().length === 0) && !hasFiles) return;

    const mentions = extractMentions(input, currentPeers);
    if (selectedFiles.length > 0) {
      setFileError(null);
      setUploading(true);
      void chat
        .uploadFiles(selectedFiles, input, guestName)
        .then(() => {
          setInput('');
          setSelectedFiles([]);
        })
        .catch((err: unknown) => {
          setFileError(
            err instanceof Error
              ? err.message
              : 'Não foi possível enviar o arquivo. Tente novamente.',
          );
        })
        .finally(() => setUploading(false));
    } else {
      chat.sendMessage(input, mentions);
      setInput('');
    }
    setShowMention(false);
    setFiltered([]);
    setActiveOption(-1);
  }, [input, selectedFiles, currentPeers, chat, guestName, uploading]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showMention && filtered.length > 0) {
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActiveOption((prev) => (prev + 1) % filtered.length);
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActiveOption((prev) => (prev <= 0 ? filtered.length - 1 : prev - 1));
          return;
        }
        if (event.key === 'Enter' && activeOption >= 0) {
          event.preventDefault();
          selectOption(filtered[activeOption]);
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setShowMention(false);
          setFiltered([]);
          setActiveOption(-1);
          return;
        }
      }

      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault();
        send();
      }
    },
    [showMention, filtered, activeOption, selectOption, send],
  );

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const rejected: string[] = [];
    const valid = Array.from(files)
      .filter((file) => {
        const result = fileClientSchema.safeParse({ file });
        if (!result.success) {
          rejected.push(`${file.name}: ${result.error.issues[0]?.message ?? 'arquivo inválido'}`);
        }
        return result.success;
      })
      .slice(0, MAX_FILES);
    setFileError(rejected.length > 0 ? `Não anexado — ${rejected.join('; ')}` : null);
    setSelectedFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES));
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  if (!open) return null;

  const charOverflow = input.length > CHAT_MESSAGE_MAX;
  const canSend =
    !uploading && (input.trim().length > 0 || selectedFiles.length > 0) && !charOverflow;

  const panelContent = (
    <aside
      className="flex h-full min-h-0 flex-col overflow-hidden border-l border-line bg-surface-secondary"
      aria-label="Chat"
      data-testid="chat-panel"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line flex-shrink-0">
        <h2 className="text-sm font-semibold text-white">Chat</h2>
        {chat.unread > 0 && (
          <span className="badge bg-accent-solid text-white" data-testid="unread-badge">
            {chat.unread > 99 ? '99+' : chat.unread}
          </span>
        )}
        <button
          onClick={onClose}
          aria-label="Fechar chat"
          className="ml-auto flex h-10 w-10 items-center justify-center rounded-md text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
        >
          <Icon name="close" />
        </button>
      </header>

      {/* Paginação */}
      {chat.hasMore && (
        <button
          onClick={() => void chat.loadMore()}
          disabled={chat.isLoadingHistory}
          className="text-xs text-accent hover:text-accent text-left px-3 py-1.5 border-b border-line disabled:opacity-50"
        >
          {chat.isLoadingHistory ? 'Carregando...' : 'Carregar mais'}
        </button>
      )}

      {/* Lista */}
      <div
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Mensagens do chat"
        className="flex-1 overflow-y-auto flex flex-col gap-1 p-2 min-h-0"
      >
        {chat.messages.map((message: ChatMessage) => (
          <ChatMessageItem
            key={message.id}
            message={message}
            currentPeers={currentPeers}
            // isMine vem do servidor (por destinatario: authorId ou guestId
            // do cookie). O nome nunca decide autoria.
            isOwn={message.isMine === true}
            isOwner={isOwner}
            onEdit={chat.editMessage}
            onDelete={chat.deleteMessage}
            roomTicket={chat.roomTicket}
          />
        ))}
      </div>

      {uploading && (
        <p role="status" className="border-t border-line px-3 py-2 text-sm text-ink-secondary">
          Enviando arquivos… Aguarde a conclusão.
        </p>
      )}

      {fileError && (
        <p
          role="alert"
          data-testid="file-error"
          className="px-3 py-1.5 text-xs text-red-300 border-t border-line flex-shrink-0"
        >
          {fileError}
        </p>
      )}

      {/* Chips de arquivos */}
      {selectedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-1.5 border-t border-line flex-shrink-0">
          {selectedFiles.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className="text-xs bg-surface-tertiary px-2 py-1 rounded flex items-center gap-1.5 text-ink-secondary"
              data-testid="file-chip"
            >
              <span aria-hidden="true">
                <Icon name={mimeIconName(file.type)} size={14} />
              </span>
              <span className="max-w-[140px] truncate">{file.name}</span>
              <span className="text-ink-muted">{formatFileSize(file.size)}</span>
              <button
                onClick={() => removeFile(index)}
                aria-label={`Remover arquivo ${file.name}`}
                className="text-ink-muted hover:text-white"
              >
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Autocomplete de menções */}
      {showMention && filtered.length > 0 && (
        <ul
          id="chat-mention-options"
          role="listbox"
          aria-label="Participantes para mencionar"
          className="mx-3 mb-1 border border-line rounded bg-surface-secondary shadow-xl overflow-hidden flex-shrink-0 max-h-40 overflow-y-auto"
        >
          {filtered.map((name, index) => (
            <li
              key={name}
              id={`chat-mention-option-${index}`}
              role="option"
              aria-selected={index === activeOption}
              className={`px-2 py-1.5 text-xs cursor-pointer ${
                index === activeOption
                  ? 'bg-accent-solid text-white'
                  : 'text-ink-primary hover:bg-surface-tertiary'
              }`}
              onMouseEnter={() => setActiveOption(index)}
              onClick={() => selectOption(name)}
            >
              {name}
            </li>
          ))}
        </ul>
      )}

      {/* Input */}
      <div className="p-3 border-t border-line flex flex-col gap-2 flex-shrink-0">
        {/* `aria-expanded` so e valido em `role="combobox"`: o autocomplete de
            mencoes e exatamente esse padrao (combobox + listbox de opcoes). */}
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Escreva uma mensagem..."
          aria-label="Mensagem"
          role="combobox"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-controls={showMention && filtered.length > 0 ? 'chat-mention-options' : undefined}
          aria-expanded={showMention && filtered.length > 0}
          aria-activedescendant={
            showMention && activeOption >= 0 ? `chat-mention-option-${activeOption}` : undefined
          }
          rows={2}
          maxLength={600}
          className="input-base max-h-24 min-h-11 resize-none"
          disabled={uploading}
        />
        <div className="flex items-center justify-between gap-2">
          <span
            data-testid="char-counter"
            className={`text-xs ${charOverflow ? 'text-red-400 font-medium' : 'text-ink-muted'}`}
          >
            {input.length}/{CHAT_MESSAGE_MAX}
          </span>
          <div className="flex items-center gap-2">
            <label className="relative flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm text-ink-secondary hover:bg-surface-hover focus-within:ring-2 focus-within:ring-accent">
              <span aria-hidden="true">
                <Icon name="paperclip" size={14} />
              </span>{' '}
              Anexar
              <input
                type="file"
                multiple
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }}
                accept={CHAT_FILE_ACCEPT}
              />
            </label>
            <button
              onClick={send}
              disabled={!canSend}
              className="btn-primary min-h-10 text-sm"
              aria-busy={uploading}
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </aside>
  );

  if (isDesktop) {
    return <div className="h-full w-80 flex-shrink-0 xl:w-[340px]">{panelContent}</div>;
  }

  return createPortal(
    <dialog
      ref={mobileDialogRef}
      aria-label="Chat da sala"
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 m-0 ml-auto h-[100dvh] max-h-none w-full max-w-sm border-0 bg-surface-secondary p-0 text-ink-primary backdrop:bg-black/70"
    >
      {panelContent}
    </dialog>,
    document.body,
  );
}
