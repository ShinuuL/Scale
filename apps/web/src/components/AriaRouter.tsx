'use client';

import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { RouterProvider } from 'react-aria-components';

declare module 'react-aria-components' {
  interface RouterConfig {
    routerOptions: NonNullable<Parameters<ReturnType<typeof useRouter>['push']>[1]>;
  }
}

/**
 * Links de componentes react-aria (ex.: `MenuItem href`) navegam pelo roteador
 * do Next: sem recarregar a página, a chamada em andamento continua ativa.
 */
export function AriaRouter({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <RouterProvider navigate={(href, options) => router.push(href, options)}>
      {children}
    </RouterProvider>
  );
}
