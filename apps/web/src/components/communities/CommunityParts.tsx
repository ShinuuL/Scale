'use client';

import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import { Icon } from '@/components/ui/Icon';
import { Tooltip } from '@/components/ui/Tooltip';
import type { ChannelKind, CommunityRole, CommunityVoiceState } from '@scale/shared';

export interface CommunitySummary {
  id: string;
  name: string;
  role: CommunityRole;
}
export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  position: number;
}
export interface Member {
  userId: string;
  name: string;
  username: string | null;
  role: CommunityRole;
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
}: {
  communities: CommunitySummary[];
  selected?: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <nav
      aria-label="Comunidades"
      className="flex h-full shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-line bg-surface-secondary p-2"
    >
      {communities.map((community) => (
        <div key={community.id} className="relative">
          {community.id === selected && (
            <span
              aria-hidden="true"
              className="absolute -left-2 top-2 h-7 w-1 rounded-r bg-accent"
            />
          )}
          <Tooltip label={community.name} placement="right">
            <button
              type="button"
              aria-label={community.name}
              aria-current={community.id === selected ? 'true' : undefined}
              onClick={() => onSelect(community.id)}
              className={`${railButton} ${community.id === selected ? 'btn-primary' : 'bg-surface-hover text-ink-muted hover:text-ink-primary'}`}
            >
              {community.name.slice(0, 2).toLocaleUpperCase('pt-BR')}
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
  onSelect,
  onInvite,
  onSettings,
  canManage,
  onLeave,
}: {
  name: string;
  channels: Channel[];
  selected?: string;
  voiceStates: CommunityVoiceState[];
  onSelect: (channel: Channel) => void;
  onInvite: () => void;
  onSettings: () => void;
  canManage: boolean;
  onLeave?: () => void;
}) {
  return (
    <section className="flex h-full w-full flex-col bg-surface-secondary p-3">
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
              }}
            >
              <MenuItem id="invite" textValue="Convidar" className={item}>
                Convidar
              </MenuItem>
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
        {(['TEXT', 'VOICE'] as const).map((kind) => (
          <div key={kind} className="mb-5">
            <h3 className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {kind === 'TEXT' ? 'Canais de texto' : 'Canais de voz'}
            </h3>
            <ul>
              {channels
                .filter((channel) => channel.kind === kind)
                .map((channel) => (
                  <li key={channel.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(channel)}
                      aria-current={channel.id === selected ? 'true' : undefined}
                      className={`${item} ${channel.id === selected ? 'bg-surface-hover text-ink-primary' : ''}`}
                    >
                      <Icon name={kind === 'TEXT' ? 'hash' : 'speaker'} />
                      <span className="truncate">{channel.name}</span>
                    </button>
                    {kind === 'VOICE' && (
                      <ul>
                        {voiceStates
                          .find((state) => state.channelId === channel.id)
                          ?.members.map((member) => (
                            <li
                              key={member.userId}
                              className="truncate py-1 pl-10 text-xs text-ink-muted"
                            >
                              {member.name}
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </nav>
    </section>
  );
}

export function MemberList({ members }: { members: Member[] }) {
  const roles: CommunityRole[] = ['OWNER', 'ADMIN', 'MEMBER'];
  return (
    <aside
      aria-label="Membros"
      className="h-full w-full overflow-y-auto border-l border-line bg-surface-secondary p-4"
    >
      {roles.map((role) => {
        const group = members.filter((member) => member.role === role);
        return group.length ? (
          <div key={role} className="mb-6">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {{ OWNER: 'Proprietário', ADMIN: 'Administradores', MEMBER: 'Membros' }[role]} —{' '}
              {group.length}
            </h3>
            {group.map((member) => (
              <div key={member.userId} className="flex items-center gap-2 py-2">
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-ink-primary"
                >
                  {member.name.slice(0, 1).toLocaleUpperCase('pt-BR')}
                </span>
                <span className="min-w-0 truncate text-sm text-ink-primary">{member.name}</span>
              </div>
            ))}
          </div>
        ) : null;
      })}
    </aside>
  );
}
