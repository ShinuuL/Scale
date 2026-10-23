'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import type { RoomListItem } from '@/lib/validation';
import { roomUrl } from '@/lib/roomLink';

/** Cartao de sala da home ("Salas na rede" e "Salas recentes"). */
export function RoomCard({
  room,
  onEnter,
  onDelete,
}: {
  room: RoomListItem;
  onEnter: () => void;
  /** So presente quando quem ve pode apagar (canDelete). */
  onDelete?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = roomUrl(room.id);
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="group cursor-pointer rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 transition-colors duration-150 hover:border-white/[0.12] hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400 motion-reduce:transition-none"
      onClick={onEnter}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onEnter()}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm font-medium text-slate-200 truncate group-hover:text-white transition-colors">
              {room.name}
            </p>
            {room.isPersistent && (
              <Badge variant="success" className="shrink-0">Persistente</Badge>
            )}
            {!room.isPersistent && (
              <Badge variant="warning" className="shrink-0">Temporária</Badge>
            )}
          </div>
          <p className="text-xs text-slate-400">
            {room.participantCount === 1 ? '1 pessoa na sala' : `${room.participantCount} pessoas na sala`}
            {room.hasPassword ? ' · com senha' : ''}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleCopyLink}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-brand-400"
            title="Copiar link"
            aria-label={copied ? 'Link copiado' : 'Copiar link'}
          >
            <span aria-hidden="true">
              {copied ? <Icon name="check" size={14} /> : <Icon name="link" size={14} />}
            </span>
          </button>
          {room.canDelete && onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-red-400"
              title={`Apagar sala ${room.name}`}
              aria-label={`Apagar sala ${room.name}`}
              aria-haspopup="dialog"
            >
              <Icon name="trash" size={14} />
            </button>
          )}
          <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); onEnter(); }}>
            Entrar
          </Button>
        </div>
      </div>
    </div>
  );
}
