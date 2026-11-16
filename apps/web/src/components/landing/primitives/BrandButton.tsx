import Link from 'next/link';
import type { ReactNode } from 'react';
export function BrandButton({
  href,
  children,
  outline = false
}: {
  href: string;
  children: ReactNode;
  outline?: boolean;
}) {
  return <Link className={`l-button ${outline ? 'l-button-outline' : ''}`} href={href}>
    {children}
  </Link>;
}
