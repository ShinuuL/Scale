'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { Icon } from '@/components/ui/Icon';
import { Banner } from '@/components/ui/Banner';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const callSchema = z.object({ active: z.boolean() });
const notificationSchema = z.object({ tag: z.string().max(80).optional() });
const NOTIFICATIONS_KEY = 'scale:notifications';
const INSTALL_OFFER_KEY = 'scale:install-offer';

/** Rodando como app instalado (Android/desktop por media query; iOS por navigator.standalone). */
export function isStandalone(win: Window = window): boolean {
  const iosStandalone = (win.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosStandalone || Boolean(win.matchMedia?.('(display-mode: standalone)').matches);
}

/** iPhone/iPad no Safari: instala so por Compartilhar > Adicionar a Tela de Inicio. */
export function isIosSafari(nav: Navigator = navigator): boolean {
  const ua = nav.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
}

/** Instalador nativo (Rust, apps/desktop-native). Sem URL no build, so resta o PWA. */
const DESKTOP_DOWNLOAD_URL = z.string().url().startsWith('https://').safeParse(process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL).data;
const actionClass = 'btn-secondary min-h-11 px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400';

/** Optional conveniences: no permission request or installation prompt on load. */
export function ApplicationFeatures() {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const closeSettings = useCallback(() => {
    const details = detailsRef.current;
    if (!details) return;
    details.open = false;
    const canFocus = (element: HTMLElement | null): element is HTMLElement => {
      if (!element?.isConnected || element.closest('[hidden], [inert], dialog:not([open]), :disabled')) return false;
      for (let node: HTMLElement | null = element; node; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
      }
      return true;
    };
    const candidates = [triggerRef.current, document.querySelector<HTMLElement>('[data-app-settings-trigger]'), details.querySelector<HTMLElement>('summary')];
    candidates.find(canFocus)?.focus();
    triggerRef.current = null;
  }, []);
  const [offline, setOffline] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [updateReady, setUpdateReady] = useState(false);
  const [callActive, setCallActive] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [notificationSupported, setNotificationSupported] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const notificationsRef = useRef(false);
  const [standalone, setStandalone] = useState(false);
  const [iosManual, setIosManual] = useState(false);
  const [offerVisible, setOfferVisible] = useState(false);

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
    const installed = () => { setInstallPrompt(null); setOfferVisible(false); };
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
    const runningStandalone = isStandalone();
    setStandalone(runningStandalone);
    setIosManual(!runningStandalone && isIosSafari());
    try { setOfferVisible(!runningStandalone && localStorage.getItem(INSTALL_OFFER_KEY) !== 'dismissed'); } catch { /* Sem storage: nao oferece. */ }
    setNotificationSupported('Notification' in window && window.isSecureContext);
    try {
      const enabled = 'Notification' in window && Notification.permission === 'granted' && localStorage.getItem(NOTIFICATIONS_KEY) === 'on';
      notificationsRef.current = enabled;
      setNotifications(enabled);
    } catch { /* Storage can be disabled. */ }
    const openSettings = (event: Event) => {
      const details = detailsRef.current;
      if (!details) return;
      if (details.open) { closeSettings(); return; }
      const trigger = (event as CustomEvent<{ trigger?: unknown }>).detail?.trigger;
      triggerRef.current = trigger instanceof HTMLElement ? trigger : document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !details.contains(document.activeElement) ? document.activeElement : null;
      details.open = true;
      details.querySelector('summary')?.focus();
    };
    // Clique fora fecha, como qualquer popover. O gatilho fica de fora: ele ja alterna.
    const outside = (event: PointerEvent) => {
      const details = detailsRef.current;
      const target = event.target;
      if (!details?.open || !(target instanceof Node) || details.contains(target)) return;
      if (target instanceof Element && target.closest('[data-app-settings-trigger]')) return;
      closeSettings();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('scale:app-settings', openSettings);
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
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('scale:app-settings', openSettings);
      window.removeEventListener('online', syncNetwork);
      window.removeEventListener('offline', syncNetwork);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', installed);
      window.removeEventListener('scale:call-state', onCall);
      window.removeEventListener('scale:notification', notify);
      registration?.removeEventListener('updatefound', updateFound);
      installing?.removeEventListener('statechange', workerChanged);
    };
  }, [closeSettings]);

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

  function dismissOffer() {
    setOfferVisible(false);
    try { localStorage.setItem(INSTALL_OFFER_KEY, 'dismissed'); } catch { /* Vale so nesta sessao. */ }
  }

  async function install() {
    if (!installPrompt || busy) return;
    setBusy(true);
    try {
      await installPrompt.prompt();
      await installPrompt.userChoice;
      setInstallPrompt(null);
      setOfferVisible(false);
    } catch { setStatus('Use o menu do navegador para instalar o Scale.'); }
    finally { setBusy(false); }
  }

  return (
    <>
      {offline && <div className="fixed right-4 top-20 z-50 w-[min(420px,calc(100vw-32px))]"><Banner variant="warning" title="Sem conexão com o servidor" description="Verifique sua rede. Salas, mensagens e arquivos podem ficar indisponíveis." /></div>}
      <details ref={detailsRef} className="pwa-features" onKeyDown={(event) => { if (event.key === 'Escape' && detailsRef.current?.open) { event.preventDefault(); event.stopPropagation(); closeSettings(); } }}>
        <summary onClick={(event) => { if (detailsRef.current?.open) { event.preventDefault(); closeSettings(); } else triggerRef.current = null; }} className="w-fit cursor-pointer rounded-lg py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-400"><Icon name="monitor" size={16} /><span>Aplicativo e notificações</span></summary>
        <div className="flex flex-wrap items-center gap-3 py-3">
          {DESKTOP_DOWNLOAD_URL && <a href={DESKTOP_DOWNLOAD_URL} className={actionClass} rel="noopener noreferrer" download>Baixar para Windows</a>}
          {!standalone && installPrompt && <button type="button" className={actionClass} onClick={() => void install()} disabled={busy}>{DESKTOP_DOWNLOAD_URL ? 'Instalar no navegador' : 'Instalar Scale'}</button>}
          {notificationSupported && <button type="button" className={actionClass} onClick={() => void toggleNotifications()} disabled={busy} aria-pressed={notifications}>{notifications ? 'Desativar notificações' : 'Ativar notificações'}</button>}
          <p className="max-w-prose text-sm">Notificações opcionais, sem prévia de mensagens, enquanto o aplicativo estiver aberto.{standalone ? '' : ' Para instalar, use também o menu do navegador.'}</p>
        </div>
        {iosManual && <IosInstallSteps />}
        <p role="status" className="max-w-prose text-sm text-slate-200">{status}</p>
        {updateReady && <p role="status" className="max-w-prose py-2">{callActive ? 'Atualização pronta. Sua chamada continua; atualize depois de sair.' : 'Atualização pronta. Feche todas as janelas do Scale e abra novamente para aplicar.'}</p>}
      </details>
      {offerVisible && (installPrompt || iosManual) && (
        <aside aria-label="Instalar o Scale" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-4 right-4 z-40 mx-auto max-w-sm rounded-xl border border-white/10 bg-forest-900 p-4 text-sm text-slate-100 shadow-lg">
          <p className="font-medium">Instale o Scale no seu aparelho</p>
          {iosManual ? <IosInstallSteps /> : <p className="mt-1 text-slate-300">Abre em tela cheia, direto da tela inicial.</p>}
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="button" className={actionClass} onClick={dismissOffer}>Agora não</button>
            {installPrompt && !iosManual && <button type="button" className={actionClass} onClick={() => void install()} disabled={busy}>Instalar</button>}
          </div>
        </aside>
      )}
    </>
  );
}

function IosInstallSteps() {
  return (
    <div className="max-w-prose py-2 text-sm text-slate-200">
      <p className="flex flex-wrap items-center gap-1">
        Toque em <span className="inline-flex items-center gap-1 font-medium"><Icon name="share" size={16} />Compartilhar</span> e depois em <span className="font-medium">Adicionar à Tela de Início</span>.
      </p>
      <p className="mt-1 text-slate-300">No iPhone, as notificações exigem o app instalado (iOS 16.4 ou mais recente).</p>
    </div>
  );
}
