'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { birthDateInputSchema } from '@/components/room/ScreenShareGateDialog';
import { api, screenShareGateOf, type MeUser } from '@/lib/api';

export interface PrivacySettingsProps {
  user: MeUser;
  /** Perfil recarregado do servidor apos cada alteracao. */
  onUserChange?: (user: MeUser) => void;
}

function errorMessage(err: unknown, fallback: string): string {
  const status =
    typeof err === 'object' && err !== null && 'status' in err ? (err as { status?: unknown }).status : undefined;
  if (status === 400) return 'Data inválida. Confira e tente de novo.';
  if (status === 401) return 'Sua sessão expirou. Entre de novo.';
  if (status === 429) return 'Muitas alterações seguidas. Tente de novo em alguns minutos.';
  return fallback;
}

/** Dispara o download de um Blob como arquivo (nada vai para a URL). */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/**
 * Secao "Privacidade" das Configuracoes (spec 6, so com conta): data de
 * nascimento (so o status, nunca a data), consentimento de partilha de tela
 * (versao / revogar), exportacao dos dados (LGPD) e link para /privacy.
 */
export function PrivacySettings({ user, onUserChange }: PrivacySettingsProps) {
  const gate = screenShareGateOf(user);
  const [birthDate, setBirthDate] = useState('');
  const [birthError, setBirthError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'age' | 'consent' | 'export' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const refresh = async (message: string) => {
    const res = await api.getMe();
    onUserChange?.(res.user);
    setSaved(message);
  };

  const run = async (kind: 'age' | 'consent' | 'export', action: () => Promise<void>, fallback: string) => {
    setBusy(kind);
    setError(null);
    setSaved(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, fallback));
    } finally {
      setBusy(null);
    }
  };

  const saveBirthDate = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = birthDateInputSchema.safeParse(birthDate.trim());
    if (!parsed.success) {
      setBirthError(parsed.error.issues[0]?.message ?? 'Data inválida.');
      return;
    }
    setBirthError(null);
    void run(
      'age',
      async () => {
        await api.setBirthDate(parsed.data);
        setBirthDate('');
        await refresh('Data de nascimento verificada.');
      },
      'Não foi possível salvar a data de nascimento.',
    );
  };

  const removeBirthDate = () =>
    run(
      'age',
      async () => {
        await api.deleteBirthDate();
        await refresh('Data de nascimento removida.');
      },
      'Não foi possível remover a data de nascimento.',
    );

  const revokeConsent = () =>
    run(
      'consent',
      async () => {
        await api.revokeScreenShareConsent();
        await refresh('Consentimento revogado. Ele será pedido de novo ao compartilhar a tela.');
      },
      'Não foi possível revogar o consentimento.',
    );

  const exportData = () =>
    run(
      'export',
      async () => {
        const blob = await api.exportPrivacyData();
        downloadBlob(blob, `scale-meus-dados-${new Date().toISOString().slice(0, 10)}.json`);
        setSaved('Arquivo gerado. Confira a pasta de downloads.');
      },
      'Não foi possível exportar seus dados.',
    );

  return (
    <section aria-labelledby="settings-privacy" className="space-y-4 border-t border-white/[0.08] pt-4">
      <h3 id="settings-privacy" className="flex items-center gap-2 text-xs font-medium text-ink-muted">
        <Icon name="shield" size={14} /> Privacidade
      </h3>

      {/* Idade: so o status; a data nunca volta do servidor. */}
      <div className="space-y-2">
        <p className="text-sm text-ink-secondary">
          Data de nascimento:{' '}
          {gate.ageVerified ? (
            <span className="text-ink-primary">
              verificada, maior de idade: {gate.isAdult ? 'sim' : 'não'}
            </span>
          ) : (
            <span className="text-ink-muted">não informada</span>
          )}
        </p>
        {gate.ageVerified ? (
          <Button variant="ghost" size="sm" onClick={() => void removeBirthDate()} disabled={busy !== null} aria-busy={busy === 'age'}>
            Remover data de nascimento
          </Button>
        ) : (
          <form onSubmit={saveBirthDate} className="space-y-2">
            <Input
              id="settings-birth-date"
              type="date"
              label="Informar data de nascimento"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              error={birthError ?? undefined}
              helperText="Usada só para liberar a partilha de tela. Nunca é exibida."
              autoComplete="bday"
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={busy !== null || birthDate.trim().length === 0} aria-busy={busy === 'age'}>
                {busy === 'age' ? 'Salvando...' : 'Salvar data'}
              </Button>
            </div>
          </form>
        )}
      </div>

      {/* Consentimento de partilha de tela */}
      <div className="space-y-2">
        <p className="text-sm text-ink-secondary">
          Termo de partilha de tela:{' '}
          {gate.consentVersion ? (
            <span className="text-ink-primary">aceito (versão {gate.consentVersion})</span>
          ) : (
            <span className="text-ink-muted">não aceito — será pedido ao compartilhar a tela</span>
          )}
        </p>
        {gate.consentVersion && (
          <Button variant="ghost" size="sm" onClick={() => void revokeConsent()} disabled={busy !== null} aria-busy={busy === 'consent'}>
            Revogar consentimento
          </Button>
        )}
      </div>

      {(error || saved) && (
        <p
          role={error ? 'alert' : 'status'}
          className={
            error
              ? 'rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300'
              : 'rounded-lg border border-brand-500/30 bg-brand-500/10 px-3 py-2 text-sm text-brand-200'
          }
        >
          {error ?? saved}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void exportData()} disabled={busy !== null} aria-busy={busy === 'export'}>
          <Icon name="document" size={14} />
          {busy === 'export' ? 'Gerando...' : 'Baixar meus dados'}
        </Button>
        <Link href="/privacy" className="text-sm text-brand-300 underline hover:text-ink-primary">
          Política de privacidade
        </Link>
      </div>
    </section>
  );
}
