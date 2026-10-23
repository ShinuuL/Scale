import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  type DesktopCapturerSource,
  type Session,
} from 'electron';
import { pickerChoiceSchema, type PickerInit } from '../core/ipcSchemas';
import { originOf } from '../core/serverUrl';
import { isTrustedSender } from './ipcGuard';
import { localUrls } from './localProtocol';
import { paths } from './paths';
import { getAllowedOrigin, markLocal, secureWebPreferences } from './security';

interface PickerResult {
  source: DesktopCapturerSource;
  shareAudio: boolean;
}

interface PickerSession {
  window: BrowserWindow;
  sources: Map<string, DesktopCapturerSource>;
  init: PickerInit;
  resolve: (result: PickerResult | null) => void;
}

let active: PickerSession | null = null;
const PICKER_URL = localUrls.picker;
/** Audio do sistema (loopback) so existe no Windows. */
const LOOPBACK_SUPPORTED = process.platform === 'win32';

let handlersInstalled = false;

function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  ipcMain.handle('picker:init', (event) => {
    if (!active || !isTrustedSender(event, active.window.webContents, PICKER_URL)) return null;
    return active.init;
  });

  ipcMain.on('picker:choose', (event, raw: unknown) => {
    const session = active;
    if (!session || !isTrustedSender(event, session.window.webContents, PICKER_URL)) return;
    const choice = pickerChoiceSchema.safeParse(raw);
    if (!choice.success) return;
    // O id precisa ser um dos que o main ofereceu.
    const source = session.sources.get(choice.data.sourceId);
    if (!source) return;
    finish(session, { source, shareAudio: choice.data.shareAudio && session.init.audioAvailable });
  });

  ipcMain.on('picker:cancel', (event) => {
    if (!active || !isTrustedSender(event, active.window.webContents, PICKER_URL)) return;
    finish(active, null);
  });
}

function finish(session: PickerSession, result: PickerResult | null): void {
  if (active === session) active = null;
  session.resolve(result);
  if (!session.window.isDestroyed()) session.window.close();
}

async function openPicker(parent: BrowserWindow | undefined, audioRequested: boolean): Promise<PickerResult | null> {
  installHandlers();
  if (active) return null;
  const list = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: false,
  });
  const sources = new Map(list.map((s) => [s.id, s]));
  const init: PickerInit = {
    audioPlatform: LOOPBACK_SUPPORTED,
    audioAvailable: LOOPBACK_SUPPORTED && audioRequested,
    sources: list.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    })),
  };

  return new Promise((resolve) => {
    const window = new BrowserWindow({
      title: 'Scale - Compartilhar tela',
      width: 820,
      height: 600,
      minWidth: 560,
      minHeight: 420,
      parent,
      modal: Boolean(parent),
      show: false,
      minimizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      icon: paths.icon,
      backgroundColor: '#071412',
      webPreferences: secureWebPreferences({ preload: paths.pickerPreload }),
    });
    window.removeMenu();
    markLocal(window.webContents);
    const session: PickerSession = { window, sources, init, resolve };
    active = session;
    window.on('closed', () => {
      if (active === session) {
        active = null;
        resolve(null);
      }
    });
    window.once('ready-to-show', () => window.show());
    void window.loadURL(PICKER_URL);
  });
}

/**
 * getDisplayMedia do site abre o seletor proprio. Pedido de outra origin ou
 * cancelado => callback sem stream (o getDisplayMedia do site rejeita).
 */
export function installDisplayMediaHandler(ses: Session, getParent: () => BrowserWindow | undefined): void {
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      const allowed = getAllowedOrigin();
      const origin = originOf(request.securityOrigin || request.frame?.url || '');
      if (allowed === null || origin !== allowed || !request.videoRequested) {
        callback({});
        return;
      }
      openPicker(getParent(), request.audioRequested)
        .then((result) => {
          if (!result) {
            callback({});
            return;
          }
          callback(result.shareAudio ? { video: result.source, audio: 'loopback' } : { video: result.source });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}
