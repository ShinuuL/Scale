import { clsx } from 'clsx';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      aria-label="Carregando..."
      className={clsx(
        'w-full h-20 rounded-xl bg-white/5 animate-pulse',
        className,
      )}
    />
  );
}
