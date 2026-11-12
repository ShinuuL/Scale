'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';

const versionSchema = z.object({ version: z.string().min(1).max(64) });
const callSchema = z.object({ active: z.boolean() });
const CHECK_EVERY_MS = 5 * 60_000;
/** Versao deste bundle (next.config). Vazio em `next dev`: o aviso fica desligado. */
const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID ?? '';

/**
 * Nova versao publicada: avisa e oferece recarregar. O HTML nunca sai do cache do
 * service worker (sw.js e network-only para navegacao), entao o reload ja traz o
 * build novo. Nunca recarrega sozinho: uma chamada em andamento cairia.
 */
export function UpdatePrompt() {
  const [available, setAvailable] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const checking = useRef(false);

  useEffect(() => {
    if (!CURRENT) return;
    let disposed = false;
    const check = async () => {
      if (checking.current || document.visibilityState === 'hidden') return;
      checking.current = true;
      try {
        const response = await fetch('/version.json', { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) return;
        const parsed = versionSchema.safeParse(await response.json());
        if (!disposed && parsed.success && parsed.data.version !== CURRENT) setAvailable(true);
      } catch {
        /* Sem rede: tenta na proxima. */
      } finally {
        checking.current = false;
      }
    };
    const onCall = (event: Event) => {
      const parsed = callSchema.safeParse((event as CustomEvent<unknown>).detail);
      if (parsed.success) setCallActive(parsed.data.active);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void check(); };
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('scale:call-state', onCall);
    void check();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('scale:call-state', onCall);
    };
  }, []);

  if (!available) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex w-[min(460px,calc(100vw-32px))] -translate-x-1/2 flex-wrap items-center gap-3 rounded-xl border border-line bg-surface-secondary px-4 py-3 text-sm text-ink-primary shadow-lg">
      <p className="min-w-0 flex-1">
        Nova versão do Scale disponível.
        {callActive && <span className="block text-xs text-ink-muted">Recarregar agora encerra a chamada atual.</span>}
      </p>
      <button type="button" className="btn-primary min-h-10 px-4 py-2 text-sm" onClick={() => window.location.reload()}>
        Recarregar
      </button>
      <button type="button" className="btn-ghost min-h-10 px-3 py-2 text-sm" onClick={() => setAvailable(false)}>
        Depois
      </button>
    </div>
  );
}
