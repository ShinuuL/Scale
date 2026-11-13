'use client';

import { useState } from 'react';
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { AppModal } from '@/components/ui/AppModal';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatUnreadCount, formatVoiceCount, isVoiceChannelFull, type ChannelKind, type CommunityLayout, type CommunityRole, type CommunityVoiceState } from '@scale/shared';
import { communityImageUrl } from '@/lib/api';
import { ChannelSections } from './ChannelSections';
import type { LayoutCategory } from './channelLayout';
import type { ModerationAction } from './ModerationDialogs';

export interface CommunitySummary {
  id: string;
  name: string;
  role: CommunityRole;
  /** Mensagens nao lidas (soma dos canais, cada um limitado a 100). */
  unread?: number;
  /** Versao do icone (null = sem icone: mostra as iniciais). */
  iconUpdatedAt?: string | null;
}
export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  position: number;
  unread?: number;
  categoryId?: string | null;
  topic?: string | null;
  /** Fase 3: canal de avisos, modo lento, envio permitido e sobrescritas (so para quem gerencia). */
  announcement?: boolean;
  slowModeSeconds?: number;
  canSend?: boolean;
  overrides?: Array<{ target: string; viewChannel: boolean | null; sendMessages: boolean | null }>;
  /** Limite de pessoas do canal de voz (null = teto do mesh). */
  userLimit?: number | null;
}
export interface Member {
  userId: string;
  name: string;
  username: string | null;
  role: CommunityRole;
  customRoleId?: string | null;
  /** Castigo vigente (Fase 3): fim em ISO, ou null. */
  timeoutUntil?: string | null;
}

/** Nome acessivel da contagem: "1 mensagem não lida", "3 mensagens não lidas", "mais de 99 ...". */
export function unreadLabel(count: number): string {
  if (count > 99) return 'mais de 99 mensagens não lidas';
  return count === 1 ? '1 mensagem não lida' : `${count} mensagens não lidas`;
}

const item =
  'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-surface-hover hover:text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';
const railButton =
  'flex h-11 w-11 items-center justify-center rounded-xl text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent';

