/**
 * Quando o auto-update do shell Electron pode rodar.
 *
 * Regras:
 * - fora do pacote (dev) nunca: nao existe `app-update.yml` nem versao real;
 * - Windows: instalador NSIS, sempre;
 * - Linux: so o AppImage sabe se substituir (o electron-updater expoe o
 *   caminho em `APPIMAGE`); `.deb` instalado via dpkg/apt atualiza por fora;
 * - outras plataformas: nao ha alvo publicado ainda.
 */
export interface UpdateEnvironment {
  /** `app.isPackaged`. */
  packaged: boolean;
  /** `process.platform`. */
  platform: NodeJS.Platform;
  /** `process.env.APPIMAGE` (so existe quando rodando a partir do AppImage). */
  appImage?: string | undefined;
}

export function canAutoUpdate(env: UpdateEnvironment): boolean {
  if (!env.packaged) return false;
  if (env.platform === 'win32') return true;
  if (env.platform === 'linux') return Boolean(env.appImage);
  return false;
}

/** Motivo para mostrar ao usuario quando ele pede "Verificar atualizacoes" e nao da. */
export function unavailableReason(env: UpdateEnvironment): string {
  if (!env.packaged) return 'Atualização automática só funciona no aplicativo instalado.';
  if (env.platform === 'linux') {
    return 'Esta instalação (.deb) não se atualiza sozinha. Baixe a versão mais recente no site do Scale.';
  }
  if (env.platform !== 'win32') {
    return 'Ainda não há atualização automática para este sistema. Baixe a versão mais recente no site do Scale.';
  }
  return 'Atualização automática indisponível nesta instalação.';
}
