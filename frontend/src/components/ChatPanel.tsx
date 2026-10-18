'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import type { ChatApi, ChatMessage } from '@/hooks/useChat';
import { chatMessageClientSchema, fileClientSchema } from '@/lib/validation';
import { ChatMessageItem } from '@/components/ChatMessageItem';
import { Icon, type IconName } from '@/components/ui/Icon';

const MENTION_TOKEN_RE = /@(\w[\w .-]{0,49})/g;
const MENTION_TRAILING_RE = /@(\w[\w .-]{0,49})$/;
const MAX_FILES = 5;

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
  currentUserId: string | null;
  guestName: string;
  /** inviteToken de sala protegida (guests) — usado nos links de download. */
  inviteToken?: string;
  /** senha de sala protegida por password — anexada aos links de download. */
  password?: string;
}

export function ChatPanel({
  chat,
  currentPeers,
  open,
  onClose,
  isOwner,
  currentUserId,
  guestName,
  inviteToken,
  password,
}: ChatPanelProps) {
  const isDesktop = useIsDesktop();

  const [input, setInput] = useState('');
  const [showMention, setShowMention] = useState(false);
  const [filtered, setFiltered] = useState<string[]>([]);
  const [activeOption, setActiveOption] = useState(-1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

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
    const parsed = chatMessageClientSchema.safeParse(input);
    const hasFiles = selectedFiles.length > 0;
    if ((!parsed.success || input.trim().length === 0) && !hasFiles) return;

    const mentions = extractMentions(input, currentPeers);
    if (selectedFiles.length > 0) {
      void chat.uploadFiles(selectedFiles, input, guestName).catch(() => {});
    } else {
      chat.sendMessage(input, mentions);
    }
    setInput('');
    setSelectedFiles([]);
    setShowMention(false);
    setFiltered([]);
    setActiveOption(-1);
  }, [input, selectedFiles, currentPeers, chat, guestName]);

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

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    },
    [showMention, filtered, activeOption, selectOption, send],
  );

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const valid = Array.from(files)
      .filter((file) => fileClientSchema.safeParse({ file }).success)
      .slice(0, MAX_FILES);
    setSelectedFiles((prev) => [...prev, ...valid].slice(0, MAX_FILES));
  }, []);

  const removeFile = useCallback((index: number) => {
    setSelectedFiles((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  if (!open) return null;

  const charOverflow = input.length > 500;
  const canSend = (input.trim().length > 0 || selectedFiles.length > 0) && !charOverflow;

  const panelContent = (
    <aside
      className="flex flex-col bg-forest-900/90 border-l border-white/5 h-full overflow-hidden"
      aria-label="Chat"
      data-testid="chat-panel"
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/5 flex-shrink-0">
        <h2 className="text-sm font-semibold text-white">Chat</h2>
        {chat.unread > 0 && (
          <span className="badge bg-amber-500 text-forest-950" data-testid="unread-badge">
            {chat.unread > 99 ? '99+' : chat.unread}
          </span>
        )}
        <button
          onClick={onClose}
          aria-label="Fechar chat"
          className="ml-auto text-slate-400 hover:text-white leading-none"
        >
          <Icon name="close" />
        </button>
      </header>

      {/* Paginação */}
      {chat.hasMore && (
        <button
          onClick={() => void chat.loadMore()}
          disabled={chat.isLoadingHistory}
          className="text-xs text-moss-400 hover:text-moss-300 text-left px-3 py-1.5 border-b border-white/5 disabled:opacity-50"
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
            isOwn={
              message.authorId === currentUserId ||
              (message.authorId === null && message.guestName === guestName)
            }
            isOwner={isOwner}
            onEdit={chat.editMessage}
            onDelete={chat.deleteMessage}
            accessToken={inviteToken}
            password={password}
          />
        ))}
      </div>

      {/* Chips de arquivos */}
      {selectedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 py-1.5 border-t border-white/5 flex-shrink-0">
          {selectedFiles.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className="text-xs bg-white/10 px-2 py-1 rounded flex items-center gap-1.5 text-slate-300"
              data-testid="file-chip"
            >
              <span aria-hidden="true"><Icon name={mimeIconName(file.type)} size={14} /></span>
              <span className="max-w-[140px] truncate">{file.name}</span>
              <span className="text-slate-400">{formatFileSize(file.size)}</span>
              <button
                onClick={() => removeFile(index)}
                aria-label={`Remover arquivo ${file.name}`}
                className="text-slate-400 hover:text-white"
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
          className="mx-3 mb-1 border border-white/10 rounded bg-forest-950 shadow-xl overflow-hidden flex-shrink-0 max-h-40 overflow-y-auto"
        >
          {filtered.map((name, index) => (
            <li
              key={name}
              id={`chat-mention-option-${index}`}
              role="option"
              aria-selected={index === activeOption}
              className={`px-2 py-1.5 text-xs cursor-pointer ${
                index === activeOption ? 'bg-brand-700 text-white' : 'text-slate-200 hover:bg-white/10'
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
      <div className="p-3 border-t border-white/5 flex flex-col gap-2 flex-shrink-0">
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
          className="min-h-[40px] max-h-24 rounded bg-white/5 p-2 text-sm text-slate-100 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-1 focus:ring-moss-500"
        />
        <div className="flex items-center justify-between gap-2">
          <span
            data-testid="char-counter"
            className={`text-xs ${charOverflow ? 'text-red-400 font-medium' : 'text-slate-400'}`}
          >
            {input.length}/500
          </span>
          <div className="flex items-center gap-2">
            <label className="text-xs px-2 py-1.5 bg-white/10 rounded cursor-pointer text-slate-300 hover:bg-white/15">
              <span aria-hidden="true"><Icon name="paperclip" size={14} /></span> Anexar
              <input
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = '';
                }}
                accept="image/*,application/pdf,text/plain,audio/*,application/zip"
              />
            </label>
            <button
              onClick={send}
              disabled={!canSend}
              className="text-xs px-3 py-1.5 bg-brand-700 text-white rounded hover:bg-brand-800 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Enviar
            </button>
          </div>
        </div>
      </div>
    </aside>
  );

  if (isDesktop) {
    return <div className="w-80 flex-shrink-0 h-full transition-all">{panelContent}</div>;
  }

  // Mobile: drawer por cima do conteúdo
  return (
    <div className="fixed inset-0 z-40 bg-black/50 flex justify-end" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chat"
        className="w-full max-w-sm h-full"
      >
        {panelContent}
      </div>
    </div>
  );
}