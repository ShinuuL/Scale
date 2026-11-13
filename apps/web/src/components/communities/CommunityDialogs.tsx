'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { api, type CommunityCustomRole, type CommunityDetail, type CommunityInvite } from '@/lib/api';
import type { CommunityPermissions } from '@scale/shared';
import { ConfirmDialog } from './ConfirmDialog';
import type { Channel, Member } from './CommunityParts';
import { CategoriesSection, CommunityImagesSection } from './CommunityAppearance';
import { buildSections, setChannelCategory } from './channelLayout';

const selectClass =
  'w-full rounded-lg border border-line bg-surface-secondary p-2 text-sm text-ink-primary';
function Frame({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <ModalOverlay
      isOpen
      isDismissable
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 data-[entering]:animate-fade-in motion-reduce:animate-none"
    >
      <Modal className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-surface-secondary p-6 shadow-2xl data-[entering]:animate-menu-in motion-reduce:animate-none">
        <Dialog className="space-y-4 outline-none">
          <Heading
            id="community-dialog-heading"
            tabIndex={-1}
            slot="title"
            className="text-lg font-semibold text-ink-primary"
          >
            {title}
          </Heading>
          {children}
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function CreateCommunityDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Frame title="Criar comunidade" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          api
            .createCommunity(name)
            .then((result) => onCreated(result.community.id))
            .catch(() => setError('Não foi possível criar a comunidade.'))
            .finally(() => setBusy(false));
        }}
      >
        <Input
          label="Nome"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={50}
          required
        />
        {error && <Banner variant="error">{error}</Banner>}
        <Button type="submit" disabled={busy || !name.trim()}>
          Criar
        </Button>
      </form>
    </Frame>
  );
}

export function JoinCommunityDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  return (
    <Frame title="Entrar por convite" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          const code = value.trim().split('#').pop() ?? '';
          if (!/^[A-Za-z0-9_-]{22}$/.test(code)) {
            setError('Informe um convite válido.');
            return;
          }
          router.push(`/invite#${code}`);
        }}
      >
        <Input
          label="Link ou código do convite"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setError('');
          }}
          error={error || undefined}
          required
        />
        <Button type="submit">Continuar</Button>
      </form>
    </Frame>
  );
}

export function InviteDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const [expiresIn, setExpiresIn] = useState<'1h' | '24h' | '7d'>('7d');
  const [maxUses, setMaxUses] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Frame title="Convidar pessoas" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          api
            .createCommunityInvite(id, {
              expiresIn,
              ...(maxUses ? { maxUses: Number(maxUses) } : {}),
            })
            .then((result) => setLink(`${window.location.origin}/invite#${result.invite.code}`))
            .catch(() => setError('Não foi possível gerar o convite.'))
            .finally(() => setBusy(false));
        }}
      >
        <label className="block text-sm text-ink-primary">
          Validade
          <select
            className={selectClass}
            value={expiresIn}
            onChange={(event) => setExpiresIn(event.target.value as typeof expiresIn)}
          >
            <option value="1h">1 hora</option>
            <option value="24h">24 horas</option>
            <option value="7d">7 dias</option>
          </select>
        </label>
        <Input
          label="Limite de usos (opcional)"
          type="number"
          min="1"
          max="100"
          value={maxUses}
          onChange={(event) => setMaxUses(event.target.value)}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Gerando...' : 'Gerar convite'}
        </Button>
      </form>
      {link && (
        <div className="space-y-2">
          <Input
            label="Link do convite"
            readOnly
            value={link}
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            variant="secondary"
            onClick={() =>
              void navigator.clipboard
                .writeText(link)
                .then(() => setCopied(true))
                .catch(() => setError('Selecione e copie o link manualmente.'))
            }
          >
            {copied ? 'Copiado' : 'Copiar link'}
          </Button>
          <p className="text-xs text-ink-muted">O código aparece apenas agora.</p>
        </div>
      )}
      {error && <Banner variant="error">{error}</Banner>}
    </Frame>
  );
}

