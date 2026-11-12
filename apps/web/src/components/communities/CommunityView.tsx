'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import type { CommunityVoiceState } from '@scale/shared';
import { useRouter } from 'next/navigation';
import { api, type CommunityDetail, type CommunityListItem } from '@/lib/api';
import { useCommunityEvents } from '@/hooks/useCommunityEvents';
import { useChannelMessages } from '@/hooks/useChannelMessages';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import { ChannelList, CommunityRail, MemberList } from './CommunityParts';
import { ChannelChat } from './ChannelChat';
import { ConfirmDialog } from './ConfirmDialog';
import {
  CommunitySettingsDialog,
  CreateCommunityDialog,
  InviteDialog,
  JoinCommunityDialog,
} from './CommunityDialogs';

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
  const [refreshVersion, setRefreshVersion] = useState(0);
  const currentId = useRef(communityId);
  currentId.current = communityId;
  const selected =
    detail?.channels.find((channel) => channel.id === channelId && channel.kind === 'TEXT') ??
    detail?.channels.find((channel) => channel.kind === 'TEXT');
  const { state: messages, dispatch } = useChannelMessages(selected?.id ?? null, refreshVersion);
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
          setDetail(result);
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
    setDetail(null);
    setVoice([]);
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
    onMessage: (message) => dispatch({ type: 'message', message }),
    onMessageEdit: (event) => dispatch({ type: 'edit', event }),
    onMessageDelete: (event) => dispatch({ type: 'delete', event }),
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
    onError: () => setError('Não foi possível acompanhar a comunidade em tempo real.'),
  });
  const canManage = detail?.myRole === 'OWNER' || detail?.myRole === 'ADMIN';
  const channels = detail && (
    <ChannelList
      name={detail.community.name}
      channels={detail.channels}
      selected={selected?.id}
      voiceStates={voice}
      onSelect={(channel) => {
        setDialog(null);
        setError('');
        if (channel.kind === 'VOICE')
          router.push(
            `/room?id=${encodeURIComponent(channel.id)}&c=${encodeURIComponent(detail.community.id)}`,
          );
        else onNavigate(detail.community.id, channel.id);
      }}
      onInvite={() => setDialog('invite')}
      onSettings={() => setDialog('settings')}
      canManage={!!canManage}
      onLeave={detail.myRole !== 'OWNER' ? () => setDialog('leave') : undefined}
    />
  );
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <CommunityRail
        communities={communities}
        selected={communityId}
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
        {selected && detail ? (
          <ChannelChat
            key={selected.id}
            channelId={selected.id}
            name={selected.name}
            meId={meId}
            canManage={!!canManage}
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
        <div className="hidden h-full w-60 shrink-0 xl:block">
          <MemberList members={detail.members} />
        </div>
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
                {dialog === 'channels' ? channels : <MemberList members={detail.members} />}
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      )}
    </div>
  );
}
