import { app, BrowserWindow, dialog, shell, type Session, type WebContents, type WebPreferences } from 'electron';
import { decideNavigation, canOpenExternally } from '../core/navigation';
import { isPermissionAllowed } from '../core/permissions';
import { originOf } from '../core/serverUrl';
import { isDev } from './paths';

/** Origin do servidor configurado (unica origin com acesso dentro do app). */
let allowedOrigin: string | null = null;
const notificationConsents = new Map<string, boolean>();
const notificationPending = new Set<string>();

export function setAllowedOrigin(origin: string | null): void {
  if (origin !== allowedOrigin) notificationConsents.clear();
  allowedOrigin = origin;
}

export function getAllowedOrigin(): string | null {
  return allowedOrigin;
}

/** webContents das telas locais (setup, seletor): nunca navegam nem abrem janelas. */
const localContents = new Set<number>();

export function markLocal(contents: WebContents): void {
  const id = contents.id;
  localContents.add(id);
  contents.once('destroyed', () => localContents.delete(id));
}

/** webPreferences endurecidas (checklist de seguranca do Electron). */
export function secureWebPreferences(extra: Pick<WebPreferences, 'preload'> = {}): WebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    experimentalFeatures: false,
    navigateOnDragDrop: false,
    safeDialogs: true,
    spellcheck: false,
    devTools: isDev,
    ...extra,
  };
}

function openExternal(url: string): void {
  if (canOpenExternally(url)) void shell.openExternal(url);
}

/**
 * Aplicado a TODO webContents criado (app.on('web-contents-created')), inclusive
 * janelas filhas abertas por window.open.
 */
export function hardenWebContents(contents: WebContents): void {
  contents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  contents.on('will-navigate', (event) => {
    if (localContents.has(contents.id)) {
      event.preventDefault();
      return;
    }
    const decision = decideNavigation(event.url, allowedOrigin);
    if (decision === 'allow') return;
    event.preventDefault();
    if (decision === 'external') openExternal(event.url);
  });

  contents.on('will-redirect', (event) => {
    if (localContents.has(contents.id)) {
      event.preventDefault();
      return;
    }
    // Redirect para outra origin e bloqueado em silencio (nao abre navegador sozinho).
    if (event.isMainFrame && decideNavigation(event.url, allowedOrigin) !== 'allow') event.preventDefault();
  });

  contents.setWindowOpenHandler(({ url }) => {
    if (localContents.has(contents.id)) return { action: 'deny' };
    const decision = decideNavigation(url, allowedOrigin);
    if (decision === 'allow') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: secureWebPreferences(),
        },
      };
    }
    if (decision === 'external') openExternal(url);
    return { action: 'deny' };
  });

  if (!isDev) {
    contents.on('devtools-opened', () => contents.closeDevTools());
  }
}

/**
 * Handlers de permissao da sessao: so 'media' (audio), 'display-capture' e
 * 'speaker-selection' da origin configurada. Notifications exigem consentimento
 * nativo explicito, por origin e por sessao.
 */
export function installPermissionHandlers(ses: Session): void {
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission === 'notifications') {
      const origin = allowedOrigin;
      const parent = BrowserWindow.fromWebContents(contents);
      if (!origin || !parent || !details.isMainFrame || contents.isDestroyed() ||
          originOf(details.requestingUrl) !== origin || originOf(contents.getURL()) !== origin) {
        callback(false); return;
      }
      if (notificationConsents.has(origin)) { callback(notificationConsents.get(origin) === true); return; }
      if (notificationPending.has(origin) || !parent.isFocused()) { callback(false); return; }
      notificationPending.add(origin);
      void dialog.showMessageBox(parent, {
        type: 'question', title: 'Notificações do Scale', message: 'Permitir notificações neste servidor?',
        detail: `${origin}\nO Scale poderá exibir alertas no sistema enquanto estiver aberto, inclusive na bandeja. A permissão vale somente nesta sessão.`,
        buttons: ['Permitir notificações', 'Agora não'], defaultId: 1, cancelId: 1, noLink: true,
      }).then(({ response }) => {
        const granted = response === 0 && allowedOrigin === origin && !contents.isDestroyed() && originOf(contents.getURL()) === origin;
        if (allowedOrigin === origin) notificationConsents.set(origin, granted);
        callback(granted);
      }).catch(() => callback(false)).finally(() => notificationPending.delete(origin));
      return;
    }
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : undefined;
    callback(
      isPermissionAllowed({
        permission,
        requestingUrl: details.requestingUrl ?? '',
        allowedOrigin,
        mediaTypes,
        isMainFrame: details.isMainFrame,
      }),
    );
  });

  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    // Frame embutido de outra origin nao herda a permissao da pagina principal.
    if (details.embeddingOrigin && originOf(details.embeddingOrigin) !== allowedOrigin) return false;
    return isPermissionAllowed({
      permission,
      requestingUrl: requestingOrigin,
      allowedOrigin,
      mediaTypes: details.mediaType ? [details.mediaType] : [],
      isMainFrame: details.isMainFrame,
      notificationConsent: allowedOrigin ? notificationConsents.get(allowedOrigin) === true : false,
    });
  });

  // HID / serial / USB: nunca.
  ses.setDevicePermissionHandler(() => false);
}

export function installGlobalHardening(): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
}