export function CommunityRail({
  communities,
  selected,
  onSelect,
  onCreate,
  onJoin,
  onReorder,
}: {
  communities: CommunitySummary[];
  selected?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  /** Nova ordem (ids). Arrastar ou Alt+Seta para cima/baixo. */
  onReorder?: (ids: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = communities.map((community) => community.id);
  const move = (id: string, target: number) => {
    const from = ids.indexOf(id);
    if (from < 0 || target < 0 || target >= ids.length || target === from) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(target, 0, id);
    onReorder?.(next);
  };
  const endDrag = () => {
    setDragId(null);
    setOverId(null);
  };
  return (
    <nav
      aria-label="Comunidades"
      className="flex h-full shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-line bg-surface-secondary p-2"
    >
      {communities.map((community, index) => (
        <div
          key={community.id}
          data-testid="community-rail-item"
          className={`relative rounded-xl ${overId === community.id && dragId !== community.id ? 'outline outline-2 outline-accent' : ''} ${dragId === community.id ? 'opacity-50' : ''}`}
          draggable={Boolean(onReorder)}
          onDragStart={(event) => {
            setDragId(community.id);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', community.id);
          }}
          onDragOver={(event) => {
            if (!dragId) return;
            event.preventDefault();
            setOverId(community.id);
          }}
          onDragLeave={() => setOverId((current) => (current === community.id ? null : current))}
          onDrop={(event) => {
            event.preventDefault();
            if (dragId) move(dragId, index);
            endDrag();
          }}
          onDragEnd={endDrag}
        >
          {community.id === selected && (
            <span
              aria-hidden="true"
              className="absolute -left-2 top-2 h-7 w-1 rounded-r bg-accent"
            />
          )}
          <Tooltip label={community.name} placement="right">
            <button
              type="button"
              aria-label={
                community.unread ? `${community.name}, ${unreadLabel(community.unread)}` : community.name
              }
              aria-keyshortcuts={onReorder ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
              aria-current={community.id === selected ? 'true' : undefined}
              onClick={() => onSelect(community.id)}
              onKeyDown={(event) => {
                if (!onReorder || !event.altKey) return;
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                const target = event.currentTarget;
                move(community.id, index + (event.key === 'ArrowUp' ? -1 : 1));
                requestAnimationFrame(() => target.focus());
              }}
              className={`${railButton} ${community.id === selected ? 'btn-primary' : 'bg-surface-hover text-ink-muted hover:text-ink-primary'}`}
            >
              {community.iconUpdatedAt ? (
                // eslint-disable-next-line @next/next/no-img-element -- export estatico, sem otimizador de imagem
                <img
                  src={communityImageUrl(community.id, 'icon', community.iconUpdatedAt) ?? undefined}
                  alt=""
                  className="h-full w-full rounded-xl object-cover"
                  draggable={false}
                />
              ) : (
                community.name.slice(0, 2).toLocaleUpperCase('pt-BR')
              )}
              {Boolean(community.unread) && (
                <span
                  aria-hidden="true"
                  data-testid="community-unread-badge"
                  className="absolute -bottom-1 -right-1 min-w-5 rounded-full border-2 border-surface-secondary bg-red-600 px-1 text-center text-[10px] font-bold leading-4 text-white"
                >
                  {formatUnreadCount(community.unread ?? 0)}
                </span>
              )}
            </button>
          </Tooltip>
        </div>
      ))}
      <Tooltip label="Criar comunidade" placement="right">
        <button
          type="button"
          aria-label="Criar comunidade"
          onClick={onCreate}
          className={`${railButton} bg-surface-hover text-ink-muted hover:text-ink-primary`}
        >
          <Icon name="plus" size={20} />
        </button>
      </Tooltip>
      <Tooltip label="Entrar por convite" placement="right">
        <button
          type="button"
          aria-label="Entrar por convite"
          onClick={onJoin}
          className={`${railButton} bg-surface-hover text-ink-muted hover:text-ink-primary`}
        >
          <Icon name="link" size={20} />
        </button>
      </Tooltip>
    </nav>
  );
}

export function ChannelList({
  name,
  channels,
  selected,
  voiceStates,
  speakingUserIds,
  onSelect,
  onInvite,
  onSettings,
  canManage,
  onLeave,
  onMarkRead,
  activeVoiceId,
  activeVoiceJoined = false,
  onOpenCall,
  categories = [],
  bannerUrl,
  onLayout,
}: {
  name: string;
  channels: Channel[];
  /** Categorias da comunidade (canal sem categoria fica no grupo do tipo). */
  categories?: LayoutCategory[];
  /** Banner da comunidade (topo da lista), se houver. */
  bannerUrl?: string | null;
  /** Nova ordem/categorias (so com manageChannels): arrastar ou Alt+Seta. */
  onLayout?: (layout: CommunityLayout) => void;
  selected?: string;
  voiceStates: CommunityVoiceState[];
  /** Quem esta falando agora nos canais de voz (`community:voice-speaking`). */
  speakingUserIds?: ReadonlySet<string>;
  onSelect: (channel: Channel) => void;
  onInvite: () => void;
  onSettings: () => void;
  canManage: boolean;
  onLeave?: () => void;
  /** "Marcar como lido": zera as nao lidas de todos os canais de texto. */
  onMarkRead?: () => void;
  /** Canal de voz em que esta aba está (ou entrando). */
  activeVoiceId?: string;
  activeVoiceJoined?: boolean;
  onOpenCall?: (channel: Channel) => void;
}) {
  return (
    <section className="flex h-full w-full flex-col bg-surface-secondary p-3">
      {bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- export estatico, sem otimizador de imagem
        <img
          src={bannerUrl}
          alt=""
          data-testid="community-banner"
          className="-mx-3 -mt-3 mb-2 h-24 w-[calc(100%+1.5rem)] max-w-none object-cover"
        />
      )}
      <div className="flex items-center gap-1">
        <h2 className="min-w-0 flex-1 truncate px-3 py-2 font-semibold text-ink-primary">{name}</h2>
        <MenuTrigger>
          <Tooltip label="Menu da comunidade">
            <AriaButton
              aria-label="Menu da comunidade"
              className="rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
            >
              <Icon name="settings" />
            </AriaButton>
          </Tooltip>
          <Popover
            placement="bottom end"
            className="z-50 min-w-48 rounded-xl border border-line bg-surface-secondary p-1 shadow-xl data-[entering]:animate-menu-in"
          >
            <Menu
              aria-label="Menu da comunidade"
              className="outline-none"
              onAction={(key) => {
                if (key === 'invite') onInvite();
                else if (key === 'settings') onSettings();
                else if (key === 'leave') onLeave?.();
                else if (key === 'read') onMarkRead?.();
              }}
            >
              <MenuItem id="invite" textValue="Convidar" className={item}>
                Convidar
              </MenuItem>
              {onMarkRead && (
                <MenuItem id="read" textValue="Marcar como lido" className={item}>
                  Marcar como lido
                </MenuItem>
              )}
              {canManage && (
                <MenuItem id="settings" textValue="Configurações da comunidade" className={item}>
                  Configurações da comunidade
                </MenuItem>
              )}
              {onLeave && (
                <MenuItem
                  id="leave"
                  textValue="Sair da comunidade"
                  className={`${item} btn-danger`}
                >
                  Sair da comunidade
                </MenuItem>
              )}
            </Menu>
          </Popover>
        </MenuTrigger>
      </div>
      <nav aria-label={`Canais de ${name}`} className="mt-4 min-h-0 flex-1 overflow-y-auto">
        <ChannelSections
          channels={channels}
          categories={categories}
          onLayout={onLayout}
          renderChannel={(channel) =>
                    channel.kind === 'VOICE' ? (
                      <VoiceChannelItem
                        channel={channel}
                        members={
                          voiceStates.find((state) => state.channelId === channel.id)?.members ??
                          []
                        }
                        speakingUserIds={speakingUserIds}
                        active={channel.id === activeVoiceId}
                        joined={channel.id === activeVoiceId && activeVoiceJoined}
                        onSelect={() => onSelect(channel)}
                        onOpenCall={onOpenCall ? () => onOpenCall(channel) : undefined}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSelect(channel)}
                        aria-current={channel.id === selected ? 'true' : undefined}
                        className={`${item} ${channel.id === selected ? 'bg-surface-hover text-ink-primary' : ''} ${channel.unread ? 'font-semibold text-ink-primary' : ''}`}
                      >
                        <Icon name="hash" />
                        <span className="truncate">{channel.name}</span>
                        {Boolean(channel.unread) && (
                          <span className="ml-auto shrink-0 rounded-full bg-red-600 px-1.5 text-[11px] font-bold leading-5 text-white">
                            <span aria-hidden="true">{formatUnreadCount(channel.unread ?? 0)}</span>
                            <span className="sr-only">{unreadLabel(channel.unread ?? 0)}</span>
                          </span>
                        )}
                      </button>
                    )
          }
        />
      </nav>
    </section>
  );
}

function VoiceChannelItem({
  channel,
  members,
  speakingUserIds,
  active,
  joined,
  onSelect,
  onOpenCall,
}: {
  channel: Channel;
  members: CommunityVoiceState['members'];
  speakingUserIds?: ReadonlySet<string>;
  active: boolean;
  joined: boolean;
  onSelect: () => void;
  onOpenCall?: () => void;
}) {
  // Limite (Fase 3): "3/4" ao lado do nome; cheio bloqueia a entrada (o
  // servidor tambem recusa no join-room). Quem ja esta no canal nao e barrado.
  const count = formatVoiceCount(members.length, channel.userLimit);
  const full = !active && isVoiceChannelFull(members.length, channel.userLimit);
  const capacity = channel.userLimit ? `, ${members.length} de ${channel.userLimit} pessoas` : '';
  return (
    <>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={full ? undefined : onSelect}
          aria-disabled={full ? 'true' : undefined}
          aria-current={active ? 'true' : undefined}
          aria-label={
            active
              ? `${channel.name}, ${joined ? 'conectado' : 'conectando'}${capacity}`
              : full
                ? `Canal de voz ${channel.name} cheio${capacity}`
                : `Entrar no canal de voz ${channel.name}${capacity}`
          }
          className={`${item} min-w-0 flex-1 ${active ? 'bg-surface-hover text-ink-primary' : ''} ${full ? 'cursor-not-allowed opacity-60' : ''}`}
        >
          <Icon name="speaker" />
          <span className="truncate">{channel.name}</span>
          {count && !active && (
            <span
              data-testid="voice-count"
              className={`ml-auto shrink-0 rounded px-1 text-[11px] font-medium tabular-nums ${full ? 'bg-red-600/20 text-red-300' : 'text-ink-muted'}`}
            >
              {full ? `Cheio ${count}` : count}
            </span>
          )}
          {active && (
            <span
              className={`ml-auto shrink-0 text-[11px] font-medium ${joined ? 'text-emerald-400' : 'text-amber-300'}`}
            >
              {joined ? 'Conectado' : 'Conectando'}{count ? ` ${count}` : ''}
            </span>
          )}
        </button>
        {active && onOpenCall && (
          <Tooltip label="Abrir chamada">
            <AriaButton
              aria-label={`Abrir chamada de ${channel.name}`}
              onPress={onOpenCall}
              className="shrink-0 rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink-primary"
            >
              <Icon name="maximize" />
            </AriaButton>
          </Tooltip>
        )}
      </div>
      {members.length > 0 && (
        <ul aria-label={`Conectados em ${channel.name}`} className="mb-1">
          {members.map((member) => (
            <VoiceMemberRow
              key={member.userId}
              member={member}
              speaking={speakingUserIds?.has(member.userId) === true}
            />
          ))}
        </ul>
      )}
    </>
  );
}

/** Descricao falada do estado de voz (leitor de tela le junto com o nome). */
export function voiceMemberStatus(
  member: CommunityVoiceState['members'][number],
  speaking: boolean,
): string[] {
  const parts: string[] = [];
  if (speaking && !member.muted) parts.push('falando');
  if (member.muted) parts.push('microfone desligado');
  if (member.deafened) parts.push('sem áudio');
  if (member.screenSharing) parts.push('ao vivo');
  return parts;
}

function VoiceMemberRow({
  member,
  speaking,
}: {
  member: CommunityVoiceState['members'][number];
  speaking: boolean;
}) {
  const status = voiceMemberStatus(member, speaking);
  const talking = speaking && !member.muted;
  return (
    <li className="flex items-center gap-2 py-1 pl-9 pr-2">
      <span
        aria-hidden="true"
        data-speaking={talking ? 'true' : undefined}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-[11px] font-semibold text-ink-primary motion-safe:transition-shadow ${talking ? 'ring-2 ring-emerald-400' : ''}`}
      >
        {member.name.slice(0, 1).toLocaleUpperCase('pt-BR')}
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-sm ${talking ? 'text-ink-primary' : 'text-ink-secondary'}`}
      >
        {member.name}
        {status.length > 0 && <span className="sr-only">, {status.join(', ')}</span>}
      </span>
      {member.screenSharing && (
        <span
          aria-hidden="true"
          className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white"
        >
          Ao vivo
        </span>
      )}
      {member.muted && <Icon name="micOff" size={14} className="shrink-0 text-ink-muted" />}
      {member.deafened && (
        <Icon name="speakerOff" size={14} className="shrink-0 text-ink-muted" />
      )}
    </li>
  );
}

