'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { USERNAME_MAX, usernameSchema, type DirectMessage, type FriendsList, type PublicUser } from '@scale/shared';
import { api, type MeUser } from '@/lib/api';
import { useUserEvents } from '@/hooks/useUserEvents';
import { roomPath } from '@/lib/roomLink';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Logo } from '@/components/ui/Logo';
import { ProfileMenu } from '@/components/ui/ProfileMenu';
import { DirectChat } from '@/components/friends/DirectChat';
import { UserAvatar } from '@/components/friends/UserAvatar';

const EMPTY: FriendsList = { friends: [], incoming: [], outgoing: [] };

function requestError(err: unknown): string {
  const e = err as { status?: number; error?: string };
  if (e.status === 404) return 'Ninguém com esse @nome.';
  if (e.status === 400 && e.error === 'Cannot add yourself') return 'Esse é o seu próprio @nome.';
  if (e.status === 409 && e.error === 'Already friends') return 'Vocês já são amigos.';
  if (e.status === 409) return 'Pedido já enviado.';
  if (e.status === 429) return 'Muitos pedidos seguidos. Tente mais tarde.';
  return 'Não foi possível enviar o pedido.';
}

/** Escolha do @nome quando a conta ainda não tem um (exigido para amizades). */
function UsernameSetup({ onSaved }: { onSaved: (user: MeUser) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const parsed = usernameSchema.safeParse(value);

  return (
    <form
      className="glass mx-auto max-w-md space-y-4 rounded-2xl p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!parsed.success) return;
        setSaving(true);
        setError(null);
        try {
          onSaved((await api.setUsername(parsed.data)).user);
        } catch (err) {
          setError(
            (err as { status?: number }).status === 409
              ? 'Esse @nome já está em uso. Escolha outro.'
              : 'Não foi possível salvar o @nome.',
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <div>
        <h2 className="text-base font-semibold text-white">Escolha seu @nome</h2>
        <p className="mt-1 text-sm text-slate-400">É por ele que seus amigos encontram você.</p>
      </div>
      <Input
        id="setup-username"
        label="@nome"
        value={value}
        maxLength={USERNAME_MAX + 1}
        onChange={(e) => setValue(e.target.value)}
        autoComplete="username"
        spellCheck={false}
        placeholder="ex.: shinuu"
        error={error ?? (value.trim() && !parsed.success ? parsed.error.issues[0]?.message : undefined)}
        helperText="Letras sem acento, números e _, de 3 a 20 caracteres."
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={!parsed.success || saving} aria-busy={saving}>
          {saving ? 'Salvando...' : 'Salvar @nome'}
        </Button>
      </div>
    </form>
  );
}

export default function FriendsPage() {
  const [me, setMe] = useState<MeUser | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'guest' | 'ready'>('loading');
  const [list, setList] = useState<FriendsList>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [incomingByFriend, setIncomingByFriend] = useState<Record<string, DirectMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [addValue, setAddValue] = useState('');
  const [addStatus, setAddStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api
      .getMe()
      .then((res) => {
        setMe(res.user);
        setAuthState('ready');
      })
      .catch(() => setAuthState('guest'));
  }, []);

  const refresh = useCallback(() => {
    api
      .getFriends()
      .then(setList)
      .catch(() => {});
  }, []);

  const hasUsername = !!me?.username;
  useEffect(() => {
    if (authState === 'ready' && hasUsername) refresh();
  }, [authState, hasUsername, refresh]);

  useUserEvents(authState === 'ready', {
    onFriendsChanged: refresh,
    onDirectMessage: (m) => {
      if (!me) return;
      if (m.senderId !== me.id) window.dispatchEvent(new CustomEvent('scale:notification', { detail: { tag: 'direct-message' } }));
      const friendId = m.senderId === me.id ? m.recipientId : m.senderId;
      setIncomingByFriend((prev) => ({ ...prev, [friendId]: [...(prev[friendId] ?? []), m] }));
      if (m.senderId !== me.id && friendId !== selectedId) {
        setUnread((prev) => ({ ...prev, [friendId]: (prev[friendId] ?? 0) + 1 }));
      }
    },
  });

  // Amigo removido some da conversa aberta.
  const selected: PublicUser | null = list.friends.find((f) => f.id === selectedId) ?? null;
  useEffect(() => {
    if (selectedId && !list.friends.some((f) => f.id === selectedId) && list !== EMPTY) setSelectedId(null);
  }, [list, selectedId]);

  // Liga: o servidor cria a sala privada e faz a tela do amigo tocar; quem
  // liga entra na sala e espera la (o cartao "Chamando…" vem do CallCenter).
  const [callingId, setCallingId] = useState<string | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const callFriend = async (friendId: string) => {
    setCallingId(friendId);
    setCallError(null);
    try {
      const { roomId } = await api.startCall(friendId);
      window.location.href = roomPath(roomId);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setCallError(status === 429 ? 'Muitas ligações seguidas. Espere um pouco.' : 'Não foi possível ligar agora.');
      setCallingId(null);
    }
  };

  const openChat = (id: string) => {
    setSelectedId(id);
    setUnread((prev) => ({ ...prev, [id]: 0 }));
  };

  const addFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = usernameSchema.safeParse(addValue);
    if (!parsed.success) {
      setAddStatus({ kind: 'error', text: parsed.error.issues[0]?.message ?? '@nome inválido.' });
      return;
    }
    setAdding(true);
    setAddStatus(null);
    try {
      const res = await api.sendFriendRequest(parsed.data);
      setAddStatus({
        kind: 'ok',
        text: res.status === 'ACCEPTED' ? 'Vocês agora são amigos.' : `Pedido enviado para @${parsed.data}.`,
      });
      setAddValue('');
      refresh();
    } catch (err) {
      setAddStatus({ kind: 'error', text: requestError(err) });
    } finally {
      setAdding(false);
    }
  };

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } finally {
      refresh();
    }
  };

  const sectionTitle = 'px-1 pb-2 text-xs font-medium uppercase tracking-wide text-slate-400';

  return (
    <main id="main-content" className="flex h-[100dvh] flex-col">
      <header className="border-b border-white/[0.06] bg-forest-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Link href="/" className="group flex items-center gap-2">
              <Logo variant="mark" size={28} />
              <span className="text-base font-bold tracking-tight text-white transition-colors group-hover:text-brand-300">
                Scale
              </span>
            </Link>
            <span aria-hidden="true" className="text-slate-600">/</span>
            <h1 className="text-sm font-semibold text-slate-200">Amigos</h1>
          </div>
          {authState === 'ready' && me && (
            <ProfileMenu name={me.name} email={me.email} isAuthenticated user={me} onUserChange={setMe} />
          )}
        </div>
      </header>

      {authState === 'loading' && <p className="p-8 text-center text-sm text-slate-400">Carregando...</p>}

      {authState === 'guest' && (
        <div className="glass mx-auto mt-10 max-w-md space-y-3 rounded-2xl p-6 text-center">
          <p className="text-sm text-slate-300">Amizades e mensagens privadas exigem uma conta.</p>
          <div className="flex justify-center gap-2">
            <Link href="/login" className="btn-primary text-sm">
              Entrar
            </Link>
            <Link href="/register" className="btn-secondary text-sm">
              Criar conta
            </Link>
          </div>
        </div>
      )}

      {authState === 'ready' && me && !hasUsername && (
        <div className="p-4 pt-10">
          <UsernameSetup onSaved={setMe} />
        </div>
      )}

      {authState === 'ready' && me && hasUsername && (
        <div className="mx-auto grid min-h-0 w-full max-w-6xl flex-1 md:grid-cols-[320px_1fr] md:gap-4 md:p-4">
          <aside
            aria-label="Amigos e pedidos"
            className={clsx(
              'min-h-0 space-y-6 overflow-y-auto p-4 md:rounded-2xl md:border md:border-white/[0.08] md:bg-forest-900/60',
              selected && 'hidden md:block',
            )}
          >
            <form onSubmit={(e) => void addFriend(e)} className="space-y-2">
              <h2 className={sectionTitle}>Adicionar amigo</h2>
              <p className="px-1 text-xs text-slate-400">
                Seu @nome: <span className="font-medium text-slate-200">@{me.username}</span>
              </p>
              <div className="flex gap-2">
                <label htmlFor="add-friend" className="sr-only">
                  @nome do amigo
                </label>
                <input
                  id="add-friend"
                  value={addValue}
                  onChange={(e) => setAddValue(e.target.value)}
                  maxLength={USERNAME_MAX + 1}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="@nome do amigo"
                  className="input-base min-w-0 flex-1"
                />
                <Button type="submit" disabled={!addValue.trim() || adding} aria-busy={adding}>
                  Adicionar
                </Button>
              </div>
              {addStatus && (
                <p
                  role={addStatus.kind === 'error' ? 'alert' : 'status'}
                  className={clsx('px-1 text-xs', addStatus.kind === 'error' ? 'text-red-300' : 'text-brand-200')}
                >
                  {addStatus.text}
                </p>
              )}
            </form>

            {list.incoming.length > 0 && (
              <section aria-labelledby="incoming-title">
                <h2 id="incoming-title" className={sectionTitle}>
                  Pedidos recebidos ({list.incoming.length})
                </h2>
                <ul className="space-y-1">
                  {list.incoming.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                      <UserAvatar userId={r.user.id} name={r.user.name} avatarUpdatedAt={r.user.avatarUpdatedAt} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-white">{r.user.name}</p>
                        <p className="truncate text-xs text-slate-400">@{r.user.username}</p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void act(() => api.acceptFriendRequest(r.id))}
                        aria-label={`Aceitar pedido de ${r.user.name}`}
                      >
                        <Icon name="check" size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void act(() => api.deleteFriendRequest(r.id))}
                        aria-label={`Recusar pedido de ${r.user.name}`}
                      >
                        <Icon name="close" size={14} />
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section aria-labelledby="friends-title">
              <h2 id="friends-title" className={sectionTitle}>
                Amigos ({list.friends.length})
              </h2>
              {callError && (
                <p role="alert" className="mb-2 px-1 text-sm text-red-400">
                  {callError}
                </p>
              )}
              {list.friends.length === 0 ? (
                <p className="px-1 text-sm text-slate-400">Adicione alguém pelo @nome para começar a conversar.</p>
              ) : (
                <ul className="space-y-1">
                  {list.friends.map((f) => {
                    const count = unread[f.id] ?? 0;
                    return (
                      <li key={f.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openChat(f.id)}
                          aria-current={selectedId === f.id ? 'true' : undefined}
                          className={clsx(
                            'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400',
                            selectedId === f.id && 'bg-white/[0.08]',
                          )}
                        >
                          <UserAvatar userId={f.id} name={f.name} avatarUpdatedAt={f.avatarUpdatedAt} size="sm" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-white">{f.name}</span>
                            <span className="block truncate text-xs text-slate-400">@{f.username}</span>
                          </span>
                          {count > 0 && (
                            <span className="rounded-full bg-brand-500 px-2 py-0.5 text-xs font-semibold text-white">
                              {count}
                              <span className="sr-only"> mensagens novas</span>
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => void callFriend(f.id)}
                          disabled={callingId !== null}
                          aria-label={`Ligar para ${f.name}`}
                          title={`Ligar para ${f.name}`}
                          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-emerald-500/15 hover:text-emerald-300 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"
                        >
                          <Icon name="phone" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {list.outgoing.length > 0 && (
              <section aria-labelledby="outgoing-title">
                <h2 id="outgoing-title" className={sectionTitle}>
                  Pedidos enviados
                </h2>
                <ul className="space-y-1">
                  {list.outgoing.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                      <UserAvatar userId={r.user.id} name={r.user.name} avatarUpdatedAt={r.user.avatarUpdatedAt} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-white">{r.user.name}</p>
                        <p className="truncate text-xs text-slate-400">Aguardando @{r.user.username}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void act(() => api.deleteFriendRequest(r.id))}
                        aria-label={`Cancelar pedido para ${r.user.name}`}
                      >
                        Cancelar
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </aside>

          <div
            className={clsx(
              'min-h-0 md:rounded-2xl md:border md:border-white/[0.08] md:bg-forest-900/60',
              !selected && 'hidden md:flex md:items-center md:justify-center',
            )}
          >
            {selected ? (
              <DirectChat
                key={selected.id}
                meId={me.id}
                friend={selected}
                incoming={incomingByFriend[selected.id] ?? []}
                onBack={() => setSelectedId(null)}
                onCall={() => void callFriend(selected.id)}
                calling={callingId === selected.id}
                onRemoveFriend={() =>
                  void act(async () => {
                    await api.removeFriend(selected.id);
                    setSelectedId(null);
                  })
                }
              />
            ) : (
              <p className="flex items-center gap-2 text-sm text-slate-400">
                <Icon name="chat" />
                Escolha um amigo para conversar.
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
