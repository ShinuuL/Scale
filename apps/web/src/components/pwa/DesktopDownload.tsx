'use client';

import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { Icon } from '@/components/ui/Icon';
import {
  RELEASES_URL,
  currentOperatingSystem,
  downloadOffer,
  fetchDesktopAssets,
  type DesktopAssets,
  type OperatingSystem,
} from '@/lib/downloads';

export interface DesktopDownloadProps {
  /**
   * `section` destaca o botao (bloco "Baixar o aplicativo" da página inicial);
   * `panel` e a versão compacta usada dentro do painel de aplicativo.
   */
  variant?: 'section' | 'panel';
  /**
   * Quando `false`, nem detecta o sistema nem consulta a API de releases.
   *
   * O painel de aplicativo fica em TODA pagina dentro de um `<details>`
   * fechado; buscar ali de olhos fechados faria toda visita (inclusive a sala
   * em chamada) bater em `api.github.com` sem ninguem ter pedido download.
   */
  ativo?: boolean;
  className?: string;
}

/**
 * Botão de download do app desktop nativo já apontando para o sistema do
 * visitante.
 *
 * Tudo acontece depois da montagem: a página é exportada estaticamente, então
 * o HTML servido não pode depender nem do navegador nem da API do GitHub.
 */
export function DesktopDownload({ variant = 'section', ativo = true, className }: DesktopDownloadProps) {
  const [os, setOs] = useState<OperatingSystem | null>(null);
  const [assets, setAssets] = useState<DesktopAssets | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!ativo) return;
    setOs(currentOperatingSystem());
    const controller = new AbortController();
    // A guarda e POR EFEITO, nao pelo signal: em dev o StrictMode roda o efeito
    // duas vezes e a busca abortada da primeira volta `null` logo depois: sem
    // `vigente`, esse `null` sobrescreveria o resultado bom da segunda.
    let vigente = true;
    void fetchDesktopAssets(controller.signal).then((found) => {
      if (!vigente) return;
      setAssets(found);
      setCarregando(false);
    });
    return () => {
      vigente = false;
      controller.abort();
    };
  }, [ativo]);

  // Antes de montar (e durante o export estático) nada é renderizado, para não
  // oferecer o instalador errado por um instante.
  if (!os || carregando) return null;

  const { primary, secondary, note } = downloadOffer(os, assets);
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
        {assets ? `Versão ${assets.version} · todas as versões` : 'Todas as versões e notas de atualização'}
      </a>
    </div>
  );
}
