import type { ReactNode } from 'react';
export function GlassPanel({
  children,
  className = ''
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`l-glass ${className}`}>
    {children}
  </div>;
}
