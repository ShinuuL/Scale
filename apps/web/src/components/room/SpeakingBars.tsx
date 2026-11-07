'use client';

import { clsx } from 'clsx';

/**
 * Três barrinhas de equalizador: dançam enquanto a pessoa fala e somem quando
 * ela para. Com "reduzir movimento" no sistema ficam paradas (só indicam).
 * Decorativo: quem usa leitor de tela recebe ", falando" no texto ao lado.
 */
export function SpeakingBars({
  active,
  className,
  size = 'md',
}: {
  active: boolean;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      aria-hidden="true"
      data-testid="speaking-bars"
      data-active={active ? 'true' : 'false'}
      className={clsx(
        'inline-flex items-end gap-[2px] transition-opacity duration-150 motion-reduce:transition-none',
        size === 'sm' ? 'h-3' : 'h-3.5',
        active ? 'opacity-100' : 'opacity-0',
        className,
      )}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={clsx(
            'block w-[3px] origin-bottom rounded-full bg-brand-400 h-full',
            active ? 'animate-eq-bar motion-reduce:animate-none' : 'scale-y-[0.3]',
          )}
          style={active ? { animationDelay: `${[-0.2, -0.45, 0][i]}s` } : undefined}
        />
      ))}
    </span>
  );
}
