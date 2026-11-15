'use client';

import { useId, useState } from 'react';
import { COMMUNITY_NICKNAME_MAX, type CommunityVoiceState } from '@scale/shared';
import { AppModal } from '@/components/ui/AppModal';
import { Button } from '@/components/ui/Button';
import type { Member } from './CommunityParts';

/* ─── Fase 4: apelido por comunidade ─── */

/** Apelidos definidos, por userId. */
export function nicknameMap(members: ReadonlyArray<Pick<Member, 'userId' | 'nickname'>>): Map<string, string> {
  return new Map(members.flatMap((m) => (m.nickname ? [[m.userId, m.nickname] as const] : [])));
}

/** Estados de voz com o apelido no lugar do nome (cartoes do canal de voz). */
export function withVoiceNicknames(states: CommunityVoiceState[], nicknames: ReadonlyMap<string, string>): CommunityVoiceState[] {
  if (nicknames.size === 0) return states;
  return states.map((state) => ({
    ...state,
    members: state.members.map((member) => ({ ...member, name: nicknames.get(member.userId) ?? member.name })),
  }));
}

/** Texto do erro ao salvar o apelido. */
export function nicknameError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 429) return 'Muitas mudanças de apelido. Aguarde alguns minutos.';
  if (status === 403) return 'Você não pode mudar o apelido deste membro.';
  if (status === 404) return 'Este membro não está mais na comunidade.';
  return 'Não foi possível salvar o apelido. Tente novamente.';
}

/** "Mudar apelido": vazio limpa (volta ao nome real). */
export function NicknameDialog({
  member,
  self,
  onSave,
  onClose,
}: {
  member: Pick<Member, 'name' | 'nickname'>;
  self: boolean;
  onSave: (nickname: string | null) => Promise<void>;
  onClose: () => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState(member.nickname ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (nickname: string | null) => {
    setBusy(true);
    setError('');
    try {
      await onSave(nickname);
      onClose();
    } catch (err) {
      setError(nicknameError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <AppModal title={self ? 'Mudar apelido' : `Mudar apelido de ${member.name}`} closeLabel="Fechar" onClose={onClose} locked={busy} size="sm">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(value.trim() || null);
        }}
        className="space-y-4"
      >
        <div className="space-y-1.5">
          <label htmlFor={inputId} className="block text-sm font-medium text-ink-secondary">Apelido nesta comunidade</label>
          <input
            id={inputId}
            value={value}
            onChange={(event) => setValue(event.target.value.slice(0, COMMUNITY_NICKNAME_MAX))}
            maxLength={COMMUNITY_NICKNAME_MAX}
            placeholder={member.name}
            disabled={busy}
            className="input-base"
            aria-describedby={`${inputId}-hint`}
          />
          <p id={`${inputId}-hint`} className="text-xs text-ink-muted">
            Aparece no lugar do nome só nesta comunidade. O nome real continua no perfil. {value.length}/{COMMUNITY_NICKNAME_MAX}
          </p>
        </div>
        {error && <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          {member.nickname && (
            <Button type="button" variant="ghost" onClick={() => void save(null)} disabled={busy}>Remover apelido</Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" disabled={busy} aria-busy={busy}>{busy ? 'Salvando...' : 'Salvar'}</Button>
        </div>
      </form>
    </AppModal>
  );
}
