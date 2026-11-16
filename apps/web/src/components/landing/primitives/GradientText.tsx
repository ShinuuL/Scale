import type { ReactNode } from 'react';
export function GradientText({
  children
}: {
  children: ReactNode;
}) {
  return <span className="l-gradient">
    {children}
  </span>;
}
