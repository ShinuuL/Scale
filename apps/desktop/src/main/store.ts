import fs from 'node:fs';
import path from 'node:path';
import {
  parseConfig,
  parseWindowState,
  serializeConfig,
  windowStateSchema,
  type AppConfig,
  type WindowState,
} from '../core/config';
import { paths } from './paths';

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Escrita atomica: grava em .tmp e renomeia, para nao deixar JSON pela metade. */
function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

export function loadConfig(): AppConfig | null {
  const raw = readText(paths.config());
  return raw === null ? null : parseConfig(raw);
}

export function saveConfig(config: AppConfig): void {
  writeAtomic(paths.config(), serializeConfig(config));
}

export function loadWindowState(): WindowState | null {
  const raw = readText(paths.windowState());
  return raw === null ? null : parseWindowState(raw);
}

export function saveWindowState(state: WindowState): void {
  const parsed = windowStateSchema.safeParse(state);
  if (!parsed.success) return;
  try {
    writeAtomic(paths.windowState(), `${JSON.stringify(parsed.data)}\n`);
  } catch {
    // estado de janela e conveniencia; falha de disco nao derruba o app
  }
}