/** Situacao de amizade de um membro, vista por quem esta logado. */
export type FriendStatus = 'self' | 'friend' | 'outgoing' | 'incoming' | 'none';

const ROLE_LABEL: Record<CommunityRole, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MEMBER: 'Membro',
};

export function MemberList({
  members,
  friendStatus,
  onAddFriend,
  onMessage,
  roleName,
  isOnline,
  canModerate,
  onModerate,
}: {
  members: Member[];
  friendStatus?: (member: Member) => FriendStatus;
  /** Envia (ou aceita, se ja houver pedido recebido) a amizade pelo @nome. */
  onAddFriend?: (member: Member) => Promise<void>;
  /** Abre a conversa privada (so entre amigos). */
  onMessage?: (member: Member) => void;
  /** Nome do cargo personalizado, se houver. */
  roleName?: (member: Member) => string | undefined;
  /** Presenca (`community:presence`); ausente = lista sem grupos Online/Offline. */
  isOnline?: (member: Member) => boolean;
  /** Moderacao (Fase 3): quem posso castigar/expulsar/banir (hierarquia). */
  canModerate?: (member: Member) => boolean;
  onModerate?: (member: Member, action: ModerationAction | 'untimeout') => void;
}) {
  const roles: CommunityRole[] = ['OWNER', 'ADMIN', 'MEMBER'];
  const [busy, setBusy] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [profile, setProfile] = useState<Member | null>(null);
  const [copied, setCopied] = useState(false);
  const statusOf = (member: Member): FriendStatus => friendStatus?.(member) ?? 'self';
  const add = (member: Member) => {
    if (!onAddFriend) return;
    setBusy(member.userId);
    void onAddFriend(member).finally(() => setBusy(null));
  };
  const runAction = (member: Member, key: string) => {
    if (key === 'profile') {
      setCopied(false);
      setProfile(member);
    } else if (key === 'message') onMessage?.(member);
    else if (key === 'friend') add(member);
    else if (key === 'timeout' || key === 'untimeout' || key === 'kick' || key === 'ban') onModerate?.(member, key);
    else if (key === 'copy' && member.username)
      void navigator.clipboard?.writeText(`@${member.username}`).catch(() => {});
  };
  const canAdd = (member: Member, status: FriendStatus) =>
    (status === 'none' || status === 'incoming') && Boolean(onAddFriend && member.username);
  const profileStatus = profile ? statusOf(profile) : 'self';
  const renderMember = (member: Member) => {
    const presence = isOnline ? (isOnline(member) ? 'online' : 'offline') : null;
    const status = statusOf(member);
    const incoming = status === 'incoming';
    const timedOut = Boolean(member.timeoutUntil && Date.parse(member.timeoutUntil) > Date.now());
    const moderatable = Boolean(onModerate && canModerate?.(member));
    return (
      <div
        key={member.userId}
        className={`flex items-center gap-1 ${presence === 'offline' ? 'opacity-60' : ''}`}
      >
        <MenuTrigger
          isOpen={menuFor === member.userId}
          onOpenChange={(open) => setMenuFor(open ? member.userId : null)}
        >
          <AriaButton
            aria-label={`Opções de ${member.name}${presence ? `, ${presence}` : ''}${timedOut ? ', de castigo' : ''}`}
            onContextMenu={(event: React.MouseEvent) => {
              event.preventDefault();
              setMenuFor(member.userId);
            }}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-2 text-left outline-none hover:bg-surface-hover data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent"
          >
            <span className="relative shrink-0">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-ink-primary"
              >
                {member.name.slice(0, 1).toLocaleUpperCase('pt-BR')}
              </span>
              {presence && (
                <span
                  role="img"
                  aria-label={presence === 'online' ? 'Online' : 'Offline'}
                  title={presence === 'online' ? 'Online' : 'Offline'}
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-secondary ${presence === 'online' ? 'bg-emerald-500' : 'bg-ink-muted'}`}
                />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-primary">
              {member.name}
              {status === 'self' && friendStatus && (
                <span className="ml-1 text-ink-muted">(você)</span>
              )}
            </span>
            {timedOut && (
              <Icon name="clock" size={14} className="shrink-0 text-amber-400" title="De castigo" />
            )}
            {status === 'friend' && (
              <span className="shrink-0 text-[11px] text-ink-muted">Amigo</span>
            )}
            {status === 'outgoing' && (
              <span className="shrink-0 text-[11px] text-ink-muted">Pedido enviado</span>
            )}
          </AriaButton>
          <Popover
            placement="left top"
            className="z-50 min-w-52 rounded-xl border border-line bg-surface-secondary p-1 shadow-xl data-[entering]:animate-menu-in"
          >
            <Menu
              aria-label={`Opções de ${member.name}`}
              className="outline-none"
              onAction={(key) => runAction(member, String(key))}
            >
              <MenuItem id="profile" textValue="Ver perfil" className={item}>
                <Icon name="info" />
                Ver perfil
              </MenuItem>
              {status === 'friend' && onMessage && (
                <MenuItem id="message" textValue="Mensagem privada" className={item}>
                  <Icon name="chat" />
                  Mensagem privada
                </MenuItem>
              )}
              {canAdd(member, status) && (
                <MenuItem
                  id="friend"
                  textValue={incoming ? 'Aceitar amizade' : 'Adicionar amigo'}
                  className={item}
                >
                  <Icon name={incoming ? 'check' : 'userPlus'} />
                  {incoming ? 'Aceitar amizade' : 'Adicionar amigo'}
                </MenuItem>
              )}
              {member.username && (
                <MenuItem id="copy" textValue="Copiar @nome" className={item}>
                  <Icon name="document" />
                  Copiar @{member.username}
                </MenuItem>
              )}
              {moderatable && (
                <MenuItem id={timedOut ? 'untimeout' : 'timeout'} textValue={timedOut ? 'Remover castigo' : 'Castigar'} className={item}>
                  <Icon name="clock" />
                  {timedOut ? 'Remover castigo' : 'Castigar'}
                </MenuItem>
              )}
              {moderatable && (
                <MenuItem id="kick" textValue="Expulsar" className={item}>
                  <Icon name="logOut" />
                  Expulsar
                </MenuItem>
              )}
              {moderatable && (
                <MenuItem id="ban" textValue="Banir" className={item}>
                  <Icon name="ban" />
                  Banir
                </MenuItem>
              )}
            </Menu>
          </Popover>
        </MenuTrigger>
        {canAdd(member, status) && (
          <Tooltip label={incoming ? 'Aceitar amizade' : 'Adicionar amigo'}>
            <AriaButton
              aria-label={
                incoming
                  ? `Aceitar amizade de ${member.name}`
                  : `Adicionar ${member.name} como amigo`
              }
              isDisabled={busy === member.userId}
              onPress={() => add(member)}
              className="shrink-0 rounded-lg p-1.5 text-ink-muted hover:bg-surface-hover hover:text-ink-primary data-[disabled]:opacity-50"
            >
              <Icon name={incoming ? 'check' : 'userPlus'} />
            </AriaButton>
          </Tooltip>
        )}
      </div>
    );
  };
  const byRole = (list: Member[], Heading: 'h3' | 'h4') =>
    roles.map((role) => {
      const group = list.filter((member) => member.role === role);
      return group.length ? (
        <div key={role} className="mb-6">
          <Heading className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {{ OWNER: 'Proprietário', ADMIN: 'Administradores', MEMBER: 'Membros' }[role]} —{' '}
            {group.length}
          </Heading>
          {group.map(renderMember)}
        </div>
      ) : null;
    });
  // Presenca: online agrupado por cargo; offline numa lista so, esmaecida.
  const online = isOnline ? members.filter(isOnline) : members;
  const offline = isOnline ? members.filter((member) => !isOnline(member)) : [];
  return (
    <aside
      aria-label="Membros"
      className="h-full w-full overflow-y-auto border-l border-line bg-surface-secondary p-4"
    >
      {isOnline ? (
        <>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-primary">
            Online — {online.length}
          </h3>
          {byRole(online, 'h4')}
          {offline.length > 0 && (
            <div className="mb-6">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Offline — {offline.length}
              </h3>
              {offline.map(renderMember)}
            </div>
          )}
        </>
      ) : (
        byRole(members, 'h3')
      )}
      {profile && (
        <AppModal title="Perfil" onClose={() => setProfile(null)} closeLabel="Fechar perfil" size="sm">
          <div className="flex flex-col items-center gap-3 text-center">
            <span
              aria-hidden="true"
              className="flex h-20 w-20 items-center justify-center rounded-full bg-surface-hover text-3xl font-semibold text-ink-primary"
            >
              {profile.name.slice(0, 1).toLocaleUpperCase('pt-BR')}
            </span>
            <div>
              <p className="text-lg font-semibold text-ink-primary">{profile.name}</p>
              <p className="text-sm text-ink-muted">
                {profile.username ? `@${profile.username}` : 'Sem @nome definido'}
              </p>
            </div>
            <p className="text-sm text-ink-secondary">
              {roleName?.(profile) ?? ROLE_LABEL[profile.role]}
              {profileStatus === 'friend' && ' · Amigo'}
              {profileStatus === 'outgoing' && ' · Pedido enviado'}
              {profileStatus === 'incoming' && ' · Quer ser seu amigo'}
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {profileStatus === 'friend' && onMessage && (
                <AriaButton
                  onPress={() => {
                    setProfile(null);
                    onMessage(profile);
                  }}
                  className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
                >
                  Mensagem privada
                </AriaButton>
              )}
              {canAdd(profile, profileStatus) && (
                <AriaButton
                  isDisabled={busy === profile.userId}
                  onPress={() => add(profile)}
                  className="btn-primary rounded-lg px-4 py-2 text-sm font-medium data-[disabled]:opacity-50"
                >
                  {profileStatus === 'incoming' ? 'Aceitar amizade' : 'Adicionar amigo'}
                </AriaButton>
              )}
              {profile.username && (
                <AriaButton
                  onPress={() => {
                    void navigator.clipboard
                      ?.writeText(`@${profile.username}`)
                      .then(() => setCopied(true))
                      .catch(() => {});
                  }}
                  className="btn-secondary rounded-lg px-4 py-2 text-sm font-medium"
                >
                  {copied ? 'Copiado' : 'Copiar @nome'}
                </AriaButton>
              )}
            </div>
          </div>
        </AppModal>
      )}
    </aside>
  );
}
