'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Banner } from '@/components/ui/Banner';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const callSchema = z.object({ active: z.boolean() });
const notificationSchema = z.object({ tag: z.string().max(80).optional() });
const NOTIFICATIONS_KEY = 'scale:notifications';
const actionClass = 'btn-secondary min-h-11 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400';

/** Optional conveniences: no permission request or installation prompt on load. */
export function ApplicationFeatures() {
  const [offline, setOffline] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [notificationSupported, setNotificationSupported] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const notificationsRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    let installing: ServiceWorker | null = null;
    const lastNotification = new Map<string, number>();
    const syncNetwork = () => setOffline(!navigator.onLine);
    const onCall = (event: Event) => {
      const parsed = callSchema.safeParse((event as CustomEvent<unknown>).detail);
      if (parsed.success) setCallActive(parsed.data.active);
    };
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const installed = () => setInstallPrompt(null);
    const notify = (event: Event) => {
      if (!notificationsRef.current || document.visibilityState !== 'hidden' || Notification.permission !== 'granted') return;
      const parsed = notificationSchema.safeParse((event as CustomEvent<unknown>).detail);
      if (!parsed.success) return;
      const tag = parsed.data.tag ?? 'scale-activity';
      if (Date.now() - (lastNotification.get(tag) ?? 0) < 5000) return;
      lastNotification.set(tag, Date.now());
      const options = {
        body: 'Nova atividade no Scale. Abra o aplicativo para conferir.',
        icon: '/icon-192.png', tag,
      };
      try {
        // Intentionally generic: private names/messages never reach the lock screen.
        const notification = new Notification('Scale', options);
        notification.onclick = () => { window.focus(); notification.close(); };
      } catch {
        // Mobile browsers require an active worker rather than the constructor.
        if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration?.()
          .then((reg) => reg?.active && reg.showNotification('Scale', options)).catch(() => {});
      }
    };
    const workerChanged = () => {
      if (!disposed && installing?.state === 'installed' && navigator.serviceWorker.controller) setUpdateReady(true);
    };
    const updateFound = () => {
      installing?.removeEventListener('statechange', workerChanged);
      installing = registration?.installing ?? null;
      installing?.addEventListener('statechange', workerChanged);
    };
    syncNetwork();
    setNotificationSupported('Notification' in window && window.isSecureContext);
    try {
      const enabled = 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem(NOTIFICATIONS_KEY) === 'on';
      notificationsRef.current = enabled;
      setNotifications(enabled);
    } catch { /* Storage can be disabled. */ }
    window.addEventListener('online', syncNetwork);
    window.addEventListener('offline', syncNetwork);
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('appinstalled', installed);
    window.addEventListener('scale:call-state', onCall);
    window.addEventListener('scale:notification', notify);
    if ('serviceWorker' in navigator && window.isSecureContext && process.env.NODE_ENV === 'production') {
      void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then((reg) => {
        if (disposed) return;
        registration = reg;
        setUpdateReady(Boolean(reg.waiting));
        reg.addEventListener('updatefound', updateFound);
      }).catch(() => { /* The online application remains usable without SW. */ });
    }
    return () => {
      disposed = true;
      window.removeEventListener('online', syncNetwork);
      window.removeEventListener('offline', syncNetwork);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', installed);
      window.removeEventListener('scale:call-state', onCall);
      window.removeEventListener('scale:notification', notify);
      registration?.removeEventListener('updatefound', updateFound);
      installing?.removeEventListener('statechange', workerChanged);
    };
  }, []);

  async function toggleNotifications() {
    if (busy) return;
    setBusy(true);
    try {
      const enabled = !notifications && await Notification.requestPermission() === 'granted';
      notificationsRef.current = enabled;
      setNotifications(enabled);
      try { localStorage.setItem(NOTIFICATIONS_KEY, enabled ? 'on' : 'off'); } catch { /* Session-only preference. */ }
      setStatus(enabled ? 'Notificações ativadas enquanto o Scale estiver aberto.' : 'Notificações desativadas. Se o acesso foi bloqueado, altere nas permissões do aplicativo.');
    } catch {
      setStatus('Não foi possível ativar notificações. Confira as permissões do aplicativo.');
    } finally { setBusy(false); }
  }

  async function install() {
    if (!installPrompt || busy) return;
    setBusy(true);
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
    } catch { setStatus('Use o menu do navegador para instalar o Scale.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      {offline && <div className="mx-auto max-w-5xl px-4 py-3"><Banner variant="warning" title="Sem conexão com o servidor" description="Verifique sua rede. Salas, mensagens e arquivos podem ficar indisponíveis." /></div>}
      <details className="mx-auto max-w-5xl px-4 py-3 text-sm text-slate-300">
        <summary className="w-fit cursor-pointer rounded-lg py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400">Aplicativo e notificações</summary>
        <div className="flex flex-wrap items-center gap-3 py-3">
          {installPrompt && <button type="button" className={actionClass} onClick={() => void install()} disabled={busy}>Instalar Scale</button>}
          {notificationSupported && <button type="button" className={actionClass} onClick={() => void toggleNotifications()} disabled={busy} aria-pressed={notifications}>{notifications ? 'Desativar notificações' : 'Ativar notificações'}</button>}
          <p className="max-w-prose text-sm">Notificações opcionais, sem prévia de mensagens, enquanto o aplicativo estiver aberto. Para instalar, use também o menu do navegador.</p>
        </div>
        <p role="status" className="max-w-prose text-sm text-slate-200">{status}</p>
        {updateReady && <p role="status" className="max-w-prose py-2">{callActive ? 'Atualização pronta. Sua chamada continua; atualize depois de sair.' : 'Atualização pronta. Feche todas as janelas do Scale e abra novamente para aplicar.'}</p>}
      </details>
    </>
  );
}
