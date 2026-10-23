import { BrowserWindow, dialog, screen } from 'electron';
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, MIN_HEIGHT, MIN_WIDTH, isRectVisible } from '../core/config';
import { paths } from './paths';
import { secureWebPreferences, setAllowedOrigin } from './security';
import { loadWindowState, saveWindowState } from './store';

/** Codigo do Chromium para navegacao abortada (ex.: trocou de URL no meio). */
const ERR_ABORTED = -3;

export interface MainWindowHooks {
  onChangeServer: () => void;
}

export function createMainWindow(hooks: MainWindowHooks): BrowserWindow {
  const saved = loadWindowState();
  const workAreas = screen.getAllDisplays().map((d) => d.workArea);
  const usePosition =
    saved !== null &&
    saved.x !== undefined &&
    saved.y !== undefined &&
    isRectVisible({ x: saved.x, y: saved.y, width: saved.width, height: saved.height }, workAreas);

  const win = new BrowserWindow({
    title: 'Scale',
    icon: paths.icon,
    width: saved?.width ?? DEFAULT_WIDTH,
    height: saved?.height ?? DEFAULT_HEIGHT,
    ...(usePosition && saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: '#071412',
    // Sem preload: a pagina remota nao recebe nenhuma API do Electron.
    webPreferences: secureWebPreferences(),
  });
  if (saved?.maximized) win.maximize();

  // Mantem "Scale" como titulo da janela independente do <title> da pagina.
  win.on('page-title-updated', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());

  const persist = (): void => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
    const b = win.getNormalBounds();
    saveWindowState({ x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
  };
  let timer: NodeJS.Timeout | null = null;
  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(persist, 500);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    persist();
  });

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === ERR_ABORTED) return;
    void dialog
      .showMessageBox(win, {
        type: 'error',
        title: 'Scale',
        message: 'Não foi possível abrir o servidor Scale.',
        detail: `${validatedURL}\n${errorDescription} (${errorCode})`,
        buttons: ['Tentar novamente', 'Trocar servidor', 'Fechar'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      })
      .then(({ response }) => {
        if (win.isDestroyed()) return;
        if (response === 0) win.webContents.reload();
        else if (response === 1) hooks.onChangeServer();
      });
  });

  return win;
}

export function loadServer(win: BrowserWindow, origin: string): void {
  setAllowedOrigin(origin);
  void win.loadURL(`${origin}/`).catch(() => {
    // falha ja tratada em did-fail-load
  });
}
