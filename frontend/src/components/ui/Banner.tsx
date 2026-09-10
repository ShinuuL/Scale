'use client';

import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export type BannerVariant = 'info' | 'warning' | 'error' | 'success';

interface BannerProps {
  variant?: BannerVariant;
  /** Ícone exibido à esquerda. Default por variante quando omitido. */
  icon?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  /** Área de ações (botões/links) à direita. */
  action?: ReactNode;
  /** Conteúdo extra abaixo de title/description (ex.: links + botão copiar). */
  children?: ReactNode;
  className?: string;
  role?: 'alert' | 'status' | 'log';
}

const variantClasses: Record<
  BannerVariant,
  { container: string; text: string; muted: string }
> = {
  info: {
    container: 'bg-brand-500/10 border-brand-500/30',
    text: 'text-brand-200',
    muted: 'text-brand-300/80',
  },
  warning: {
    container: 'bg-amber-500/10 border-amber-500/30',
    text: 'text-amber-200',
    muted: 'text-amber-300/80',
  },
  error: {
    container: 'bg-red-500/10 border-red-500/30',
    text: 'text-red-200',
    muted: 'text-red-300/80',
  },
  success: {
    container: 'bg-emerald-500/10 border-emerald-500/30',
    text: 'text-emerald-200',
    muted: 'text-emerald-300/80',
  },
};

const defaultIcons: Record<BannerVariant, string> = {
  info: 'ℹ️',
  warning: '⚠️',
  error: '⛔',
  success: '✅',
};

export function Banner({
  variant = 'info',
  icon,
  title,
  description,
  action,
  children,
  className,
  role = variant === 'error' || variant === 'warning' ? 'alert' : 'status',
}: BannerProps) {
  const styles = variantClasses[variant];

  return (
    <div
      role={role}
      className={clsx(
        'rounded-xl border px-4 py-3 flex items-start gap-3',
        styles.container,
        className,
      )}
    >
      <span className={clsx('text-lg flex-shrink-0 leading-none', styles.text)} aria-hidden="true">
        {icon ?? defaultIcons[variant]}
      </span>
      <div className={clsx('flex-1 min-w-0 text-sm', styles.text)}>
        {title && <p className="font-medium">{title}</p>}
        {description && <div className={clsx('mt-1 text-xs', styles.muted)}>{description}</div>}
        {children}
      </div>
      {action && (
        <div className="flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {action}
        </div>
      )}
    </div>
  );
}