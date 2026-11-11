'use client';

import { useState } from 'react';
import {
  Button as AriaButton,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select,
  SelectValue,
} from 'react-aria-components';
import {
  MODERATION_REPORT_DETAILS_MAX,
  moderationReportSchema,
  type ModerationReportPayload,
} from '@scale/shared';
import { AppModal } from '@/components/ui/AppModal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';

type ReportReason = ModerationReportPayload['reason'];

export const REPORT_REASONS: { id: ReportReason; label: string }[] = [
  { id: 'bullying', label: 'Bullying ou assédio' },
  { id: 'hate', label: 'Discurso de ódio' },
  { id: 'sexual', label: 'Conteúdo sexual' },
  { id: 'violence', label: 'Violência' },
  { id: 'other', label: 'Outro' },
];

export interface ReportDialogProps {
  roomId: string;
  target: { peerId: string; name: string };
  /** Envia `moderation:report`; rejeita com a mensagem do servidor. */
  onSubmit: (payload: ModerationReportPayload) => Promise<void>;
  onClose: () => void;
}

/**
 * Denuncia de participante (spec 4.3): motivo (Select react-aria) e detalhes
 * opcionais (<= 300). O payload e validado com o schema do @scale/shared antes
 * de ir ao socket; o dono da sala recebe `moderation:notice`.
 */
export function ReportDialog({ roomId, target, onSubmit, onClose }: ReportDialogProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = moderationReportSchema.safeParse({
      roomId,
      targetPeerId: target.peerId,
      reason: reason ?? undefined,
      details: details.trim() || undefined,
    });
    if (!parsed.success) {
      setError(reason ? 'Confira os detalhes informados.' : 'Escolha um motivo.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(parsed.data);
      setDone(true);
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : 'Não foi possível enviar a denúncia.';
      setError(/limit|muitas|rate/i.test(message) ? 'Muitas denúncias seguidas. Tente de novo mais tarde.' : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppModal
      title={`Denunciar ${target.name}`}
      icon="flag"
      closeLabel="Fechar"
      onClose={onClose}
      locked={busy}
      describedBy="report-desc"
    >
      {done ? (
        <div className="space-y-4">
          <p id="report-desc" role="status" className="text-sm text-ink-secondary">
            Denúncia enviada. O dono da sala foi avisado e o registro fica guardado por tempo
            limitado para análise.
          </p>
          <div className="flex justify-end">
            <Button autoFocus onClick={onClose}>
              Fechar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <p id="report-desc" className="text-sm text-ink-secondary">
            Conte o que aconteceu. A denúncia vai para o dono da sala; nada é enviado ao
            participante denunciado.
          </p>
          <Select
            selectedKey={reason}
            onSelectionChange={(key) => setReason(key === null ? null : (String(key) as ReportReason))}
            placeholder="Escolha um motivo"
            isDisabled={busy}
            className="space-y-1"
          >
            <Label className="block text-sm font-medium text-ink-secondary">Motivo</Label>
            <AriaButton className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-tertiary px-3 py-2.5 text-left text-sm text-ink-primary outline-none transition-colors hover:border-white/20 data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-accent">
              <SelectValue className="truncate data-[placeholder]:text-ink-muted" />
              <Icon name="chevronDown" size={16} className="text-ink-muted" />
            </AriaButton>
            <Popover
              offset={6}
              className="z-[110] w-[--trigger-width] overflow-auto rounded-xl border border-line bg-surface-secondary p-1 shadow-[0_12px_40px_rgb(0_0_0/0.35)] data-[entering]:animate-menu-in"
            >
              <ListBox items={REPORT_REASONS} className="outline-none">
                {(item) => (
                  <ListBoxItem
                    id={item.id}
                    textValue={item.label}
                    className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-ink-primary outline-none data-[focused]:bg-white/[0.08] data-[selected]:font-medium"
                  >
                    {({ isSelected }) => (
                      <>
                        <span>{item.label}</span>
                        {isSelected && <Icon name="check" size={16} className="shrink-0 text-accent" />}
                      </>
                    )}
                  </ListBoxItem>
                )}
              </ListBox>
            </Popover>
          </Select>

          <div className="space-y-1.5">
            <label htmlFor="report-details" className="block text-sm font-medium text-ink-secondary">
              Detalhes (opcional)
            </label>
            <textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value.slice(0, MODERATION_REPORT_DETAILS_MAX))}
              maxLength={MODERATION_REPORT_DETAILS_MAX}
              rows={3}
              disabled={busy}
              className="input-base resize-none"
              aria-describedby="report-details-count"
            />
            <p id="report-details-count" className="text-xs text-ink-muted">
              {details.length}/{MODERATION_REPORT_DETAILS_MAX}
            </p>
          </div>

          {error && (
            <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" variant="danger" disabled={busy} aria-busy={busy}>
              {busy ? 'Enviando...' : 'Enviar denúncia'}
            </Button>
          </div>
        </form>
      )}
    </AppModal>
  );
}
