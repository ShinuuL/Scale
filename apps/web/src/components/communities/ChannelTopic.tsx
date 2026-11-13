'use client';

import { useState } from 'react';
import { CHANNEL_TOPIC_MAX } from '@scale/shared';
import { Button } from '@/components/ui/Button';

/**
 * Topico no cabecalho do canal: uma linha truncada, texto completo na dica
 * (`title`) e no DOM. Quem pode gerenciar canais edita ali mesmo.
 */
export function ChannelTopic({
  topic,
  canEdit,
  onSave,
}: {
  topic: string | null;
  canEdit: boolean;
  onSave?: (topic: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (editing && onSave) {
    return (
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          onSave(draft.trim())
            .then(() => setEditing(false))
            .catch(() => setError('Não foi possível salvar o tópico.'))
            .finally(() => setBusy(false));
        }}
      >
        <label className="sr-only" htmlFor="channel-topic-input">
          Tópico do canal
        </label>
        <input
          id="channel-topic-input"
          autoFocus
          value={draft}
          maxLength={CHANNEL_TOPIC_MAX}
          placeholder="Sobre o que é este canal"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-secondary px-2 py-1 text-sm text-ink-primary"
        />
        <Button type="submit" size="sm" disabled={busy}>
          Salvar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
          Cancelar
        </Button>
        {error && (
          <span role="alert" className="w-full text-xs text-red-400">
            {error}
          </span>
        )}
      </form>
    );
  }
  if (!topic && !canEdit) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {topic ? (
        <p className="min-w-0 flex-1 truncate text-sm text-ink-muted" title={topic}>
          {topic}
        </p>
      ) : (
        <span className="flex-1" />
      )}
      {canEdit && onSave && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setDraft(topic ?? '');
            setEditing(true);
          }}
        >
          {topic ? 'Editar tópico' : 'Definir tópico'}
        </Button>
      )}
    </div>
  );
}
