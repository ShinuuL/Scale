'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import type { RoomListItem } from '@/lib/validation';
import { roomUrl } from '@/lib/roomLink';
import { copyText } from '@/lib/clipboard';

/** A room is a row with separate, keyboard-accessible actions. */
export function RoomCard({
  room,
  onEnter,
  onDelete,
  onRemoveRecent,
}: {
  room: RoomListItem;
  onEnter: () => void;
  onDelete?: () => void;
  /** Tira a sala só da lista local de recentes; não apaga a sala. */
  onRemoveRecent?: () => void;
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  async function handleCopyLink() {
    const copied = await copyText(roomUrl(room.id));
    setCopyStatus(copied ? 'copied' : 'error');
  }
  return (
    <div className="room-row">
      <button type="button" onClick={onEnter} className="room-row-main" aria-label={`Entrar na sala ${room.name}`}>
        <span className="room-row-icon"><Icon name={room.hasPassword ? 'lock' : 'speaker'} size={20} /></span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-ink-primary">{room.name}</span>
          <span className="mt-1 block text-xs leading-5 text-ink-secondary">{room.participantCount === 1 ? '1 pessoa na sala' : `${room.participantCount} pessoas na sala`}<span className="mx-1.5" aria-hidden="true">·</span>{room.isPersistent ? 'Persistente' : 'Temporária'}{room.hasPassword ? ' · Com senha' : ''}</span>
        </span>
      </button>
      <div className="room-row-actions">
        <button type="button" onClick={() => void handleCopyLink()} className="room-icon-button" title="Copiar link" aria-label={copyStatus === 'copied' ? 'Link copiado' : `Copiar link da sala ${room.name}`}><Icon name={copyStatus === 'copied' ? 'check' : 'link'} size={17} /></button>
        {onRemoveRecent && <button type="button" onClick={onRemoveRecent} className="room-icon-button" title="Remover das recentes" aria-label={`Remover ${room.name} das recentes`}><Icon name="close" size={17} /></button>}
        {room.canDelete && onDelete && <button type="button" onClick={onDelete} className="room-icon-button hover:!text-red-300" title={`Apagar sala ${room.name}`} aria-label={`Apagar sala ${room.name}`} aria-haspopup="dialog"><Icon name="trash" size={17} /></button>}
        <button type="button" className="room-icon-button room-enter-label" onClick={onEnter} aria-label={`Abrir sala ${room.name}`}><Icon name="arrowRight" size={18} /></button>
      </div>
      {copyStatus !== 'idle' && <p role="status" className={copyStatus === 'error' ? 'w-full text-xs text-red-300' : 'sr-only'}>{copyStatus === 'copied' ? 'Link copiado.' : 'Não foi possível copiar o link. Entre na sala e copie o endereço do navegador.'}</p>}
    </div>
  );
}
