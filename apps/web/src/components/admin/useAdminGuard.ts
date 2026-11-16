'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserEvents } from '@/hooks/useUserEvents';
import { api, applyMeAdmin, type MeUser } from '@/lib/api';
import { setFlash } from '@/lib/flash';
import { ADMIN_ONLY_FLASH } from './moderationLabels';

export type AdminAuthState = 'loading' | 'ready' | 'error';

export interface AdminGuard {
  me: MeUser | null;
  setMe: (user: MeUser) => void;
  authState: AdminAuthState;
  /** 403 de uma rota admin (papel removido no meio): aviso + home. */
  denied: () => void;
}

/**
 * Guarda das paginas de administracao: sem login vai para /login; logado sem
 * `isAdmin` volta para a home com aviso. O servidor repete a checagem (403) em
 * toda rota; isto so evita mostrar a tela a quem nao pode usa-la.
 */
export function useAdminGuard(): AdminGuard {
  const router = useRouter();
  const [me, setMeState] = useState<MeUser | null>(null);
  const [authState, setAuthState] = useState<AdminAuthState>('loading');

  // Ref: `denied` estavel, para nao refazer as buscas das paginas a cada render.
  const routerRef = useRef(router);
  routerRef.current = router;

  const denied = useCallback(() => {
    setFlash(ADMIN_ONLY_FLASH, 'error');
    routerRef.current.replace('/');
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      let user: MeUser;
      try {
        user = (await api.getMe()).user;
      } catch (err) {
        if (!alive) return;
        if ((err as { status?: number }).status === 401) {
          routerRef.current.replace('/login');
          return;
        }
        setAuthState('error');
        return;
      }
      if (!alive) return;
      if (user.isAdmin !== true) {
        denied();
        return;
      }
      setMeState(user);
      setAuthState('ready');
    })();
    return () => {
      alive = false;
    };
  }, [denied]);

  const setMe = useCallback(
    (user: MeUser) => {
      setMeState(user);
      // Papel removido enquanto a pagina estava aberta (me:admin ou perfil salvo).
      if (user.isAdmin !== true) denied();
    },
    [denied],
  );

  // `me:admin`: papel removido por outro admin enquanto a tela esta aberta.
  useUserEvents(authState === 'ready', {
    onMeAdmin: (event) => {
      if (me) setMe(applyMeAdmin(me, event));
    },
  });

  return { me, setMe, authState, denied };
}
