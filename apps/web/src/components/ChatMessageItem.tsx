'use client';

import { useState } from 'react';
import type { ChatMessage } from '@/hooks/useChat';
import { downloadRoomFile } from '@/lib/roomAccess';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Escapa HTML, transforma URLs https?:// em anchors (`target="_blank" rel="noopener"`)
 * e destaca menções `@peer` apenas para peers atuais na sala. Retorna HTML string
 * para uso com `dangerouslySetInnerHTML` — XSS bloqueado pelo escape prévio.
 */
export function linkifyAndHighlight(text: string, peers: string[]): string {
  let escaped = escapeHtml(text);

  // Linkify: aplicado sobre o texto já escapado; `&amp;` em URLs é decodificado
  // pelo parser de atributos do HTML.
  escaped = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="underline text-accent hover:text-accent">$1</a>',
  );

  // Menções: peer escapado tanto no padrão quanto na substituição.
  for (const peer of peers) {
    const escapedPeer = escapeHtml(peer);
    const re = new RegExp(`@${escapeRegExp(escapedPeer)}(?![\\w.-])`, 'g');
    escaped = escaped.replace(
      re,
      `<span class="bg-accent-subtle text-accent rounded px-0.5">@${escapedPeer}</span>`,
    );
  }

  return escaped;
}

export interface ChatMessageItemProps {
  message: ChatMessage;
  isOwn: boolean;
  isOwner: boolean;
  currentPeers: string[];
  onEdit: (id: string, content: string) => void;
  onDelete: (id: string) => void;
  /** Room ticket do join-room — vai no header X-Room-Ticket do download. */
  roomTicket?: string | null;
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

export function ChatMessageItem({
  message,
  isOwn,
  isOwner,
  currentPeers,
  onEdit,
  onDelete,
  roomTicket,
}: ChatMessageItemProps) {
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const isDeleted = Boolean(message.deletedAt);
  const withinWindow = Date.now() - new Date(message.createdAt).getTime() < EDIT_WINDOW_MS;
  const canEdit = isOwn && !isDeleted && withinWindow;
  const canDelete = (isOwn || isOwner) && !isDeleted;

  const authorName = message.guestName ?? 'Anon';

  if (message.system) {
    return (
      <div className="px-3 py-1.5 text-center">
        <span className="text-xs italic text-ink-muted">{message.content}</span>
      </div>
    );
  }

  return (
    <div className="group px-3 py-2 rounded-lg hover:bg-surface-hover" data-testid="chat-message">
      <div className="flex items-baseline gap-2 text-xs text-ink-muted">
        <span className="font-medium text-ink-primary">{authorName}</span>
        {(message.edited || message.editedAt) && !isDeleted && (
          <span className="italic">(editado)</span>
        )}
        {isDeleted && <span className="italic">[apagada]</span>}
      </div>

      {editing ? (
        <div className="mt-1 flex gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            aria-label="Editar mensagem"
            className="flex-1 min-h-[40px] rounded bg-surface-tertiary p-2 text-sm text-ink-primary resize-none focus:outline-none focus:ring-1 focus:ring-accent"
          />
          <button
            onClick={() => {
              onEdit(message.id, draft);
              setEditing(false);
            }}
            className="text-xs px-2 py-1 bg-accent-solid rounded text-white hover:bg-accent-solid"
          >
            Salvar
          </button>
          <button
            onClick={() => setEditing(false)}
            className="text-xs px-2 py-1 bg-surface-tertiary rounded text-ink-secondary hover:bg-surface-hover"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <div
          className="mt-1 text-sm text-ink-primary break-words [overflow-wrap:anywhere]"
          data-testid="message-content"
          dangerouslySetInnerHTML={{
            __html: isDeleted
              ? '[mensagem apagada]'
              : linkifyAndHighlight(message.content, currentPeers),
          }}
        />
      )}

      {message.files && message.files.length > 0 && !isDeleted && (
        <ul className="mt-2 space-y-1">
          {message.files.map((file) => (
            <li key={file.id}>
              <a
                href={`/api/files/${file.id}`}
                // Download exige participacao (room ticket): o <a href> nao
                // envia header, entao o clique baixa via fetch com o ticket no
                // header (nunca na URL).
                onClick={(event) => {
                  event.preventDefault();
                  setDownloadError(null);
                  downloadRoomFile(file.id, file.filename, roomTicket).catch((err: unknown) => {
                    setDownloadError(
                      err instanceof Error
                        ? err.message
                        : 'Não foi possível baixar o arquivo. Tente novamente.',
                    );
                  });
                }}
                target="_blank"
                rel="noopener"
                className="text-xs underline text-accent hover:text-accent"
              >
                {file.filename} · {formatFileSize(file.size)}
              </a>
            </li>
          ))}
        </ul>
      )}

      {downloadError && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {downloadError}
        </p>
      )}
      <div className="mt-1 flex gap-3">
        {canEdit && !editing && (
          <button
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
            className="text-xs text-ink-muted hover:text-ink-primary"
          >
            Editar
          </button>
        )}
        {canDelete && (
          <button
            onClick={() => onDelete(message.id)}
            className="text-xs text-red-300/80 hover:text-red-300"
          >
            Apagar
          </button>
        )}
      </div>
    </div>
  );
}
