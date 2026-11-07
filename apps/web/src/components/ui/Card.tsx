'use client';

import type { ReactNode, HTMLAttributes } from 'react';
import { clsx } from 'clsx';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  variant?: 'glass' | 'subtle' | 'solid';
}

const variantClasses = {
  glass: 'glass',
  subtle: 'glass-subtle',
  solid: 'bg-surface-tertiary border border-line rounded-xl',
} as const;

export function Card({ children, variant = 'glass', className, ...props }: CardProps) {
  return (
    <div className={clsx(variantClasses[variant], 'p-6', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('mb-4', className)}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h3 className={clsx('text-lg font-semibold text-ink-primary', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={clsx('text-sm text-ink-muted mt-1', className)}>
      {children}
    </p>
  );
}

export function CardContent({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      {children}
    </div>
  );
}
