'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Icon } from '@/components/ui/Icon';
import {
  RELEASES_URL,
  currentOperatingSystem,
  downloadOffer,
  type OperatingSystem,
} from '@/lib/downloads';

/** Dentro do proprio app desktop nao faz sentido oferecer o instalador. */
function isDesktopApp(): boolean {
  return typeof navigator !== 'undefined' && / Electron\//i.test(navigator.userAgent);
}

export interface DesktopDownloadProps {
  /**
   * `section` destaca o botao (bloco "Baixar o aplicativo" da página inicial);
   * `panel` e a versão compacta usada dentro do painel de aplicativo.
   */
  variant?: 'section' | 'panel';
  className?: string;
}

/**
 * Botão de download do app desktop já apontando para o sistema do visitante.
 *
 * A detecção só acontece depois da montagem: a página é exportada
 * estaticamente, então o HTML servido não pode depender do navegador.
 */
export function DesktopDownload({ variant = 'section', className }: DesktopDownloadProps) {
  const [os, setOs] = useState<OperatingSystem | null>(null);
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    setInApp(isDesktopApp());
    setOs(currentOperatingSystem());
  }, []);

  if (inApp) return null;
  // Antes de montar (e durante o export estático) nada é renderizado, para não
  // oferecer o instalador errado por um instante.
  if (!os) return null;

  const { primary, secondary, note } = downloadOffer(os);
  const compact = variant === 'panel';

  return (
    <div className={clsx(compact ? 'space-y-2' : 'space-y-3', className)}>
      {primary && (
        <a
          href={primary.url}
          className={clsx(
            'btn-primary inline-flex items-center justify-center gap-2 font-medium',
            'transition-colors duration-150 motion-reduce:transition-none',
            'focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950',
            compact ? 'min-h-11 px-4 py-2 text-sm' : 'px-5 py-2.5 text-sm',
          )}
        >
          <Icon name="download" />
          {primary.label}
        </a>
      )}
      <p className={clsx('max-w-prose leading-5', compact ? 'text-xs text-ink-muted' : 'text-sm text-ink-secondary')}>
        {primary ? `${primary.detail}. ${note}` : note}
      </p>
      {secondary.length > 0 && (
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {secondary.map((option) => (
            <li key={option.id}>
              <a
                href={option.url}
                className="text-xs text-ink-muted underline underline-offset-4 hover:text-ink-secondary"
                title={option.detail}
              >
                {option.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <a
        href={RELEASES_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="inline-flex items-center gap-1.5 text-xs text-ink-muted underline underline-offset-4 hover:text-ink-secondary"
      >
        <Icon name="github" size={14} />
        Todas as versões e notas de atualização
      </a>
    </div>
  );
}
