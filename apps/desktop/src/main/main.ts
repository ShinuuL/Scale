import { app, BrowserWindow, Menu, session } from 'electron';
import { parseServerUrl } from '../core/serverUrl';
import { handleLocalScheme, registerLocalScheme } from './localProtocol';
import { createMainWindow, loadServer } from './mainWindow';
import { buildMenu } from './menu';
import { installDisplayMediaHandler } from './picker';
import { isDev } from './paths';
import { getAllowedOrigin, installGlobalHardening, installPermissionHandlers } from './security';
import { runSetup } from './setupWindow';
import { loadConfig } from './store';

// Sandbox em todos os renderers, antes de qualquer janela.
app.enableSandbox();
app.setAppUserModelId('br.com.mastersys.scale');
registerLocalScheme();

// Dev/testes: --profile=<dir> isola config e cookies (ignorado no app empacotado).
const profileArg = isDev ? process.argv.find((a) => a.startsWith('--profile=')) : undefined;
if (profileArg) app.setPath('userData', profileArg.slice('--profile='.length));

let mainWindow: BrowserWindow | undefined;
/** Durante o setup inicial a unica janela fecha antes da principal abrir. */
let mainWindowCreated = false;

/** --server=<url> so vale fora do pacote e com --dev (nao e persistido). */
function devServerOverride(): string | null {
  if (!isDev) return null;
  const arg = process.argv.find((a) => a.startsWith('--server='));
  if (!arg) return null;
  const parsed = parseServerUrl(arg.slice('--server='.length));
  return parsed.ok ? parsed.origin : null;
}

async function changeServer(): Promise<void> {
  const origin = await runSetup({ parent: mainWindow, currentOrigin: getAllowedOrigin(), canCancel: true });
  if (origin && mainWindow && !mainWindow.isDestroyed()) loadServer(mainWindow, origin);
}

async function start(): Promise<void> {
  handleLocalScheme();
  installPermissionHandlers(session.defaultSession);
  installDisplayMediaHandler(session.defaultSession, () => mainWindow);
  Menu.setApplicationMenu(
    buildMenu({
      changeServer: () => void changeServer(),
      getWindow: () => mainWindow,
    }),
  );

  let origin = devServerOverride() ?? loadConfig()?.serverOrigin ?? null;
  if (!origin) {
    origin = await runSetup({ currentOrigin: null, canCancel: false });
    if (!origin) {
      app.quit();
      return;
    }
  }

  mainWindow = createMainWindow({ onChangeServer: () => void changeServer() });
  mainWindowCreated = true;
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  loadServer(mainWindow, origin);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  installGlobalHardening();

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (mainWindowCreated) app.quit();
  });

  void app.whenReady().then(start);
}
