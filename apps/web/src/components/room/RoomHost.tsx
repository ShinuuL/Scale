'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { ToastProvider } from '@/components/ui/Toast';
import { RoomSession } from '@/components/room/RoomSession';

/**
 * Mantém a sessão da sala montada no layout raiz. Na rota `/room?id=` a tela
 * aparece; nas outras áreas (Amigos, Ajuda...) ela fica oculta e a ligação
 * segue ativa, com a `MiniCallBar`. Quem sai sem ter entrado (carregando,
 * senha) desmonta a sessão para não entrar na sala em segundo plano.
 */
export function RoomHost() {
  return (
    <Suspense fallback={null}>
      <RoomHostInner />
    </Suspense>
  );
}

function RoomHostInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onRoomRoute = pathname === '/room' || pathname === '/room/';
  const routeRoomId = onRoomRoute ? (searchParams.get('id')?.trim() ?? '') : '';
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (routeRoomId) {
      if (routeRoomId !== activeRoomId) {
        setJoined(false);
        setActiveRoomId(routeRoomId);
      }
    } else if (!joined && activeRoomId !== null) {
      setActiveRoomId(null);
    }
  }, [routeRoomId, joined, activeRoomId]);

  const handleJoinedChange = useCallback((value: boolean) => setJoined(value), []);

  if (!activeRoomId) return null;
  return (
    <ToastProvider>
      <RoomSession
        key={activeRoomId}
        roomId={activeRoomId}
        visible={routeRoomId === activeRoomId}
        onJoinedChange={handleJoinedChange}
      />
    </ToastProvider>
  );
}
