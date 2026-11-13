'use client';

import { useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Checkbox } from 'react-aria-components';
import { SCREEN_SHARE_CONSENT_VERSION, type ModerationConfig, type ScreenShareGate } from '@scale/shared';
import { AppModal } from '@/components/ui/AppModal';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { api } from '@/lib/api';

export interface ScreenShareGateDialogProps {
  /** Estado atual do gate (do `me`; convidado = reason 'guest'). */
  gate: ScreenShareGate;
  /** Config publica da moderacao (null = ainda carregando / indisponivel). */
  config: ModerationConfig | null;
  onClose: () => void;
  /** Gate mudou no servidor (idade ou consentimento salvos). */
  onGateChange: (gate: ScreenShareGate) => void;
  /** Usuario confirmou: a sala chama `toggleScreenShare`. */
  onConfirm: () => void;
}

const DEFAULT_MIN_AGE = 18;

/** Data de nascimento: formato, data real, nao futura e no maximo 120 anos. */
export const birthDateInputSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Data inválida.')
  .refine((value) => new Date(`${value}T00:00:00Z`).getTime() <= Date.now(), 'A data não pode ser no futuro.')
  .refine((value) => {
    const year = Number(value.slice(0, 4));
    return new Date().getUTCFullYear() - year <= 120;
  }, 'Confira o ano informado.');

type Step = 'guest' | 'age' | 'underage' | 'consent' | 'confirm';

function stepFor(gate: ScreenShareGate, consentVersion: string): Step {
  if (gate.reason === 'guest') return 'guest';
  if (!gate.ageVerified) return 'age';
  if (!gate.isAdult) return 'underage';
  if (gate.consentVersion !== consentVersion || !gate.allowed) return 'consent';
  return 'confirm';
}

function errorMessage(err: unknown, fallback: string): string {
  const status =
    typeof err === 'object' && err !== null && 'status' in err ? (err as { status?: unknown }).status : undefined;
  if (status === 400) return 'Data inválida. Confira e tente de novo.';
  if (status === 401) return 'Sua sessão expirou. Entre de novo.';
  if (status === 429) return 'Muitas alterações seguidas. Tente de novo em alguns minutos.';
  return fallback;
}

/**
 * Gate de partilha de tela (spec 5). Decide o passo pelo estado do `me`:
 * convidado (entrar com conta), idade (data de nascimento), menor (bloqueio),
 * termo (checkbox "Li e concordo") e, sempre, a confirmacao curta antes de
 * pedir a tela ao navegador — e a "confirmacao do usuario".
 */
