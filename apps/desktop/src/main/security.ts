import { app, shell, type Session, type WebContents, type WebPreferences } from 'electron';
import { decideNavigation, canOpenExternally } from '../core/navigation';
import { isPermissionAllowed } from '../core/permissions';
import { originOf } from '../core/serverUrl';
import { isDev } from './paths';

/** Origin do servidor configurado (unica origin com acesso dentro do app). */
let allowedOrigin: string | null = null;

export function setAllowedOrigin(origin: string | null): void {
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

/** Handlers de permissao da sessao: so 'media' (audio) e 'display-capture' da origin configurada. */
export function installPermissionHandlers(ses: Session): void {
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes ?? []) : undefined;
    callback(
      isPermissionAllowed({
        permission,
        requestingUrl: details.requestingUrl ?? '',
        allowedOrigin,
        mediaTypes,
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
    });
  });

  // HID / serial / USB: nunca.
  ses.setDevicePermissionHandler(() => false);
}

export function installGlobalHardening(): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
}
