// Auto-update do shell Electron via GitHub Releases (electron-updater le o
// `app-update.yml` gerado pelo electron-builder a partir do bloco `publish`).
//
// Politica: baixa em segundo plano e so avisa quando o pacote ja esta pronto;
// a instalacao acontece quando o usuario aceita reiniciar ou, no pior caso, ao
// fechar o app. Nenhuma checagem roda em dev (ver `core/updatePolicy.ts`).
import { app, dialog, shell, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { canAutoUpdate, unavailableReason } from '../core/updatePolicy';

/** De quanto em quanto tempo o app volta a checar enquanto fica aberto. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DOWNLOAD_PAGE = 'https://scale.nexushosts.tech/#baixar';

type GetWindow = () => BrowserWindow | undefined;

let wired = false;
/** Checagem disparada pelo menu: so essa fala quando nao ha novidade. */
let manual = false;
let downloadedVersion: string | null = null;

function environment() {
  return { packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE };
}

function show(win: BrowserWindow | undefined, options: Electron.MessageBoxOptions) {
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

async function announceReady(getWindow: GetWindow, version: string): Promise<void> {
  const { response } = await show(getWindow(), {
    type: 'info',
    title: 'Atualização do Scale',
    message: `A versão ${version} está pronta para instalar.`,
    detail: 'O Scale vai fechar e abrir de novo. Se você estiver em uma chamada, escolha "Depois".',
    buttons: ['Reiniciar agora', 'Depois'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) {
    // Fecha as janelas e deixa o instalador rodar; `isSilent` so vale no NSIS.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  }
}

function wire(getWindow: GetWindow): void {
  if (wired) return;
  wired = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('update-downloaded', (info) => {
    downloadedVersion = info.version;
    void announceReady(getWindow, info.version);
  });

  autoUpdater.on('update-not-available', () => {
    if (!manual) return;
    manual = false;
    void show(getWindow(), {
      type: 'info',
      title: 'Atualização do Scale',
      message: `O Scale ${app.getVersion()} já é a versão mais recente.`,
      buttons: ['Fechar'],
      noLink: true,
    });
  });

  autoUpdater.on('error', () => {
    if (!manual) return; // Falha de rede em checagem automatica e silenciosa.
    manual = false;
    void show(getWindow(), {
      type: 'warning',
      title: 'Atualização do Scale',
      message: 'Não foi possível verificar atualizações agora.',
      detail: 'Confira sua conexão e tente de novo mais tarde.',
      buttons: ['Fechar'],
      noLink: true,
    });
  });
}

/** Checagem na abertura + a cada 6h, sem nenhum aviso quando nao ha update. */
export function initAutoUpdates(getWindow: GetWindow): void {
  if (!canAutoUpdate(environment())) return;
  wire(getWindow);
  const check = () => autoUpdater.checkForUpdates().catch(() => { /* tratado no evento `error`. */ });
  void check();
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  timer.unref();
  app.once('before-quit', () => clearInterval(timer));
}

/** Item "Verificar atualizações" do menu Ajuda: sempre responde algo. */
export async function checkForUpdatesNow(getWindow: GetWindow): Promise<void> {
  const env = environment();
  if (!canAutoUpdate(env)) {
    const { response } = await show(getWindow(), {
      type: 'info',
      title: 'Atualização do Scale',
      message: `Scale ${app.getVersion()}`,
      detail: unavailableReason(env),
      buttons: ['Abrir página de download', 'Fechar'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response === 0) await shell.openExternal(DOWNLOAD_PAGE);
    return;
  }
  wire(getWindow);
  if (downloadedVersion) {
    await announceReady(getWindow, downloadedVersion);
    return;
  }
  manual = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    /* tratado no evento `error`. */
  }
}
