'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { PublicUser } from '@scale/shared';
import { api } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { UserAvatar } from '@/components/friends/UserAvatar';
import { OUTGOING_CALL_ENDED_EVENT, type OutgoingCallEndedDetail } from '@/components/calls/CallCenter';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type RowState = 'idle' | 'calling' | 'called' | 'accepted' | 'error';

const ENDED_TEXT: Record<OutgoingCallEndedDetail['reason'], string> = {
  accepted: 'Atendeu',
  declined: 'Recusou',
  cancelled: 'Cancelada',
  missed: 'Não atendeu',
};

function callError(err: unknown): string {
  const e = err as { status?: number; error?: string };
  if (e.status === 409 && e.error === 'Already in room') return 'Já está na chamada.';
  if (e.status === 409) return 'A sala está cheia.';
  if (e.status === 429) return 'Muitas chamadas seguidas.';
  if (e.status === 403) return 'Entre na sala antes de chamar.';
  return 'Não foi possível chamar.';
}

export interface InviteFriendsDialogProps {
  roomId: string;
  onClose: () => void;
}

/**
 * "Chamar para a chamada": lista os amigos e faz a tela de quem for escolhido
 * tocar com o convite desta sala. Foco preso no dialogo; Esc fecha.
 */
export function InviteFriendsDialog({ roomId, onClose }: InviteFriendsDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [friends, setFriends] = useState<PublicUser[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState('');
  const [rows, setRows] = useState<Record<string, { state: RowState; message?: string }>>({});

  useEffect(() => {
    api
      .getFriends()
      .then((r) => setFriends(r.friends))
      .catch(() => setLoadError(true));
  }, []);

  // Fim do toque (atendeu, recusou, nao atendeu): mostra e libera chamar de novo.
  useEffect(() => {
    const onEnded = (e: Event) => {
      const { peerId, reason } = (e as CustomEvent<OutgoingCallEndedDetail>).detail;
      setRows((prev) =>
        prev[peerId]
          ? {
              ...prev,
              [peerId]: reason === 'accepted' ? { state: 'accepted' } : { state: 'error', message: ENDED_TEXT[reason] },
            }
          : prev,
      );
    };
    window.addEventListener(OUTGOING_CALL_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(OUTGOING_CALL_ENDED_EVENT, onEnded);
  }, []);

  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  const call = async (friend: PublicUser) => {
    setRows((prev) => ({ ...prev, [friend.id]: { state: 'calling' } }));
    try {
      await api.startCall(friend.id, roomId);
      setRows((prev) => ({ ...prev, [friend.id]: { state: 'called' } }));
    } catch (err) {
      setRows((prev) => ({ ...prev, [friend.id]: { state: 'error', message: callError(err) } }));
    }
  };

  const term = filter.trim().replace(/^@/, '').toLowerCase();
  const visible = (friends ?? []).filter(
    (f) => !term || f.name.toLowerCase().includes(term) || (f.username ?? '').includes(term),
  );

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-forest-950/70 p-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-friends-title"
        onKeyDown={handleKeyDown}
        className="glass flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl animate-slide-up"
      >
        <header className="flex items-center justify-between border-b border-white/[0.08] px-5 py-4">
          <div>
            <h2 id="invite-friends-title" className="text-base font-semibold text-white">
              Chamar para a chamada
            </h2>
            <p className="text-xs text-slate-400">O amigo recebe a chamada e entra direto nesta sala.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white/[0.06] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="px-5 pt-4">
          <label htmlFor="invite-friends-filter" className="sr-only">
            Procurar amigo
          </label>
          <input
            id="invite-friends-filter"
            data-autofocus
            className="input-base"
            placeholder="Procurar por nome ou @nome"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {loadError ? (
            <p className="px-2 py-4 text-sm text-red-400">Não foi possível carregar seus amigos.</p>
          ) : friends === null ? (
            <p className="px-2 py-4 text-sm text-slate-400">Carregando…</p>
          ) : friends.length === 0 ? (
            <p className="px-2 py-4 text-sm text-slate-400">
              Você ainda não tem amigos.{' '}
              <Link href="/friends" className="text-brand-300 underline">
                Adicionar pelo @nome
              </Link>
            </p>
          ) : visible.length === 0 ? (
            <p className="px-2 py-4 text-sm text-slate-400">Ninguém com esse nome.</p>
          ) : (
            <ul className="space-y-1">
              {visible.map((f) => {
                const row = rows[f.id] ?? { state: 'idle' as RowState };
                return (
                  <li key={f.id} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04]">
                    <UserAvatar userId={f.id} name={f.name} avatarUpdatedAt={f.avatarUpdatedAt} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-white">{f.name}</span>
                      <span className="block truncate text-xs text-slate-400">
                        {row.state === 'error' ? (
                          <span className="text-red-400">{row.message}</span>
                        ) : row.state === 'called' ? (
                          <span className="text-emerald-300">Chamando…</span>
                        ) : row.state === 'accepted' ? (
                          <span className="text-emerald-300">Atendeu</span>
                        ) : (
                          `@${f.username}`
                        )}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => void call(f)}
                      disabled={row.state === 'calling' || row.state === 'called' || row.state === 'accepted'}
                      aria-label={`Chamar ${f.name} para a chamada`}
                      className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                    >
                      <Icon name={row.state === 'called' || row.state === 'accepted' ? 'check' : 'phone'} size={14} />
                      {row.state === 'called' ? 'Chamado' : row.state === 'accepted' ? 'Na chamada' : row.state === 'error' ? 'De novo' : 'Chamar'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
