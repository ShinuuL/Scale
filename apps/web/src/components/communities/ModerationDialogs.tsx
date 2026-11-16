'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import {
  Button as AriaButton, Label, ListBox, ListBoxItem, Popover, Select, SelectValue, Tab, TabList, Tabs,
} from 'react-aria-components';
import {
  COMMUNITY_AUDIT_LABELS, MODERATION_REASON_MAX, TIMEOUT_DURATION_LABELS,
  type CommunityAuditEntry, type CommunityBan, type TimeoutDuration,
} from '@scale/shared';
import { AppModal } from '@/components/ui/AppModal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { api } from '@/lib/api';
import type { Member } from './CommunityParts';

/* ─── Fase 3: moderacao (castigo, expulsao, banimento) e auditoria ─── */

export type ModerationAction = 'timeout' | 'kick' | 'ban';

const DURATIONS = (Object.keys(TIMEOUT_DURATION_LABELS) as TimeoutDuration[]).map((id) => ({
  id, label: TIMEOUT_DURATION_LABELS[id],
}));
const COPY: Record<ModerationAction, { title: string; icon: 'clock' | 'logOut' | 'ban'; confirm: string; text: string }> = {
  timeout: {
    title: 'Castigar', icon: 'clock', confirm: 'Aplicar castigo',
    text: 'Enquanto durar, o membro não envia mensagens, não reage e não entra em canais de voz.',
  },
  kick: {
    title: 'Expulsar', icon: 'logOut', confirm: 'Expulsar membro',
    text: 'O membro sai da comunidade e da voz. Ele pode voltar com um novo convite.',
  },
  ban: {
    title: 'Banir', icon: 'ban', confirm: 'Banir membro',
    text: 'O membro sai da comunidade e da voz e não pode voltar por convite até ser desbanido.',
  },
};

/** Texto do erro para a acao de moderacao. */
export function moderationError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 429) return 'Muitas ações seguidas. Aguarde alguns minutos.';
  if (status === 403) return 'Você não pode agir sobre este membro.';
  if (status === 404) return 'Este membro não está mais na comunidade.';
  return 'Não foi possível concluir a ação. Tente novamente.';
}

/** Confirmacao com motivo (e duracao, no castigo). */
export function ModerationDialog({
  action,
  member,
  onConfirm,
  onClose,
}: {
  action: ModerationAction;
  member: Pick<Member, 'name'>;
  onConfirm: (input: { duration: TimeoutDuration; reason?: string }) => Promise<void>;
  onClose: () => void;
}) {
  const copy = COPY[action];
  const descId = useId();
  const reasonId = useId();
  const [duration, setDuration] = useState<TimeoutDuration>('10m');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm({ duration, reason: reason.trim() || undefined });
      onClose();
    } catch (err) {
      setError(moderationError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppModal title={`${copy.title} ${member.name}`} icon={copy.icon} closeLabel="Fechar" onClose={onClose} locked={busy} role="alertdialog" describedBy={descId}>
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <p id={descId} className="text-sm text-ink-secondary">{copy.text}</p>
        {action === 'timeout' && (
          <Select
            selectedKey={duration}
            onSelectionChange={(key) => { if (key !== null) setDuration(String(key) as TimeoutDuration); }}
            isDisabled={busy}
            className="space-y-1"
          >
            <Label className="block text-sm font-medium text-ink-secondary">Duração</Label>
            <AriaButton className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-tertiary px-3 py-2.5 text-left text-sm text-ink-primary outline-none data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent">
              <SelectValue className="truncate" />
              <Icon name="chevronDown" className="text-ink-muted" />
            </AriaButton>
            <Popover offset={6} className="z-[110] w-[--trigger-width] overflow-auto rounded-xl border border-line bg-surface-secondary p-1 shadow-xl data-[entering]:animate-menu-in">
              <ListBox items={DURATIONS} className="outline-none">
                {(item) => (
                  <ListBoxItem id={item.id} textValue={item.label} className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-primary outline-none data-[focused]:bg-surface-hover data-[selected]:font-medium">
                    {({ isSelected }) => (
                      <>
                        <span>{item.label}</span>
                        {isSelected && <Icon name="check" className="shrink-0 text-accent" />}
                      </>
                    )}
                  </ListBoxItem>
                )}
              </ListBox>
            </Popover>
          </Select>
        )}
        <div className="space-y-1.5">
          <label htmlFor={reasonId} className="block text-sm font-medium text-ink-secondary">Motivo (opcional)</label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, MODERATION_REASON_MAX))}
            maxLength={MODERATION_REASON_MAX}
            rows={3}
            disabled={busy}
            className="input-base resize-none"
            aria-describedby={`${reasonId}-count`}
          />
          <p id={`${reasonId}-count`} className="text-xs text-ink-muted">{reason.length}/{MODERATION_REASON_MAX}</p>
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" variant="danger" disabled={busy} aria-busy={busy}>{busy ? 'Aplicando...' : copy.confirm}</Button>
        </div>
      </form>
    </AppModal>
  );
}

