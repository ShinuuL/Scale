'use client';

import Image from 'next/image';
import { clsx } from 'clsx';

export interface LogoProps {
  size?: number;
  variant?: 'mark' | 'full' | 'wordmark';
  className?: string;
  priority?: boolean;
  alt?: string;
}

const GLOW_CLASS = 'drop-shadow-[0_0_8px_rgba(139,92,246,0.38)]';

/**
 * Logo do Scale — PNG escamado (frontend/public/logo.png) é a fonte da
 * verdade. O SVG (logo.svg) existe apenas como fallback vetorial e nunca
 * é referenciado aqui.
 */
export function Logo({
  size = 28,
  variant = 'mark',
  className,
  priority = false,
  alt = 'Scale logo',
}: LogoProps) {
  if (variant === 'wordmark') {
    return (
      <span className={clsx('text-base font-bold tracking-tight text-white', className)}>
        Scale
      </span>
    );
  }

  if (variant === 'full') {
    return (
      <span
        role="img"
        aria-label={alt}
        className={clsx('flex items-center gap-2', className)}
      >
        <Image
          src="/logo.png"
          alt=""
          width={size}
          height={size}
          priority={priority}
          className={GLOW_CLASS}
        />
        <span className="text-base font-bold tracking-tight text-white">Scale</span>
      </span>
    );
  }

  return (
    <Image
      src="/logo.png"
      alt={alt}
      role="img"
      width={size}
      height={size}
      priority={priority}
      style={{ width: size, height: size }}
      className={clsx(GLOW_CLASS, className)}
    />
  );
}