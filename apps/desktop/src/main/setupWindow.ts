import { BrowserWindow, ipcMain, net } from 'electron';
import { healthUrl, isHealthy, setupSubmitSchema, type SetupResult } from '../core/ipcSchemas';
import { parseServerUrl } from '../core/serverUrl';
import { isTrustedSender } from './ipcGuard';
import { localUrls } from './localProtocol';
import { paths } from './paths';
import { markLocal, secureWebPreferences } from './security';
import { saveConfig } from './store';

interface SetupSession {
  window: BrowserWindow;
  currentOrigin: string | null;
  canCancel: boolean;
  resolve: (origin: string | null) => void;
  busy: boolean;
}

let active: SetupSession | null = null;
const SETUP_URL = localUrls.setup;
const HEALTH_TIMEOUT_MS = 8000;

function describeFetchError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/CERT|SSL|TLS/i.test(msg)) {
    return 'O certificado HTTPS do servidor não é válido. Verifique o endereço ou o certificado do servidor.';
  }
  if (/abort|timeout/i.test(msg)) return 'O servidor demorou demais para responder.';
  if (/NAME_NOT_RESOLVED/i.test(msg)) return 'Endereço não encontrado. Confira o nome do servidor.';
  if (/CONNECTION_REFUSED/i.test(msg)) return 'Conexão recusada. O servidor está no ar?';
  return 'Não foi possível conectar ao servidor.';
}

/** GET <origin>/api/health deve responder 200 com { status: 'ok' }. */
export async function checkServer(origin: string): Promise<SetupResult> {
  let response: Response;
  try {
    response = await net.fetch(healthUrl(origin), {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: describeFetchError(err) };
  }
  if (response.status !== 200) {
    return { ok: false, error: `O servidor respondeu com status ${response.status}. Este endereço é um servidor Scale?` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: 'Resposta inesperada. Este endereço não parece ser um servidor Scale.' };
  }
  return isHealthy(body)
    ? { ok: true }
    : { ok: false, error: 'O servidor respondeu, mas não informou status ok.' };
}

let handlersInstalled = false;

function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;

  ipcMain.handle('setup:init', (event) => {
    if (!active || !isTrustedSender(event, active.window.webContents, SETUP_URL)) return null;
    return { currentOrigin: active.currentOrigin ?? '', canCancel: active.canCancel };
  });

  ipcMain.handle('setup:submit', async (event, raw: unknown): Promise<SetupResult> => {
    const session = active;
    if (!session || !isTrustedSender(event, session.window.webContents, SETUP_URL)) {
      return { ok: false, error: 'Requisição recusada.' };
    }
    const input = setupSubmitSchema.safeParse(raw);
    if (!input.success) return { ok: false, error: 'Endereço inválido.' };
    const parsed = parseServerUrl(input.data);
    if (!parsed.ok) return parsed;
    if (session.busy) return { ok: false, error: 'Aguarde o teste em andamento.' };
    session.busy = true;
    try {
      const check = await checkServer(parsed.origin);
      if (!check.ok) return check;
      saveConfig({ version: 1, serverOrigin: parsed.origin });
    } catch {
      return { ok: false, error: 'Não foi possível salvar a configuração.' };
    } finally {
      session.busy = false;
    }
    finish(session, parsed.origin);
    return { ok: true };
  });

  ipcMain.on('setup:cancel', (event) => {
    if (!active || !isTrustedSender(event, active.window.webContents, SETUP_URL)) return;
    if (active.canCancel) finish(active, null);
  });
}

function finish(session: SetupSession, origin: string | null): void {
  if (active === session) active = null;
  session.resolve(origin);
  if (!session.window.isDestroyed()) session.window.close();
}

/**
 * Abre a tela de configuracao. Resolve com a origin salva, ou null se o
 * usuario cancelou / fechou a janela.
 */
export function runSetup(options: {
  parent?: BrowserWindow;
  currentOrigin: string | null;
  canCancel: boolean;
}): Promise<string | null> {
  installHandlers();
  if (active) {
    active.window.focus();
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const window = new BrowserWindow({
      title: 'Scale - Configurar servidor',
      width: 560,
      height: 520,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      parent: options.parent,
      modal: Boolean(options.parent),
      show: false,
      autoHideMenuBar: true,
      icon: paths.icon,
      backgroundColor: '#071412',
      webPreferences: secureWebPreferences({ preload: paths.setupPreload }),
    });
    window.removeMenu();
    markLocal(window.webContents);
    const session: SetupSession = {
      window,
      currentOrigin: options.currentOrigin,
      canCancel: options.canCancel,
      resolve,
      busy: false,
    };
    active = session;
    window.on('closed', () => {
      if (active === session) {
        active = null;
        resolve(null);
      }
    });
    window.once('ready-to-show', () => window.show());
    void window.loadURL(SETUP_URL);
  });
}
