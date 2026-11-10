'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { PublicUser } from '@scale/shared';
import { api } from '@/lib/api';
import { AppModal } from '@/components/ui/AppModal';
import { Icon } from '@/components/ui/Icon';
import { UserAvatar } from '@/components/friends/UserAvatar';
import {
  OUTGOING_CALL_ENDED_EVENT,
  type OutgoingCallEndedDetail,
} from '@/components/calls/CallCenter';

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
 * tocar com o convite desta sala. AppModal (react-aria): foco preso, Esc e
 * clique fora fecham, foco volta a quem abriu.
 */
export function InviteFriendsDialog({ roomId, onClose }: InviteFriendsDialogProps) {
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
              [peerId]:
                reason === 'accepted'
                  ? { state: 'accepted' }
                  : { state: 'error', message: ENDED_TEXT[reason] },
            }
          : prev,
      );
    };
    window.addEventListener(OUTGOING_CALL_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(OUTGOING_CALL_ENDED_EVENT, onEnded);
  }, []);

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
    <AppModal
      title="Chamar para a chamada"
      closeLabel="Fechar"
      onClose={onClose}
      size="sm"
      describedBy="invite-friends-desc"
    >
      <p id="invite-friends-desc" className="-mt-3 mb-4 text-xs text-ink-muted">
        O amigo recebe a chamada e entra direto nesta sala.
      </p>
      <div>
        <label htmlFor="invite-friends-filter" className="sr-only">
          Procurar amigo
        </label>
        <input
          id="invite-friends-filter"
          autoFocus
          className="input-base"
          placeholder="Procurar por nome ou @nome"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="-mx-2 mt-3 max-h-[50vh] overflow-y-auto">
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
                <li
                  key={f.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-white/[0.04]"
                >
                  <UserAvatar
                    userId={f.id}
                    name={f.name}
                    avatarUpdatedAt={f.avatarUpdatedAt}
                    size="sm"
                  />
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
                    disabled={
                      row.state === 'calling' || row.state === 'called' || row.state === 'accepted'
                    }
                    aria-label={`Chamar ${f.name} para a chamada`}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3 text-xs font-medium text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                  >
                    <Icon
                      name={row.state === 'called' || row.state === 'accepted' ? 'check' : 'phone'}
                      size={14}
                    />
                    {row.state === 'called'
                      ? 'Chamado'
                      : row.state === 'accepted'
                        ? 'Na chamada'
                        : row.state === 'error'
                          ? 'De novo'
                          : 'Chamar'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </AppModal>
  );
}
