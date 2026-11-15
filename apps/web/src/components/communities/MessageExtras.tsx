'use client';

import { useEffect, useState } from 'react';
import { CHANNEL_REACTIONS, CHANNEL_REACTION_LABELS, type ChannelReaction } from '@scale/shared';
import { api, type ChannelMessage } from '@/lib/api';
import { AppModal } from '@/components/ui/AppModal';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';

/**
 * Fase 2 das mensagens de canal: citacao da resposta, reacoes (conjunto fixo,
 * icones SVG) e painel de mensagens fixadas. Separado do ChannelChat para
 * manter as mudancas localizadas.
 */
export const REACTION_ICONS: Record<ChannelReaction, IconName> = {
  like: 'thumbsUp', heart: 'heart', check: 'check', star: 'star', eyes: 'eye', alert: 'exclamation',
};

/** Nome acessivel do botao de reacao: "Curtir, 3 reações, você reagiu". */
export function reactionLabel(reaction: ChannelReaction, count: number, mine: boolean): string {
  const total = `${count} ${count === 1 ? 'reação' : 'reações'}`;
  return `${CHANNEL_REACTION_LABELS[reaction]}, ${total}${mine ? ', você reagiu' : ''}`;
}

/** Id do elemento da mensagem na lista (alvo do "ir para a original"). */
export const messageAnchorId = (id: string): string => `channel-message-${id}`;

/** Rola ate a mensagem se ela estiver carregada; devolve se achou. */
export function jumpToMessage(id: string): boolean {
  const el = document.getElementById(messageAnchorId(id));
  if (!el) return false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('bg-surface-secondary');
  window.setTimeout(() => el.classList.remove('bg-surface-secondary'), 1500);
  return true;
}

export function ReplyQuote({ replyTo, onJump }: { replyTo: NonNullable<ChannelMessage['replyTo']>; onJump: (id: string) => void }) {
  if (replyTo.deleted)
    return (
      <p className="mb-1 flex items-center gap-1 text-xs italic text-ink-muted">
        <Icon name="reply" size={14} />
        Resposta a uma mensagem apagada
      </p>
    );
  return (
    <button
      type="button"
      onClick={() => onJump(replyTo.id)}
      className="mb-1 flex max-w-full items-center gap-1 truncate text-left text-xs text-ink-muted hover:text-ink-primary"
      aria-label={`Resposta a ${replyTo.authorName}: ${replyTo.excerpt}. Ir para a mensagem original`}
    >
      <Icon name="reply" size={14} />
      <strong className="shrink-0">{replyTo.authorName}</strong>
      <span className="truncate">{replyTo.excerpt}</span>
    </button>
  );
}

export function ReactionBar({
  message,
  meId,
  onToggle,
}: {
  message: ChannelMessage;
  meId: string;
  onToggle: (reaction: ChannelReaction) => void;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {message.reactions.map(({ reaction, userIds }) => {
        const mine = userIds.includes(meId);
        return (
          <button
            key={reaction}
            type="button"
            aria-pressed={mine}
            aria-label={reactionLabel(reaction, userIds.length, mine)}
            title={CHANNEL_REACTION_LABELS[reaction]}
            onClick={() => onToggle(reaction)}
            className={`flex min-h-7 items-center gap-1 rounded-full border px-2 text-xs ${mine ? 'border-brand-300 text-brand-300' : 'border-line text-ink-muted'}`}
          >
            <Icon name={REACTION_ICONS[reaction]} size={14} />
            {userIds.length}
          </button>
        );
      })}
      <button
        type="button"
        className="room-icon-button !h-7 !w-7"
        aria-label="Adicionar reação"
        title="Adicionar reação"
        aria-expanded={picking}
        onClick={() => setPicking((open) => !open)}
      >
        <Icon name="smile" size={14} />
      </button>
      {picking && (
        <div role="group" aria-label="Escolher reação" className="flex gap-1">
          {CHANNEL_REACTIONS.map((reaction) => (
            <button
              key={reaction}
              type="button"
              className="room-icon-button !h-7 !w-7"
              aria-label={CHANNEL_REACTION_LABELS[reaction]}
              title={CHANNEL_REACTION_LABELS[reaction]}
              onClick={() => {
                setPicking(false);
                onToggle(reaction);
              }}
            >
              <Icon name={REACTION_ICONS[reaction]} size={14} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Painel "Mensagens fixadas" do cabecalho do canal (ate 50, mais recente primeiro). */
export function PinnedPanel({
  channelId,
  version,
  onClose,
  onJump,
}: {
  channelId: string;
  /** Muda quando alguma mensagem e fixada/desafixada: recarrega a lista. */
  version: number;
  onClose: () => void;
  onJump: (id: string) => void;
}) {
  const [messages, setMessages] = useState<ChannelMessage[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api
      .getChannelPins(channelId)
      .then((result) => {
        if (active) setMessages(result.messages);
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar as mensagens fixadas.');
      });
    return () => {
      active = false;
    };
  }, [channelId, version]);
  return (
    <AppModal title="Mensagens fixadas" icon="pin" onClose={onClose} closeLabel="Fechar mensagens fixadas">
      {error && <Banner variant="error">{error}</Banner>}
      {!messages && !error && <p role="status" className="text-sm text-ink-muted">Carregando...</p>}
      {messages?.length === 0 && <p className="text-sm text-ink-muted">Nenhuma mensagem fixada neste canal.</p>}
      {messages && messages.length > 0 && (
        <ul className="flex flex-col gap-3">
          {messages.map((message) => (
            <li key={message.id} className="rounded-lg border border-line p-3">
              <div className="flex items-baseline gap-2 text-xs text-ink-muted">
                <strong className="text-sm text-ink-primary">{message.author.name}</strong>
                <time dateTime={message.createdAt}>{timeFormatter.format(new Date(message.createdAt))}</time>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-ink-secondary">{message.content}</p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-1 min-h-8"
                aria-label={`Ir para a mensagem de ${message.author.name}`}
                onClick={() => {
                  onClose();
                  onJump(message.id);
                }}
              >
                Ir para a mensagem
              </Button>
            </li>
          ))}
        </ul>
      )}
    </AppModal>
  );
}
