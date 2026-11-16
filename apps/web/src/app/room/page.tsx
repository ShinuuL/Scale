'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * Rota estatica `/room?id=<uuid>&token=<convite>` (export estatico: sem rota
 * dinamica). A sala em si e renderizada pelo `RoomHost` do layout raiz, para a
 * chamada continuar ativa quando a pessoa navega para outra area do app. Esta
 * pagina so trata o link sem identificador.
 */
export default function RoomPage() {
  return (
    <Suspense fallback={null}>
      <MissingRoomId />
    </Suspense>
  );
}

function MissingRoomId() {
  const searchParams = useSearchParams();
  if (searchParams.get('id')?.trim()) return null;
  return (
    <main
      id="main-content"
      className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p className="text-ink-secondary">Link de sala incompleto: falta o identificador da sala.</p>
      <Link href="/" className="text-accent underline">
        Voltar ao inicio
      </Link>
    </main>
  );
}
