'use client';

import { useId, useState } from 'react';
import type { ModerationVerdict } from '@scale/shared';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { api, type ApiError } from '@/lib/api';

const CATEGORY_LABELS: Record<ModerationVerdict['category'], string> = {
  bullying: 'Bullying',
  hate: 'Ódio',
  sexual: 'Sexual',
  violence: 'Violência',
  none: 'Nenhuma',
};

const SEVERITY_LABELS: Record<ModerationVerdict['severity'], string> = {
  low: 'Baixa',
  medium: 'Média',
  high: 'Alta',
};

const TEXT_MAX = 2000;

/**
 * Classifica um texto com o provedor efetivo sem gravar evento: serve para
 * conferir chave e modelo antes de confiar na configuracao.
 */
export function ModerationTestSection() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<ModerationVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const run = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    setVerdict(null);
    try {
      setVerdict(await api.testAdminModeration(trimmed));
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 502) {
        setError(`Erro do provedor: ${apiErr.detail ?? 'sem detalhe'}.`);
      } else if (apiErr.status === 429) {
        setError('Muitos testes seguidos. Aguarde alguns minutos.');
      } else {
        setError('Não foi possível testar agora.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="glass p-5 sm:p-6" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-base font-semibold text-ink-primary">
        Testar
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        O texto vai ao provedor efetivo e volta com um veredito. Nada é gravado.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="space-y-1.5">
          <label htmlFor={`${id}-text`} className="block text-sm font-medium text-ink-secondary">
            Texto de teste
          </label>
          <textarea
            id={`${id}-text`}
            className="input-base min-h-[96px] resize-y"
            value={text}
            maxLength={TEXT_MAX}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="secondary" disabled={busy || text.trim() === ''} aria-busy={busy}>
            {busy ? 'Classificando...' : 'Classificar'}
          </Button>
        </div>
      </form>
      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200" role="alert">
          {error}
        </p>
      )}
      {verdict && (
        <dl className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-line p-4 text-sm sm:grid-cols-3" role="status" aria-label="Veredito">
          <div>
            <dt className="text-xs text-ink-muted">Resultado</dt>
            <dd className="mt-1">
              <Badge variant={verdict.flagged ? 'error' : 'success'}>
                {verdict.flagged ? 'Sinalizado' : 'Liberado'}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Categoria</dt>
            <dd className="mt-1 text-ink-primary">{CATEGORY_LABELS[verdict.category]}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Severidade</dt>
            <dd className="mt-1 text-ink-primary">{SEVERITY_LABELS[verdict.severity]}</dd>
          </div>
          <div className="sm:col-span-3">
            <dt className="text-xs text-ink-muted">Motivo</dt>
            <dd className="mt-1 text-ink-primary">{verdict.reason || 'Sem motivo informado'}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
