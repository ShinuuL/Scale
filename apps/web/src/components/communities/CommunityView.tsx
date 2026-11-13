'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { CommunityVoiceState } from '@scale/shared';
import { useRouter } from 'next/navigation';
import type { FriendsList } from '@scale/shared';
import { api, communityImageUrl, type CommunityDetail, type CommunityListItem } from '@/lib/api';
import type { CommunityLayout } from '@scale/shared';
import { applyLayout } from './channelLayout';
import { callScreenPath, startBackgroundCall, useActiveCall } from '@/lib/callControl';
import { useCommunityEvents } from '@/hooks/useCommunityEvents';
import { useUserEvents } from '@/hooks/useUserEvents';
import { useChannelMessages } from '@/hooks/useChannelMessages';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChannelList, CommunityRail, MemberList, type FriendStatus, type Member } from './CommunityParts';
import { ChannelChat } from './ChannelChat';
import { ConfirmDialog } from './ConfirmDialog';
import {
  CommunitySettingsDialog,
  CreateCommunityDialog,
  InviteDialog,
  JoinCommunityDialog,
} from './CommunityDialogs';

const ORDER_KEY = 'scale:community-order';

/** Ordem escolhida pelo usuario (so neste navegador); novas comunidades vao para o fim. */
function readOrder(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(ORDER_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function sortByOrder<T extends { id: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (rank.get(a.item.id) ?? order.length + a.index) - (rank.get(b.item.id) ?? order.length + b.index))
    .map(({ item }) => item);
}

type DialogName =
  'create' | 'join' | 'invite' | 'settings' | 'leave' | 'channels' | 'members' | null;
export function CommunityView({
  communityId,
  channelId,
  onNavigate,
  meId,
}: {
  communityId?: string;
  channelId?: string;
  onNavigate: (communityId?: string, channelId?: string) => void;
  meId: string;
}) {
  const router = useRouter();
  const [communities, setCommunities] = useState<CommunityListItem[]>([]);
  const [detail, setDetail] = useState<CommunityDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<DialogName>(null);
  const [voice, setVoice] = useState<CommunityVoiceState[]>([]);
  // Presenca e "falando" (Fase 1): sets imutaveis, trocados a cada evento.
  const [onlineIds, setOnlineIds] = useState<ReadonlySet<string>>(() => new Set());
  const [speakingIds, setSpeakingIds] = useState<ReadonlySet<string>>(() => new Set());
  // Quem saiu da voz deixa de "falar" (o evento de fim pode nunca chegar).
  useEffect(() => {
    const present = new Set(voice.flatMap((state) => state.members.map((member) => member.userId)));
    setSpeakingIds((previous) =>
      [...previous].every((id) => present.has(id))
        ? previous
        : new Set([...previous].filter((id) => present.has(id))),
    );
  }, [voice]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [order, setOrder] = useState<string[]>([]);
  const [friends, setFriends] = useState<FriendsList | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => setOrder(readOrder()), []);
  const loadFriends = useCallback(
    () =>
      api
        .getFriends()
        .then(setFriends)
        .catch(() => setFriends(null)),
    [],
  );
  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);
  const reorder = (ids: string[]) => {
    setOrder(ids);
    try {
      window.localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
    } catch {
      // Sem storage: a ordem vale ate recarregar.
    }
  };
  const friendStatus = (member: Member): FriendStatus => {
    if (member.userId === meId) return 'self';
    if (!friends) return 'self';
    if (friends.friends.some((user) => user.id === member.userId)) return 'friend';
    if (friends.outgoing.some((request) => request.user.id === member.userId)) return 'outgoing';
    if (friends.incoming.some((request) => request.user.id === member.userId)) return 'incoming';
    return 'none';
  };
  const addFriend = async (member: Member) => {
    if (!member.username) return;
    try {
      const result = await api.sendFriendRequest(member.username);
      setNotice(
        result.status === 'ACCEPTED'
          ? `Você e ${member.name} agora são amigos.`
          : `Pedido de amizade enviado para ${member.name}.`,
      );
    } catch {
      setNotice(`Não foi possível adicionar ${member.name}. Tente novamente.`);
    }
    await loadFriends();
  };
  const memberList = detail && (
    <MemberList
      members={detail.members}
      friendStatus={friendStatus}
      onAddFriend={addFriend}
      onMessage={(member) => router.push(`/friends?dm=${encodeURIComponent(member.userId)}`)}
      roleName={(member) => detail.roles.find((role) => role.id === member.customRoleId)?.name}
      isOnline={(member) => onlineIds.has(member.userId)}
    />
  );
  const activeCall = useActiveCall();
  const currentId = useRef(communityId);
  currentId.current = communityId;
  const selected =
    detail?.channels.find((channel) => channel.id === channelId && channel.kind === 'TEXT') ??
    detail?.channels.find((channel) => channel.kind === 'TEXT');
  const { state: messages, dispatch } = useChannelMessages(selected?.id ?? null, refreshVersion);
  // Nao lidas. Comunidade aberta: contagem por canal no `detail`, atualizada
  // pelos eventos `channel:message` do socket da comunidade. Outras comunidades:
  // o socket so acompanha a aberta, entao o servidor manda `community:activity`
  // (sem conteudo) na sala pessoal `user:<id>`; o total do rail tambem e
  // recarregado ao focar a janela (cobre eventos perdidos em reconexao).
  const selectedId = selected?.id;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;
  const readTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const setChannelUnread = useCallback((id: string, update: (count: number) => number) => {
    setDetail((previous) =>
      previous && {
        ...previous,
        channels: previous.channels.map((channel) =>
          channel.id === id ? { ...channel, unread: update(channel.unread ?? 0) } : channel,
        ),
      },
    );
  }, []);
  /** Zera na hora e avisa o servidor (agrupado: rajada de mensagens = um POST). */
  const markChannelRead = useCallback(
    (id: string) => {
      setChannelUnread(id, () => 0);
      const timers = readTimers.current;
      if (timers.has(id)) return;
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          void api.markChannelRead(id).catch(() => undefined);
        }, 400),
      );
    },
    [setChannelUnread],
  );
  useEffect(() => {
    const timers = readTimers.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);
  const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
  useEffect(() => {
    if (selectedId && visible()) markChannelRead(selectedId);
  }, [selectedId, markChannelRead]);
  useEffect(() => {
    const onVisible = () => {
      const id = selectedRef.current;
      if (id && visible()) markChannelRead(id);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markChannelRead]);
  const refreshList = useCallback(
    () =>
      api
        .listCommunities()
        .then((result) => setCommunities(result.communities))
        .catch(() => setError('Não foi possível carregar suas comunidades.')),
    [],
  );
  const refresh = useCallback(() => {
    if (!communityId) {
      setDetail(null);
      return;
    }
    api
      .getCommunity(communityId)
      .then((result) => {
        if (currentId.current === communityId) {
          // Canal aberto e visivel nunca mostra nao lidas (o POST de leitura pode estar a caminho).
          const open = selectedRef.current;
          setDetail(
            open && visible()
              ? { ...result, channels: result.channels.map((c) => (c.id === open ? { ...c, unread: 0 } : c)) }
              : result,
          );
          setError('');
        }
      })
      .catch(() => {
        if (currentId.current === communityId) {
          setDetail(null);
          setError('Não foi possível carregar esta comunidade.');
        }
      });
  }, [communityId]);
  useEffect(() => {
    setLoading(true);
    void refreshList().finally(() => setLoading(false));
  }, [refreshList]);
  useEffect(() => {
    const onFocus = () => void refreshList();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshList]);
  useUserEvents(true, {
    onCommunityActivity: (event) => {
      // A comunidade aberta conta pelo `channel:message` (evita contar duas vezes).
      if (event.authorId === meId || event.communityId === currentId.current) return;
      setCommunities((previous) =>
        previous.map((community) =>
          community.id === event.communityId
            ? { ...community, unread: (community.unread ?? 0) + 1 }
            : community,
        ),
      );
    },
  });
  useEffect(() => {
    setDetail(null);
    setVoice([]);
    setOnlineIds(new Set());
    setSpeakingIds(new Set());
    setError('');
    refresh();
  }, [refresh]);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => {
      if (event.matches)
        setDialog((previous) =>
          previous === 'channels' || previous === 'members' ? null : previous,
        );
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const gone = () => {
    setDialog(null);
    setDetail(null);
    void refreshList();
    onNavigate();
  };
  useCommunityEvents(communityId ?? null, {
    onMessage: (message) => {
      dispatch({ type: 'message', message });
      if (message.author.id === meId) return;
      if (message.channelId === selectedRef.current && visible()) markChannelRead(message.channelId);
      else setChannelUnread(message.channelId, (count) => Math.min(count + 1, 100));
    },
    onMessageEdit: (event) => dispatch({ type: 'edit', event }),
    onMessageDelete: (event) => dispatch({ type: 'delete', event }),
    onReaction: (event) => dispatch({ type: 'reaction', event }),
    onPin: (event) => dispatch({ type: 'pin', event }),
    onChanged: () => {
      refresh();
      void refreshList();
    },
    onDeleted: gone,
    onRemoved: gone,
    onVoiceStates: (states) => {
      setVoice(states);
      setRefreshVersion((version) => version + 1);
    },
    onVoiceState: (state) =>
      setVoice((previous) => [
        ...previous.filter((item) => item.channelId !== state.channelId),
        state,
      ]),
    onOnlineUsers: (ids) => setOnlineIds(new Set(ids)),
    onPresence: ({ userId, online }) => setOnlineIds((previous) => toggled(previous, userId, online)),
    onVoiceSpeaking: ({ userId, speaking }) =>
      setSpeakingIds((previous) => toggled(previous, userId, speaking)),
    onError: () => setError('Não foi possível acompanhar a comunidade em tempo real.'),
  });
  const perms = detail?.myPermissions;
  // Configuracoes abrem para quem tem QUALQUER poder de gestao (cargo base ou personalizado).
  const canManage = detail?.myRole === 'OWNER' || Boolean(perms && Object.values(perms).some(Boolean));
  const authorColors = new Map((detail?.members ?? []).flatMap((member) => {
    const color = detail?.roles.find((role) => role.id === member.customRoleId)?.color;
    return color ? [[member.userId, color] as const] : [];
  }));
  // Ordem/categorias: aplica na hora e grava; erro (ex.: 409 lista velha) recarrega.
  const saveLayout = (layout: CommunityLayout) => {
    if (!detail) return;
    const id = detail.community.id;
    setDetail((current) =>
      current && current.community.id === id
        ? { ...current, ...applyLayout(current.channels, current.categories ?? [], layout) }
        : current,
    );
    api.saveCommunityLayout(id, layout).catch(() => {
      setError('Não foi possível salvar a ordem dos canais.');
      refresh();
    });
  };
  const channels = detail && (
    <ChannelList
      name={detail.community.name}
      channels={detail.channels}
      categories={detail.categories}
      bannerUrl={communityImageUrl(detail.community.id, 'banner', detail.community.bannerUpdatedAt)}
      onLayout={perms?.manageChannels ? saveLayout : undefined}
      selected={selected?.id}
      voiceStates={voice}
      speakingUserIds={speakingIds}
      onSelect={(channel) => {
        setDialog(null);
        setError('');
        // Voz estilo Discord: entra na chamada e continua no chat; a tela da
        // chamada só abre por "Abrir chamada" ou pela barra de chamada.
        if (channel.kind === 'VOICE') {
          if (activeCall?.roomId !== channel.id)
            startBackgroundCall({ roomId: channel.id, communityId: detail.community.id });
        } else onNavigate(detail.community.id, channel.id);
      }}
      activeVoiceId={activeCall?.roomId}
      activeVoiceJoined={!!activeCall?.joined}
      onOpenCall={(channel) => {
        setDialog(null);
        router.push(callScreenPath(channel.id, detail.community.id));
      }}
      onInvite={() => setDialog('invite')}
      onSettings={() => setDialog('settings')}
      canManage={!!canManage}
      onLeave={detail.myRole !== 'OWNER' ? () => setDialog('leave') : undefined}
      onMarkRead={() => {
        setDetail((previous) =>
          previous && { ...previous, channels: previous.channels.map((c) => ({ ...c, unread: 0 })) },
        );
        void api.markCommunityRead(detail.community.id).catch(() =>
          setError('Não foi possível marcar a comunidade como lida.'),
        );
      }}
    />
  );
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <CommunityRail
        communities={sortByOrder(
          // Comunidade aberta: o total vem dos canais (ja atualizados em tempo real).
          detail
            ? communities.map((community) =>
                community.id === detail.community.id
                  ? { ...community, unread: detail.channels.reduce((sum, c) => sum + (c.unread ?? 0), 0) }
                  : community,
              )
            : communities,
          order,
        )}
        selected={communityId}
        onReorder={reorder}
        onSelect={(id) => onNavigate(id)}
        onCreate={() => setDialog('create')}
        onJoin={() => setDialog('join')}
      />
      {detail && <div className="hidden h-full w-64 shrink-0 lg:block">{channels}</div>}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {detail && (
          <div className="flex gap-2 border-b border-line p-2 xl:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="lg:hidden"
              onClick={() => setDialog('channels')}
            >
              Canais
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDialog('members')}>
              Membros
            </Button>
          </div>
        )}
        {error && (
          <Banner variant="error" className="m-4">
            {error}
          </Banner>
        )}
        {notice && (
          <Banner
            variant="info"
            className="m-4"
            action={
              <Button variant="ghost" size="sm" onClick={() => setNotice('')}>
                Fechar
              </Button>
            }
          >
            {notice}
          </Banner>
        )}
        {selected && detail ? (
          <ChannelChat
            key={selected.id}
            channelId={selected.id}
            name={selected.name}
            meId={meId}
            canManage={Boolean(perms?.manageMessages)}
            authorColors={authorColors}
            state={messages}
            dispatch={dispatch}
          />
        ) : (
          <div className="m-auto p-6 text-center text-sm text-ink-muted">
            {loading ? (
              <div role="status">
                Carregando comunidades...
                <Skeleton className="mt-2 h-12" />
              </div>
            ) : detail ? (
              'Selecione um canal ou crie um canal de texto.'
            ) : communityId ? (
              <>
                <p>Comunidade indisponível.</p>
                <Button variant="secondary" className="mt-4" onClick={() => onNavigate()}>
                  Voltar às comunidades
                </Button>
              </>
            ) : (
              <>
                <p>Crie uma comunidade ou entre em uma existente por convite.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Button onClick={() => setDialog('create')}>Criar comunidade</Button>
                  <Button variant="secondary" onClick={() => setDialog('join')}>
                    Entrar por convite
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {detail && (
        <div className="hidden h-full w-60 shrink-0 xl:block">{memberList}</div>
      )}
      {dialog === 'create' && (
        <CreateCommunityDialog
          onClose={() => setDialog(null)}
          onCreated={(id) => {
            setDialog(null);
            void refreshList();
            onNavigate(id);
          }}
        />
      )}
      {dialog === 'join' && <JoinCommunityDialog onClose={() => setDialog(null)} />}
      {dialog === 'invite' && detail && (
        <InviteDialog id={detail.community.id} onClose={() => setDialog(null)} />
      )}
      {dialog === 'settings' && detail && canManage && (
        <CommunitySettingsDialog
          detail={detail}
          meId={meId}
          onClose={() => setDialog(null)}
          onChanged={refresh}
          onGone={gone}
        />
      )}
      {dialog === 'leave' && detail && (
        <ConfirmDialog
          title={`Sair de ${detail.community.name}?`}
          description="Você precisará de outro convite para voltar."
          confirmLabel="Sair da comunidade"
          onConfirm={async () => {
            await api.leaveCommunity(detail.community.id);
            gone();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === 'channels' || dialog === 'members') && detail && (
        <ModalOverlay
          isOpen
          isDismissable
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          className="fixed inset-0 z-50 flex bg-black/70 data-[entering]:animate-fade-in motion-reduce:animate-none"
        >
          <Modal className="h-full w-72 max-w-[85vw] bg-surface-secondary shadow-2xl data-[entering]:animate-menu-in motion-reduce:animate-none">
            <Dialog className="flex h-full flex-col outline-none">
              <div className="flex items-center justify-between border-b border-line px-4 py-2">
                <Heading slot="title" className="font-semibold text-ink-primary">
                  {dialog === 'channels' ? 'Canais' : 'Membros'}
                </Heading>
                <Tooltip label="Fechar painel">
                  <button
                    type="button"
                    aria-label="Fechar painel"
                    className="rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
                    onClick={() => setDialog(null)}
                  >
                    <Icon name="close" />
                  </button>
                </Tooltip>
              </div>
              <div className="min-h-0 flex-1">
                {dialog === 'channels' ? channels : memberList}
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      )}
    </div>
  );
}

/** Copia do set com `id` presente ou ausente (mesma referencia se nada muda). */
function toggled(set: ReadonlySet<string>, id: string, present: boolean): ReadonlySet<string> {
  if (set.has(id) === present) return set;
  const next = new Set(set);
  if (present) next.add(id);
  else next.delete(id);
  return next;
}
