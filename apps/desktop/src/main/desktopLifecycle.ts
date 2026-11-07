import { app, dialog, globalShortcut, Menu, powerMonitor, powerSaveBlocker, Tray, type BrowserWindow } from 'electron';
import { createMediaPowerPolicy, shouldHideOnClose } from '../core/lifecycle';
import { originOf } from '../core/serverUrl';
import { paths } from './paths';
import { getAllowedOrigin } from './security';

const MUTE_SHORTCUT = 'CommandOrControl+Shift+M';
const MUTE_SCRIPT = "window.dispatchEvent(new Event('scale:toggle-mute')); void 0;";
const RESUME_SCRIPT = "window.dispatchEvent(new Event('scale:resume')); void 0;";

/** One-way, literal DOM events. No preload, IPC endpoint or privileged remote API. */
function signal(win: BrowserWindow, script: typeof MUTE_SCRIPT | typeof RESUME_SCRIPT): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  const contents = win.webContents;
  if (!getAllowedOrigin() || originOf(contents.getURL()) !== getAllowedOrigin()) return;
  if (originOf(contents.mainFrame.url) !== getAllowedOrigin()) return;
  void contents.executeJavaScript(script).catch(() => { /* Renderer may be navigating. */ });
}

export function installDesktopLifecycle(win: BrowserWindow): { show: () => void } {
  let quitting = false;
  let tray: Tray | undefined;
  let shortcutEnabled = false;
  const show = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };
  const power = createMediaPowerPolicy({
    start: () => powerSaveBlocker.start('prevent-app-suspension'),
    stop: (id) => powerSaveBlocker.stop(id),
  });
  // The OS may still suspend on lid close/user action. Never block the screen.
  // This observes playback, not room membership or microphone-only capture.
  const play = () => power.setPlaying(true);
  const pause = () => {
    if (!win.webContents.isCurrentlyAudible()) power.setPlaying(false);
  };
  const suspend = () => power.setPlaying(false);
  const resume = () => {
    signal(win, RESUME_SCRIPT);
    if (!win.isDestroyed() && win.webContents.isCurrentlyAudible()) play();
  };
  const quit = () => { quitting = true; power.dispose(); };
  app.on('before-quit', quit);
  powerMonitor.on('suspend', suspend);
  powerMonitor.on('resume', resume);
  win.webContents.on('media-started-playing', play);
  win.webContents.on('media-paused', pause);
  win.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) power.setPlaying(false);
  });
  win.webContents.on('render-process-gone', () => {
    power.dispose();
    show();
    void dialog.showMessageBox(win, {
      type: 'warning', title: 'Scale', message: 'A janela do Scale foi interrompida.',
      detail: 'A chamada foi encerrada. Reabra o servidor para entrar novamente.',
      buttons: ['Reabrir servidor', 'Agora não'], defaultId: 0, cancelId: 1, noLink: true,
    }).then(({ response }) => { if (response === 0 && !win.isDestroyed()) win.webContents.reload(); });
  });
  try {
    tray = new Tray(paths.icon);
    tray.setToolTip('Scale — fechar a janela mantém o aplicativo aberto');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir Scale', click: show },
      { type: 'separator' },
      {
        label: 'Atalho global de microfone (Ctrl+Shift+M)', type: 'checkbox', checked: false,
        click: (item) => {
          if (item.checked) {
            shortcutEnabled = globalShortcut.register(MUTE_SHORTCUT, () => signal(win, MUTE_SCRIPT));
            item.checked = shortcutEnabled;
            if (!shortcutEnabled) void dialog.showMessageBox(win, {
              type: 'info', title: 'Scale', message: 'O atalho global está indisponível.',
              detail: 'Outro aplicativo ou o sistema pode estar usando Ctrl+Shift+M. Use o controle de microfone da sala.',
              buttons: ['Entendi'], noLink: true,
            });
          } else { globalShortcut.unregister(MUTE_SHORTCUT); shortcutEnabled = false; }
        },
      },
      { type: 'separator' },
      { label: 'Sair do Scale e encerrar chamadas', click: () => app.quit() },
    ]));
    tray.on('click', show);
    tray.on('double-click', show);
  } catch { tray?.destroy(); tray = undefined; }

  win.on('close', (event) => {
    if (shouldHideOnClose(quitting, Boolean(tray))) { event.preventDefault(); win.hide(); }
  });
  win.once('closed', () => {
    power.dispose();
    tray?.destroy();
    if (shortcutEnabled) globalShortcut.unregister(MUTE_SHORTCUT);
    app.removeListener('before-quit', quit);
    powerMonitor.removeListener('suspend', suspend);
    powerMonitor.removeListener('resume', resume);
  });
  return { show };
}