function ChannelSettingsRow({
  channel,
  onRename,
  onDelete,
  categories = [],
  onCategory,
}: {
  channel: Channel;
  onRename: (name: string) => Promise<boolean>;
  onDelete: () => void;
  categories?: Array<{ id: string; name: string }>;
  onCategory?: (categoryId: string | null) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(channel.name);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-ink-primary">{channel.name}</span>
        {onCategory && categories.length > 0 && (
          <label className="text-sm text-ink-primary">
            <span className="sr-only">Categoria do canal {channel.name}</span>
            <select
              className={selectClass}
              value={channel.categoryId ?? ''}
              onChange={(event) => onCategory(event.target.value || null)}
            >
              <option value="">Sem categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Renomear canal ${channel.name}`}
          onClick={() => {
            setName(channel.name);
            setRenaming(true);
          }}
        >
          Renomear
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Apagar canal ${channel.name}`}
          onClick={onDelete}
        >
          Apagar
        </Button>
      </div>
      {renaming && (
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void onRename(name).then((ok) => {
              if (ok) setRenaming(false);
            });
          }}
        >
          <Input
            label="Novo nome do canal"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            maxLength={40}
          />
          <Button type="submit" size="sm">
            Salvar
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(false)}>
            Cancelar
          </Button>
        </form>
      )}
    </div>
  );
}

const PERMISSION_LABELS: Array<[keyof CommunityPermissions, string]> = [
  ['manageChannels', 'Gerenciar canais'],
  ['manageInvites', 'Gerenciar convites'],
  ['manageMessages', 'Apagar mensagens de outros'],
  ['kickMembers', 'Expulsar membros'],
];
const EMPTY_ROLE = { name: '', color: '#7c6cf2', permissions: { manageChannels: false, manageInvites: false, manageMessages: false, kickMembers: false } };

/** Formulario de cargo (criar ou editar). */
function RoleForm({ initial, submitLabel, onSubmit, onCancel }: { initial: typeof EMPTY_ROLE; submitLabel: string; onSubmit: (value: typeof EMPTY_ROLE) => Promise<boolean>; onCancel?: () => void }) {
  const [value, setValue] = useState(initial);
  return (
    <form
      className="space-y-2 rounded-lg border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(value).then((ok) => { if (ok && !onCancel) setValue(EMPTY_ROLE); });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Nome do cargo" maxLength={32} required value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} />
        <label className="text-sm text-ink-primary">
          Cor
          <input type="color" className="mt-1 block h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface-secondary" value={value.color} onChange={(event) => setValue({ ...value, color: event.target.value })} />
        </label>
      </div>
      <fieldset className="grid gap-1 sm:grid-cols-2">
        <legend className="mb-1 text-sm text-ink-secondary">Permissões</legend>
        {PERMISSION_LABELS.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-ink-primary">
            <input type="checkbox" checked={value.permissions[key]} onChange={(event) => setValue({ ...value, permissions: { ...value.permissions, [key]: event.target.checked } })} />
            {label}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" size="sm">{submitLabel}</Button>
        {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>}
      </div>
    </form>
  );
}

function RoleRow({ role, onSave, onDelete }: { role: CommunityCustomRole; onSave: (value: typeof EMPTY_ROLE) => Promise<boolean>; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <RoleForm initial={{ name: role.name, color: role.color, permissions: role.permissions }} submitLabel="Salvar cargo" onSubmit={(value) => onSave(value).then((ok) => { if (ok) setEditing(false); return ok; })} onCancel={() => setEditing(false)} />;
  const granted = PERMISSION_LABELS.filter(([key]) => role.permissions[key]).map(([, label]) => label);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-primary">
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: role.color }} aria-hidden="true" />
      <span className="flex-1">
        <span style={{ color: role.color }} className="font-medium">{role.name}</span>
        <span className="block text-xs text-ink-muted">{granted.length ? granted.join(', ') : 'Só identificação, sem permissões extras'}</span>
      </span>
      <Button size="sm" variant="ghost" aria-label={`Editar cargo ${role.name}`} onClick={() => setEditing(true)}>Editar</Button>
      <Button size="sm" variant="ghost" aria-label={`Apagar cargo ${role.name}`} onClick={onDelete}>Apagar</Button>
    </div>
  );
}

