'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** A rota da chamada remonta a mídia: sair sempre exige uma decisão explícita. */
export function useRoomNavigation(joined: boolean) {
  const allowed = useRef(false);
  const [pendingDestination, setPendingDestination] = useState<string | null>(null);
  const requestNavigation = useCallback(
    (href: string): boolean => {
      if (!joined) return true;
      setPendingDestination(href);
      return false;
    },
    [joined],
  );
  const allowNavigation = useCallback(() => {
    allowed.current = true;
  }, []);
  const cancelNavigation = useCallback(() => setPendingDestination(null), []);
  useEffect(() => {
    if (!joined) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowed.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [joined]);
  return { pendingDestination, requestNavigation, allowNavigation, cancelNavigation };
}