export function ScreenShareGateDialog({ gate, config, onClose, onGateChange, onConfirm }: ScreenShareGateDialogProps) {
  const consentVersion = config?.consentVersion ?? SCREEN_SHARE_CONSENT_VERSION;
  const minAge = config?.minAge ?? DEFAULT_MIN_AGE;
  const screenAnalysis = config?.screen === true;
  const step = stepFor(gate, consentVersion);

  const [birthDate, setBirthDate] = useState('');
  const [birthError, setBirthError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveBirthDate = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = birthDateInputSchema.safeParse(birthDate.trim());
    if (!parsed.success) {
      setBirthError(parsed.error.issues[0]?.message ?? 'Data inválida.');
      return;
    }
    setBirthError(null);
    setError(null);
    setBusy(true);
    try {
      const res = await api.setBirthDate(parsed.data);
      const consentOk = gate.consentVersion === consentVersion;
      onGateChange({
        ...gate,
        ageVerified: res.ageVerified,
        isAdult: res.isAdult,
        allowed: res.isAdult && consentOk,
        reason: !res.isAdult ? 'age' : consentOk ? 'ok' : 'consent',
      });
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar a data de nascimento.'));
    } finally {
      setBusy(false);
    }
  };

  const giveConsent = async () => {
    if (!agreed) return;
    setError(null);
    setBusy(true);
    try {
      await api.giveScreenShareConsent();
      onGateChange({ ...gate, consentVersion, allowed: gate.isAdult, reason: gate.isAdult ? 'ok' : 'age' });
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível registrar o consentimento.'));
    } finally {
      setBusy(false);
    }
  };

  const errorBox = error && (
    <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {error}
    </p>
  );

  if (step === 'guest') {
    return (
      <AppModal title="Compartilhar tela" icon="monitor" closeLabel="Fechar" onClose={onClose} size="sm" describedBy="gate-guest-desc">
        <p id="gate-guest-desc" className="text-sm text-ink-secondary">
          Entre com uma conta para compartilhar a tela. A partilha exige idade verificada e um
          termo aceito, e isso só é possível com conta.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Agora não
          </Button>
          <Link href="/login" className="btn-primary inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium">
            <Icon name="key" /> Entrar
          </Link>
        </div>
      </AppModal>
    );
  }

  if (step === 'underage') {
    return (
      <AppModal title="Partilha de tela indisponível" icon="ban" closeLabel="Fechar" onClose={onClose} size="sm" describedBy="gate-underage-desc">
        <p id="gate-underage-desc" role="status" className="text-sm text-ink-secondary">
          Partilha de tela disponível a partir de {minAge} anos. Você ainda pode falar, ouvir e usar o
          chat normalmente.
        </p>
        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Fechar
          </Button>
        </div>
      </AppModal>
    );
  }

  if (step === 'age') {
    return (
      <AppModal title="Verificar idade" icon="shield" closeLabel="Fechar" onClose={onClose} locked={busy} size="sm" describedBy="gate-age-desc">
        <form onSubmit={(e) => void saveBirthDate(e)} className="space-y-4">
          <p id="gate-age-desc" className="text-sm text-ink-secondary">
            Para compartilhar a tela é preciso ter pelo menos {minAge} anos. Informe sua data de
            nascimento: ela fica só na sua conta e nunca é exibida para outras pessoas.
          </p>
          <Input
            id="gate-birth-date"
            type="date"
            label="Data de nascimento"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            error={birthError ?? undefined}
            helperText="Formato AAAA-MM-DD. Pode remover em Configurações > Privacidade."
            autoComplete="bday"
            required
          />
          {errorBox}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || birthDate.trim().length === 0} aria-busy={busy}>
              {busy ? 'Salvando...' : 'Continuar'}
            </Button>
          </div>
        </form>
      </AppModal>
    );
  }

  if (step === 'consent') {
    return (
      <AppModal title="Termo de partilha de tela" icon="shield" closeLabel="Fechar" onClose={onClose} locked={busy} describedBy="gate-consent-desc">
        <div className="space-y-4">
          <div id="gate-consent-desc" className="space-y-2 text-sm text-ink-secondary">
            <p>Antes de compartilhar a tela pela primeira vez, confirme que você entende:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Tudo o que aparecer na tela escolhida é transmitido a todos na sala.</li>
              <li>
                Um assistente de moderação ajuda a evitar conteúdo ofensivo. Mensagens do chat são
                analisadas;{' '}
                {screenAnalysis
                  ? 'amostras pequenas da sua tela também podem ser analisadas enquanto você compartilha, e são descartadas em seguida.'
                  : 'a análise de amostras da tela está desligada neste servidor.'}
              </li>
              <li>O áudio da chamada não é monitorado: ele vai direto entre os participantes.</li>
              <li>
                Você pode revogar este consentimento a qualquer momento em Configurações &gt;
                Privacidade. Detalhes na{' '}
                <Link href="/privacy" className="text-brand-300 underline hover:text-ink-primary">
                  política de privacidade
                </Link>
                .
              </li>
            </ul>
            <p className="text-xs text-ink-muted">Versão do termo: {consentVersion}.</p>
          </div>
          <Checkbox
            isSelected={agreed}
            onChange={setAgreed}
            isDisabled={busy}
            className="group flex cursor-pointer items-start gap-3 text-sm text-ink-primary"
          >
            {({ isSelected, isFocusVisible }) => (
              <>
                <span
                  aria-hidden="true"
                  className={[
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                    isSelected ? 'border-accent bg-accent text-white' : 'border-line bg-surface-tertiary',
                    isFocusVisible ? 'outline outline-2 outline-offset-2 outline-accent' : '',
                  ].join(' ')}
                >
                  {isSelected && <Icon name="check" size={14} />}
                </span>
                <span>Li e concordo</span>
              </>
            )}
          </Checkbox>
          {errorBox}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button onClick={() => void giveConsent()} disabled={!agreed || busy} aria-busy={busy}>
              {busy ? 'Salvando...' : 'Concordar e continuar'}
            </Button>
          </div>
        </div>
      </AppModal>
    );
  }

  return (
    <AppModal title="Confirmar partilha de tela" icon="monitor" closeLabel="Fechar" onClose={onClose} size="sm" describedBy="gate-confirm-desc">
      <p id="gate-confirm-desc" className="text-sm text-ink-secondary">
        Sua tela será exibida para todos na sala.
        {screenAnalysis && ' Amostras pequenas podem ser analisadas pelo assistente de moderação e descartadas em seguida.'}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button autoFocus onClick={onConfirm}>
          <Icon name="monitor" /> Compartilhar
        </Button>
      </div>
    </AppModal>
  );
}
