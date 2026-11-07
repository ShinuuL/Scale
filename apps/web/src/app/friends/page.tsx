'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import {
  USERNAME_MAX,
  usernameSchema,
  type DirectMessage,
  type FriendsList,
  type PublicUser,
} from '@scale/shared';
import { api, type MeUser } from '@/lib/api';
import { useUserEvents } from '@/hooks/useUserEvents';
import { roomPath } from '@/lib/roomLink';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { AppShell } from '@/components/layout/AppShell';
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
      className="mx-auto max-w-md space-y-4 p-6"
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
        <p className="mt-1 text-sm text-ink-muted">É por ele que seus amigos encontram você.</p>
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
        error={
          error ?? (value.trim() && !parsed.success ? parsed.error.issues[0]?.message : undefined)
        }
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
  const [authState, setAuthState] = useState<'loading' | 'guest' | 'ready' | 'error'>('loading');
  const [authAttempt, setAuthAttempt] = useState(0);
  const [list, setList] = useState<FriendsList>(EMPTY);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [incomingByFriend, setIncomingByFriend] = useState<Record<string, DirectMessage[]>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [addValue, setAddValue] = useState('');
  const [addStatus, setAddStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<'conversations' | 'manage'>('conversations');
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setAuthState('loading');
    api
      .getMe()
      .then((res) => {
        setMe(res.user);
        setAuthState('ready');
      })
      .catch((error: unknown) =>
        setAuthState((error as { status?: number }).status === 401 ? 'guest' : 'error'),
      );
  }, [authAttempt]);

  const refresh = useCallback(() => {
    api
      .getFriends()
      .then((result) => {
        setList(result);
        setListState('ready');
      })
      .catch(() => setListState('error'));
  }, []);

  const hasUsername = !!me?.username;
  useEffect(() => {
    if (authState === 'ready' && hasUsername) refresh();
  }, [authState, hasUsername, refresh]);

  useUserEvents(authState === 'ready', {
    onFriendsChanged: refresh,
    onDirectMessage: (m) => {
      if (!me) return;
      if (m.senderId !== me.id)
        window.dispatchEvent(
          new CustomEvent('scale:notification', { detail: { tag: 'direct-message' } }),
        );
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
    if (selectedId && !list.friends.some((f) => f.id === selectedId) && list !== EMPTY)
      setSelectedId(null);
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
    setView('conversations');
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
        text:
          res.status === 'ACCEPTED'
            ? 'Vocês agora são amigos.'
            : `Pedido enviado para @${parsed.data}.`,
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
    setActionError(null);
    try {
      await fn();
    } catch {
      setActionError('Não foi possível atualizar a amizade. Tente novamente.');
    } finally {
      refresh();
    }
  };

  const context =
    authState === 'ready' && me && hasUsername ? (
      <div className="flex h-full flex-col">
        <div className="border-b border-line p-4">
          <h2 className="text-base font-semibold text-ink-primary">Amigos</h2>
          <p className="mt-1 truncate text-sm text-ink-muted">@{me.username}</p>
          <button
            type="button"
            onClick={() => {
              setView('manage');
              setSelectedId(null);
            }}
            aria-current={view === 'manage' ? 'page' : undefined}
            className={clsx(
              'mt-4 flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-ink-secondary hover:bg-surface-hover',
              view === 'manage' && 'bg-accent-subtle text-accent',
            )}
          >
            <Icon name="users" />
            <span className="flex-1">Gerenciar amigos</span>
            {list.incoming.length > 0 && (
              <span
                className="rounded-full bg-accent-solid px-2 py-0.5 text-xs text-white"
                aria-label={`${list.incoming.length} pedidos recebidos`}
              >
                {list.incoming.length}
              </span>
            )}
          </button>
        </div>
        <div className="p-3">
          {callError && <p role="alert" className="px-2 py-2 text-sm text-red-400">{callError}</p>}
          <h2 className="px-2 py-2 text-sm font-semibold text-ink-secondary">Conversas</h2>
          {listState === 'loading' && (
            <p role="status" className="p-2 text-sm text-ink-muted">
              Carregando amigos…
            </p>
          )}
          {listState === 'error' && (
            <div role="alert" className="p-2 text-sm text-ink-secondary">
              <p>Não foi possível carregar seus amigos.</p>
              <Button variant="ghost" size="sm" onClick={refresh}>
                Tentar novamente
              </Button>
            </div>
          )}
          {listState === 'ready' && list.friends.length === 0 && (
            <p className="px-2 py-3 text-sm leading-6 text-ink-muted">
              Adicione um amigo pelo @nome para abrir uma conversa.
            </p>
          )}
          <ul className="space-y-1">
            {list.friends.map((friend) => (
              <li key={friend.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openChat(friend.id)}
                  aria-current={selectedId === friend.id ? 'page' : undefined}
                  className={clsx(
                    'flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-hover',
                    selectedId === friend.id && 'bg-accent-subtle',
                  )}
                >
                  <UserAvatar
                    userId={friend.id}
                    name={friend.name}
                    avatarUpdatedAt={friend.avatarUpdatedAt}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-primary">
                      {friend.name}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      @{friend.username}
                    </span>
                  </span>
                  {(unread[friend.id] ?? 0) > 0 && (
                    <span className="rounded-full bg-accent-solid px-2 py-0.5 text-xs text-white">
                      {unread[friend.id]}
                      <span className="sr-only"> mensagens novas nesta sessão</span>
                    </span>
                  )}
                </button>
                <Button variant="ghost" size="sm" onClick={() => void callFriend(friend.id)} disabled={callingId !== null} aria-label={`Ligar para ${friend.name}`}>
                  <Icon name="phone" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-auto px-5 py-4 text-xs leading-5 text-ink-muted">
          As mensagens novas são sinalizadas enquanto esta página está aberta.
        </p>
      </div>
    ) : undefined;

  return (
    <AppShell
      activeSection="friends"
      title="Amigos"
      contextSidebar={context}
      accountSlot={
        authState === 'ready' && me ? (
          <ProfileMenu
            name={me.name}
            email={me.email}
            isAuthenticated
            user={me}
            onUserChange={setMe}
          />
        ) : undefined
      }
      actions={
        authState === 'ready' && hasUsername ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setView('manage');
              setSelectedId(null);
            }}
          >
            Adicionar amigo
          </Button>
        ) : undefined
      }
    >
      {authState === 'loading' && (
        <p role="status" className="p-8 text-sm text-ink-muted">
          Carregando sua conta…
        </p>
      )}
      {authState === 'error' && (
        <section role="alert" className="m-auto max-w-md p-6 text-center">
          <h2 className="text-xl font-semibold text-ink-primary">Sua conta não carregou</h2>
          <p className="mt-3 text-sm leading-6 text-ink-secondary">
            Verifique sua conexão e tente novamente.
          </p>
          <Button
            variant="secondary"
            className="mt-4"
            onClick={() => setAuthAttempt((attempt) => attempt + 1)}
          >
            Tentar novamente
          </Button>
        </section>
      )}
      {authState === 'guest' && (
        <section className="m-auto max-w-md space-y-4 p-6 text-center">
          <Icon name="users" size={32} className="mx-auto text-accent" />
          <h2 className="text-xl font-semibold text-ink-primary">Converse com seus amigos</h2>
          <p className="text-sm leading-6 text-ink-secondary">
            Entre na sua conta para adicionar amigos e trocar mensagens privadas.
          </p>
          <div className="flex justify-center gap-2">
            <Link href="/login" className="btn-primary">
              Entrar
            </Link>
            <Link href="/register" className="btn-secondary">
              Criar conta
            </Link>
          </div>
        </section>
      )}
      {authState === 'ready' && me && !hasUsername && (
        <div className="m-auto p-4">
          <UsernameSetup onSaved={setMe} />
        </div>
      )}
      {authState === 'ready' && me && hasUsername && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {actionError && (
            <p role="alert" className="border-b border-line px-5 py-3 text-sm text-red-300">
              {actionError}
            </p>
          )}
          {view === 'conversations' && selected ? (
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
            <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
              <div className="mx-auto max-w-3xl">
                <div className="mb-8 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-[28px] font-semibold tracking-tight text-ink-primary">
                      {view === 'manage' ? 'Seus amigos' : 'Uma conversa começa aqui'}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-ink-secondary">
                      {view === 'manage'
                        ? 'Encontre pessoas pelo @nome e acompanhe seus pedidos.'
                        : 'Escolha um amigo no painel de conversas ou adicione alguém pelo @nome.'}
                    </p>
                  </div>
                </div>
                <form
                  onSubmit={(event) => void addFriend(event)}
                  className="border-b border-line pb-7"
                >
                  <h2 className="text-base font-semibold text-ink-primary">Adicionar amigo</h2>
                  <label htmlFor="add-friend" className="mt-3 block text-sm text-ink-secondary">
                    @nome do amigo
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <input
                      id="add-friend"
                      value={addValue}
                      onChange={(event) => setAddValue(event.target.value)}
                      maxLength={USERNAME_MAX + 1}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="nome_do_amigo"
                      className="input-base min-w-0 flex-1 basis-44"
                    />
                    <Button type="submit" disabled={!addValue.trim() || adding} aria-busy={adding}>
                      {adding ? 'Enviando…' : 'Enviar pedido'}
                    </Button>
                  </div>
                  {addStatus && (
                    <p
                      role={addStatus.kind === 'error' ? 'alert' : 'status'}
                      className={clsx(
                        'mt-3 text-sm',
                        addStatus.kind === 'error' ? 'text-red-300' : 'text-accent',
                      )}
                    >
                      {addStatus.text}
                    </p>
                  )}
                </form>
                {listState === 'error' ? (
                  <div role="alert" className="py-6">
                    <p className="text-sm text-ink-secondary">
                      Não foi possível carregar seus amigos e pedidos.
                    </p>
                    <Button variant="secondary" className="mt-3" onClick={refresh}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : listState === 'loading' ? (
                  <p role="status" className="py-6 text-sm text-ink-muted">
                    Carregando amigos e pedidos…
                  </p>
                ) : (
                  <>
                    <section className="border-b border-line py-7" aria-labelledby="incoming-title">
                      <h2
                        id="incoming-title"
                        className="mb-3 text-base font-semibold text-ink-primary"
                      >
                        Pedidos recebidos{' '}
                        <span className="ml-1 text-sm font-normal text-ink-muted">
                          {list.incoming.length}
                        </span>
                      </h2>
                      {list.incoming.length === 0 ? (
                        <p className="text-sm text-ink-muted">Você não tem pedidos pendentes.</p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {list.incoming.map((request) => (
                            <li key={request.id} className="flex flex-wrap items-center gap-3 py-3">
                              <UserAvatar
                                userId={request.user.id}
                                name={request.user.name}
                                avatarUpdatedAt={request.user.avatarUpdatedAt}
                                size="sm"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-ink-primary">
                                  {request.user.name}
                                </p>
                                <p className="truncate text-xs text-ink-muted">
                                  @{request.user.username}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                onClick={() => void act(() => api.acceptFriendRequest(request.id))}
                                aria-label={`Aceitar pedido de ${request.user.name}`}
                              >
                                Aceitar
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void act(() => api.deleteFriendRequest(request.id))}
                                aria-label={`Recusar pedido de ${request.user.name}`}
                              >
                                Recusar
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    <section className="py-7" aria-labelledby="friends-title">
                      <h2
                        id="friends-title"
                        className="mb-3 text-base font-semibold text-ink-primary"
                      >
                        Amigos{' '}
                        <span className="ml-1 text-sm font-normal text-ink-muted">
                          {list.friends.length}
                        </span>
                      </h2>
                      {list.friends.length === 0 ? (
                        <p className="text-sm leading-6 text-ink-muted">
                          Quando seu pedido for aceito, o amigo aparece aqui e no painel de
                          conversas.
                        </p>
                      ) : (
                        <ul className="divide-y divide-line">
                          {list.friends.map((friend) => (
                            <li key={friend.id} className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openChat(friend.id)}
                                className="flex min-h-16 min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-3 text-left hover:bg-surface-hover"
                              >
                                <UserAvatar
                                  userId={friend.id}
                                  name={friend.name}
                                  avatarUpdatedAt={friend.avatarUpdatedAt}
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium text-ink-primary">
                                    {friend.name}
                                  </span>
                                  <span className="block truncate text-xs text-ink-muted">
                                    @{friend.username}
                                  </span>
                                </span>
                                <Icon name="chat" className="text-ink-muted" />
                                <span className="sr-only">Abrir conversa com {friend.name}</span>
                              </button>
                              <Button variant="ghost" size="sm" onClick={() => void callFriend(friend.id)} disabled={callingId !== null} aria-label={`Ligar para ${friend.name}`}>
                                <Icon name="phone" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                    {list.outgoing.length > 0 && (
                      <section
                        className="border-t border-line py-7"
                        aria-labelledby="outgoing-title"
                      >
                        <h2
                          id="outgoing-title"
                          className="mb-3 text-base font-semibold text-ink-primary"
                        >
                          Pedidos enviados{' '}
                          <span className="ml-1 text-sm font-normal text-ink-muted">
                            {list.outgoing.length}
                          </span>
                        </h2>
                        <ul className="divide-y divide-line">
                          {list.outgoing.map((request) => (
                            <li key={request.id} className="flex items-center gap-3 py-3">
                              <UserAvatar
                                userId={request.user.id}
                                name={request.user.name}
                                avatarUpdatedAt={request.user.avatarUpdatedAt}
                                size="sm"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-ink-primary">
                                  {request.user.name}
                                </p>
                                <p className="truncate text-xs text-ink-muted">
                                  Aguardando @{request.user.username}
                                </p>
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void act(() => api.deleteFriendRequest(request.id))}
                                aria-label={`Cancelar pedido para ${request.user.name}`}
                              >
                                Cancelar
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
