'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ToastProvider } from '@/components/ui/Toast';
import { RoomSession } from '@/components/room/RoomSession';
import {
  START_CALL_EVENT,
  callScreenPath,
  setActiveCall,
  type StartCallDetail,
} from '@/lib/callControl';

/**
 * Mantém a sessão da sala montada no layout raiz. Na rota `/room?id=` a tela
 * aparece; nas outras áreas (Amigos, Ajuda...) ela fica oculta e a ligação
 * segue ativa, com a `MiniCallBar`. Quem sai sem ter entrado (carregando,
 * senha) desmonta a sessão para não entrar na sala em segundo plano — exceto
 * quando a entrada em segundo plano foi pedida de propósito
 * (`startBackgroundCall`, canal de voz da comunidade).
 */
export function RoomHost() {
  return (
    <Suspense fallback={null}>
      <RoomHostInner />
    </Suspense>
  );
}

function RoomHostInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onRoomRoute = pathname === '/room' || pathname === '/room/';
  const routeRoomId = onRoomRoute ? (searchParams.get('id')?.trim() ?? '') : '';
  const routeCommunityId = onRoomRoute ? searchParams.get('c') : null;
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [communityId, setCommunityId] = useState<string | null>(null);
  const [background, setBackground] = useState(false);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (routeRoomId) {
      if (routeRoomId !== activeRoomId) {
        setJoined(false);
        setActiveRoomId(routeRoomId);
        setCommunityId(routeCommunityId);
      } else if (routeCommunityId) {
        setCommunityId(routeCommunityId);
      }
      setBackground(false);
    } else if (!joined && !background && activeRoomId !== null) {
      setActiveRoomId(null);
      setCommunityId(null);
    }
  }, [routeRoomId, routeCommunityId, joined, background, activeRoomId]);

  useEffect(() => {
    const onStart = (event: Event) => {
      const { roomId, communityId: community } = (event as CustomEvent<StartCallDetail>).detail;
      if (!roomId) return;
      setActiveRoomId((current) => {
        if (current !== roomId) setJoined(false);
        return roomId;
      });
      setCommunityId(community ?? null);
      setBackground(true);
    };
    window.addEventListener(START_CALL_EVENT, onStart);
    return () => window.removeEventListener(START_CALL_EVENT, onStart);
  }, []);

  useEffect(() => {
    setActiveCall(activeRoomId ? { roomId: activeRoomId, joined } : null);
  }, [activeRoomId, joined]);

  const handleJoinedChange = useCallback((value: boolean) => {
    setJoined(value);
    // Entrou: daqui em diante vale a regra comum (sessão fica até sair).
    if (value) setBackground(false);
  }, []);

  // A entrada oculta precisa de interação (senha, erro, sala expirada): abre a
  // tela da chamada em vez de falhar escondido.
  const handleNeedsScreen = useCallback(() => {
    if (activeRoomId) router.push(callScreenPath(activeRoomId, communityId));
  }, [router, activeRoomId, communityId]);

  if (!activeRoomId) return null;
  return (
    <ToastProvider>
      <RoomSession
        key={activeRoomId}
        roomId={activeRoomId}
        communityId={communityId}
        visible={routeRoomId === activeRoomId}
        onJoinedChange={handleJoinedChange}
        onNeedsScreen={handleNeedsScreen}
      />
    </ToastProvider>
  );
}