function MemberRow({
  member,
  owner,
  roles,
  onRole,
  onCustomRole,
  onRemove,
}: {
  member: Member;
  owner: boolean;
  roles: CommunityCustomRole[];
  onRole: () => void;
  onCustomRole: (roleId: string | null) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-primary">
      <span className="flex-1">
        {member.name} ({member.role === 'OWNER' ? 'Dono' : member.role === 'ADMIN' ? 'Administrador' : 'Membro'})
      </span>
      {owner && roles.length > 0 && (
        <label className="text-sm text-ink-primary">
          <span className="sr-only">Cargo de {member.name}</span>
          <select className={selectClass} value={member.customRoleId ?? ''} onChange={(event) => onCustomRole(event.target.value || null)}>
            <option value="">Sem cargo</option>
            {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select>
        </label>
      )}
      {owner && member.role !== 'OWNER' && (
        <Button size="sm" variant="ghost" onClick={onRole}>
          {member.role === 'ADMIN' ? 'Tornar membro' : 'Tornar administrador'}
        </Button>
      )}
      {onRemove && (
        <Button size="sm" variant="ghost" aria-label={`Expulsar ${member.name}`} onClick={onRemove}>
          Expulsar
        </Button>
      )}
    </div>
  );
}

type Confirmation = {
  title: string;
  description: string;
  label: string;
  requiredName?: string;
  action: () => Promise<void>;
};
export function CommunitySettingsDialog({
  detail,
  meId,
  onClose,
  onChanged,
  onGone,
}: {
  detail: CommunityDetail;
  meId: string;
  onClose: () => void;
  onChanged: () => void;
  onGone: () => void;
}) {
  const { community, channels, members, myRole, myPermissions, roles } = detail;
  const categories = detail.categories ?? [];
  const owner = myRole === 'OWNER';
  const [name, setName] = useState(community.name);
  const [newChannelName, setNewChannelName] = useState('');
  const [kind, setKind] = useState<'TEXT' | 'VOICE'>('TEXT');
  const [invites, setInvites] = useState<CommunityInvite[]>([]);
  const [error, setError] = useState('');
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [invitesFailed, setInvitesFailed] = useState(false);
  const [confirm, setConfirm] = useState<Confirmation | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      onChanged();
      return true;
    } catch {
      setError('Não foi possível concluir a ação.');
      return false;
    }
  };
  const loadInvites = () => {
    setInvitesLoading(true);
    setInvitesFailed(false);
    return api
      .listCommunityInvites(community.id)
      .then((result) => setInvites(result.invites))
      .catch(() => setInvitesFailed(true))
      .finally(() => setInvitesLoading(false));
  };
  useEffect(() => {
    let active = true;
    if (!myPermissions.manageInvites) {
      setInvitesLoading(false);
      return;
    }
    setInvitesLoading(true);
    setInvitesFailed(false);
    api
      .listCommunityInvites(community.id)
      .then((result) => {
        if (active) setInvites(result.invites);
      })
      .catch(() => {
        if (active) setInvitesFailed(true);
      })
      .finally(() => {
        if (active) setInvitesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [community.id, myPermissions.manageInvites]);
  return (
    <Frame title={`Configurações de ${community.name}`} onClose={onClose}>
      {error && <Banner variant="error">{error}</Banner>}
      {myRole === 'OWNER' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.updateCommunity(community.id, name));
          }}
          className="space-y-2"
        >
          <Input
            label="Nome da comunidade"
            maxLength={50}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" size="sm">
            Salvar nome
          </Button>
        </form>
      )}
      {(myRole === 'OWNER' || myRole === 'ADMIN') && (
        <CommunityImagesSection community={community} onChanged={onChanged} />
      )}
      {myPermissions.manageChannels && <section className="space-y-2">
        <h3 className="font-semibold text-ink-primary">Canais</h3>
        {channels.map((channel) => (
          <ChannelSettingsRow
            key={channel.id}
            channel={channel}
            categories={categories}
            onCategory={(categoryId) => {
              const layout = setChannelCategory(buildSections(channels, categories), channel.id, categoryId);
              if (layout) void run(() => api.saveCommunityLayout(community.id, layout));
            }}
            onRename={(value) => run(() => api.updateChannel(channel.id, value))}
            onDelete={() =>
              setConfirm({
                title: `Apagar canal ${channel.name}?`,
                description: 'As mensagens deste canal serão apagadas.',
                label: 'Apagar canal',
                action: async () => {
                  await api.deleteChannel(channel.id);
                  onChanged();
                },
              })
            }
          />
        ))}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => api.createChannel(community.id, newChannelName, kind)).then((ok) => {
              if (ok) setNewChannelName('');
            });
          }}
        >
          <Input
            label="Nome do novo canal"
            maxLength={40}
            required
            value={newChannelName}
            onChange={(event) => setNewChannelName(event.target.value)}
          />
          <label className="text-sm text-ink-primary">
            Tipo do canal
            <select
              className={selectClass}
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              <option value="TEXT">Texto</option>
              <option value="VOICE">Voz</option>
            </select>
          </label>
          <Button type="submit" size="sm">
            Criar canal
          </Button>
        </form>
      </section>}
      {myPermissions.manageChannels && (
        <CategoriesSection
          communityId={community.id}
          categories={categories}
          run={run}
          onDelete={(category) =>
            setConfirm({
              title: `Apagar categoria ${category.name}?`,
              description: 'Os canais desta categoria continuam, sem categoria.',
              label: 'Apagar categoria',
              action: async () => {
                await api.deleteCategory(category.id);
                onChanged();
              },
            })
          }
        />
      )}
      {owner && (
        <section className="space-y-2">
          <h3 className="font-semibold text-ink-primary">Cargos</h3>
          <p className="text-sm text-ink-muted">O cargo dá cor ao nome no chat e soma permissões ao membro. Administradores já têm todas.</p>
          {roles.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              onSave={(value) => run(() => api.updateCommunityRole(role.id, value))}
              onDelete={() =>
                setConfirm({
                  title: `Apagar cargo ${role.name}?`,
                  description: 'Quem tem este cargo volta a ficar sem cargo.',
                  label: 'Apagar cargo',
                  action: async () => {
                    await api.deleteCommunityRole(role.id);
                    onChanged();
                  },
                })
              }
            />
          ))}
          <RoleForm initial={EMPTY_ROLE} submitLabel="Criar cargo" onSubmit={(value) => run(() => api.createCommunityRole(community.id, value))} />
        </section>
      )}
      <section className="space-y-2">
        <h3 className="font-semibold text-ink-primary">Membros</h3>
        {members
          .filter((member) => owner || (member.role !== 'OWNER' && member.userId !== meId))
          .map((member) => (
            <MemberRow
              key={member.userId}
              member={member}
              owner={owner}
              roles={roles}
              onCustomRole={(roleId) => void run(() => api.setMemberCustomRole(community.id, member.userId, roleId))}
              onRole={() =>
                void run(() =>
                  api.updateCommunityMemberRole(
                    community.id,
                    member.userId,
                    member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN',
                  ),
                )
              }
              onRemove={
                member.role !== 'OWNER' && member.userId !== meId && myPermissions.kickMembers && (owner || member.role === 'MEMBER')
                  ? () =>
                      setConfirm({
                        title: `Expulsar ${member.name}?`,
                        description: 'Será necessário outro convite para voltar.',
                        label: 'Expulsar membro',
                        action: async () => {
                          await api.removeCommunityMember(community.id, member.userId);
                          onChanged();
                        },
                      })
                  : undefined
              }
            />
          ))}
      </section>
      {myPermissions.manageInvites && <section className="space-y-2">
        <h3 className="font-semibold text-ink-primary">Convites</h3>
        {invitesLoading && (
          <div role="status" className="text-sm text-ink-muted">
            Carregando convites...
            <Skeleton className="h-10" />
          </div>
        )}
        {invitesFailed && <Banner variant="error">Não foi possível carregar convites.</Banner>}
        {!invitesLoading && !invitesFailed && invites.length === 0 && (
          <p className="text-sm text-ink-muted">Nenhum convite.</p>
        )}
        {invites.map((invite) => (
          <div key={invite.id} className="flex items-center gap-2 text-sm text-ink-muted">
            <span className="flex-1">
              {invite.uses} uso(s) · expira em {new Date(invite.expiresAt).toLocaleString('pt-BR')}
              {invite.revokedAt ? ' · revogado' : ''}
            </span>
            {!invite.revokedAt && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void run(() => api.revokeCommunityInvite(invite.id)).then(loadInvites)
                }
              >
                Revogar
              </Button>
            )}
          </div>
        ))}
      </section>}
      {myRole === 'OWNER' && (
        <Button
          variant="danger"
          onClick={() =>
            setConfirm({
              title: `Apagar ${community.name}?`,
              description: 'Todos os canais e mensagens serão apagados definitivamente.',
              label: 'Apagar comunidade',
              requiredName: community.name,
              action: async () => {
                await api.deleteCommunity(community.id);
                onGone();
              },
            })
          }
        >
          Apagar comunidade
        </Button>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          description={confirm.description}
          confirmLabel={confirm.label}
          requiredName={confirm.requiredName}
          onConfirm={confirm.action}
          onClose={() => {
            setConfirm(null);
            requestAnimationFrame(() =>
              document.getElementById('community-dialog-heading')?.focus(),
            );
          }}
        />
      )}
    </Frame>
  );
}
