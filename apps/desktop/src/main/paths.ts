import { app } from 'electron';
import path from 'node:path';

/** dist/main -> dist */
const DIST = path.join(__dirname, '..');

export const paths = {
  rendererRoot: path.join(DIST, 'renderer'),
  setupPreload: path.join(DIST, 'preload', 'setup.js'),
  pickerPreload: path.join(DIST, 'preload', 'picker.js'),
  icon: path.join(DIST, 'assets', 'icon.png'),
  config: (): string => path.join(app.getPath('userData'), 'config.json'),
  windowState: (): string => path.join(app.getPath('userData'), 'window-state.json'),
};

/** DevTools e o override --server so existem fora do pacote e com --dev. */
export const isDev = !app.isPackaged && process.argv.includes('--dev');
