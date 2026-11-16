'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';

const versionSchema = z.object({ version: z.string().min(1).max(64) });
const callSchema = z.object({ active: z.boolean() });
const CHECK_EVERY_MS = 5 * 60_000;
/** "Depois" adia o aviso; ele volta passado esse tempo se a pagina ainda for antiga. */
export const SNOOZE_MS = 30 * 60_000;
/** Versao deste bundle (next.config). Vazio em `next dev`: o aviso fica desligado. */
const CURRENT = process.env.NEXT_PUBLIC_BUILD_ID ?? '';

/** Pedaco de JS que sumiu do servidor: sinal forte de que houve deploy. */
export function isChunkError(reason: unknown): boolean {
  const text = reason instanceof Error ? `${reason.name} ${reason.message}` : String(reason ?? '');
  return /ChunkLoadError|Loading (CSS )?chunk|dynamically imported module|Importing a module script failed/i.test(text);
}

function callActiveNow(): boolean {
  return document.documentElement.dataset.scaleCallActive === 'true';
}

/**
 * Nova versao publicada: avisa e pede para recarregar a pagina. O HTML nunca sai do
 * cache do service worker (sw.js e network-only para navegacao), entao o reload ja
 * traz o build novo. Nunca recarrega sozinho no meio de uma chamada: com chamada
 * ativa, oferece "recarregar ao sair da chamada".
 */
export function UpdatePrompt() {
  const [available, setAvailable] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(0);
  const [now, setNow] = useState(0);
  const [callActive, setCallActive] = useState(false);
  const [reloadAfterCall, setReloadAfterCall] = useState(false);
  const checking = useRef(false);

  const reload = useCallback(() => window.location.reload(), []);

  useEffect(() => {
    if (!CURRENT) return;
    let disposed = false;
    setCallActive(callActiveNow());
    const check = async () => {
      setNow(Date.now());
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
    const onError = (event: ErrorEvent) => { if (isChunkError(event.error ?? event.message)) void check(); };
    const onRejection = (event: PromiseRejectionEvent) => { if (isChunkError(event.reason)) void check(); };
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('online', onVisible);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('scale:call-state', onCall);
    void check();
    return () => {
      disposed = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('online', onVisible);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('scale:call-state', onCall);
    };
  }, []);

  // Pediu "ao sair da chamada": recarrega assim que a chamada termina.
  useEffect(() => {
    if (reloadAfterCall && !callActive) reload();
  }, [reloadAfterCall, callActive, reload]);

  if (reloadAfterCall) {
    return (
      <p role="status" className="sr-only">
        A página será recarregada com a nova versão quando a chamada terminar.
      </p>
    );
  }
  if (!available || now < snoozedUntil) return null;

  const link = 'rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';
  return (
    <div
      role="alertdialog"
      aria-labelledby="scale-update-title"
      aria-describedby="scale-update-desc"
      className={`fixed right-4 z-50 w-[min(300px,calc(100vw-32px))] rounded-xl border border-line bg-surface-secondary/95 p-3 text-ink-primary shadow-xl backdrop-blur animate-slide-up motion-reduce:animate-none ${
        callActive ? 'bottom-20 max-lg:bottom-[calc(140px+env(safe-area-inset-bottom))]' : 'bottom-4 max-lg:bottom-[calc(76px+env(safe-area-inset-bottom))]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-1 size-2 shrink-0 rounded-full bg-accent" />
        <div className="min-w-0 flex-1">
          <p id="scale-update-title" className="text-sm font-medium">Nova versão disponível</p>
          <p id="scale-update-desc" className="mt-0.5 text-xs leading-snug text-ink-muted">
            {callActive ? 'Recarregar agora encerra a chamada.' : 'Recarregue a página para atualizar.'}
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
            {callActive ? (
              <>
                <button type="button" className={`${link} text-accent hover:text-ink-primary`} onClick={() => setReloadAfterCall(true)}>
                  Recarregar ao sair da chamada
                </button>
                <button type="button" className={`${link} text-ink-muted hover:text-ink-primary`} onClick={reload}>
                  Recarregar agora
                </button>
              </>
            ) : (
              <button type="button" className={`${link} text-accent hover:text-ink-primary`} onClick={reload}>
                Recarregar
              </button>
            )}
            <button
              type="button"
              className={`${link} text-ink-muted hover:text-ink-primary`}
              onClick={() => {
                const at = Date.now();
                setNow(at);
                setSnoozedUntil(at + SNOOZE_MS);
              }}
            >
              Depois
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