export type SettingsTab = 'general' | 'bans' | 'audit';

/** Abas das configuracoes da comunidade (Geral, Banidos, Auditoria). */
export function SettingsTabs({ value, onChange, showBans }: { value: SettingsTab; onChange: (tab: SettingsTab) => void; showBans: boolean }) {
  const tab = 'rounded-lg px-3 py-1.5 text-sm text-ink-muted outline-none cursor-pointer data-[selected]:bg-surface-hover data-[selected]:text-ink-primary data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent';
  return (
    <Tabs selectedKey={value} onSelectionChange={(key) => onChange(String(key) as SettingsTab)}>
      <TabList aria-label="Seções das configurações" className="flex gap-1 border-b border-line pb-2">
        <Tab id="general" className={tab}>Geral</Tab>
        {showBans && <Tab id="bans" className={tab}>Banidos</Tab>}
        <Tab id="audit" className={tab}>Auditoria</Tab>
      </TabList>
    </Tabs>
  );
}

const dateLabel = (iso: string): string => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Lista de banidos com desbanir. */
export function BansPanel({ communityId }: { communityId: string }) {
  const [bans, setBans] = useState<CommunityBan[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => api.listCommunityBans(communityId).then((r) => setBans(r.bans)).catch(() => setError('Não foi possível carregar os banidos.')), [communityId]);
  useEffect(() => { void load(); }, [load]);
  const unban = async (ban: CommunityBan) => {
    setBusy(ban.userId);
    setError('');
    try {
      await api.unbanCommunityMember(communityId, ban.userId);
      await load();
    } catch (err) {
      setError(moderationError(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="space-y-2" aria-label="Banidos">
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {bans === null && !error && <p role="status" className="text-sm text-ink-muted">Carregando...</p>}
      {bans?.length === 0 && <p className="text-sm text-ink-muted">Ninguém foi banido.</p>}
      <ul className="space-y-2">
        {bans?.map((ban) => (
          <li key={ban.userId} className="flex items-start gap-2 rounded-lg border border-line p-2">
            <Icon name="ban" className="mt-0.5 shrink-0 text-ink-muted" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-ink-primary">{ban.name}</p>
              <p className="text-xs text-ink-muted">{dateLabel(ban.createdAt)}{ban.reason ? ` · ${ban.reason}` : ''}</p>
            </div>
            <Button size="sm" variant="ghost" aria-label={`Desbanir ${ban.name}`} disabled={busy === ban.userId} onClick={() => void unban(ban)}>
              Desbanir
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Acoes cujo detalhe (o que mudou) aparece depois de dois pontos. */
const DETAILED = new Set<CommunityAuditEntry['action']>(['member.nickname', 'channel.settings', 'channel.user_limit', 'community.welcome']);

/** Texto de uma linha do registro. */
export function auditText(entry: CommunityAuditEntry): string {
  const target = entry.targetName ? `${entry.action === 'community.welcome' ? ' em' : ''} ${entry.targetName}` : '';
  const detail = !entry.detail ? '' : entry.action === 'member.timeout' ? ` por ${entry.detail}` : DETAILED.has(entry.action) ? `: ${entry.detail}` : '';
  return `${entry.actorName} · ${COMMUNITY_AUDIT_LABELS[entry.action]}${target}${detail}`;
}

/** Registro de auditoria paginado. */
export function AuditPanel({ communityId }: { communityId: string }) {
  const [entries, setEntries] = useState<CommunityAuditEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (after?: string) => {
    setLoading(true);
    setError('');
    try {
      const page = await api.getCommunityAudit(communityId, after);
      setEntries((previous) => (after ? [...previous, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
    } catch {
      setError('Não foi possível carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, [communityId]);
  useEffect(() => { void load(); }, [load]);
  return (
    <section className="space-y-2" aria-label="Auditoria">
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      {!loading && !error && entries.length === 0 && <p className="text-sm text-ink-muted">Nenhuma ação registrada.</p>}
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-line p-2">
            <p className="text-sm text-ink-primary">{auditText(entry)}</p>
            <p className="text-xs text-ink-muted">{dateLabel(entry.createdAt)}{entry.reason ? ` · Motivo: ${entry.reason}` : ''}</p>
          </li>
        ))}
      </ul>
      {loading && <p role="status" className="text-sm text-ink-muted">Carregando...</p>}
      {cursor && !loading && (
        <Button size="sm" variant="secondary" onClick={() => void load(cursor)}>Carregar mais</Button>
      )}
    </section>
  );
}
