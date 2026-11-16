/**
 * Instaladores do app desktop publicados em GitHub Releases.
 *
 * Os nomes dos artefatos sao fixos (sem versao) no `electron-builder.yml`, o
 * que permite linkar `releases/latest/download/<arquivo>` direto: o GitHub
 * redireciona para o asset da release mais recente, sem chamada de API, sem
 * token e sem nada no backend. O proprio app se atualiza depois (AppImage e
 * NSIS leem o `latest*.yml` da mesma release).
 */
export const RELEASES_URL = 'https://github.com/ShinuuL/Scale/releases/latest';

const ASSET_BASE = 'https://github.com/ShinuuL/Scale/releases/latest/download';

export type OperatingSystem = 'windows' | 'linux' | 'macos' | 'android' | 'ios' | 'unknown';

export interface DownloadOption {
  /** Chave estavel para `key` de lista e para testes. */
  id: string;
  /** Rotulo do botao. */
  label: string;
  /** Formato/arquitetura, mostrado ao lado do rotulo. */
  detail: string;
  url: string;
}

const WINDOWS: DownloadOption = {
  id: 'windows-exe',
  label: 'Baixar para Windows',
  detail: 'Instalador .exe (64 bits)',
  url: `${ASSET_BASE}/Scale-Setup-x64.exe`,
};

const LINUX_APPIMAGE: DownloadOption = {
  id: 'linux-appimage',
  label: 'Baixar para Linux',
  detail: 'AppImage (64 bits), atualiza sozinho',
  url: `${ASSET_BASE}/Scale-x64.AppImage`,
};

const LINUX_DEB: DownloadOption = {
  id: 'linux-deb',
  label: 'Baixar .deb',
  detail: 'Debian, Ubuntu e derivados (64 bits)',
  url: `${ASSET_BASE}/Scale-x64.deb`,
};

/**
 * Sistema do visitante. Usa `navigator.userAgentData.platform` quando existe
 * (Chromium ja nao atualiza mais a plataforma no user agent congelado) e cai
 * para o user agent nos demais navegadores.
 */
export function detectOperatingSystem(
  userAgent: string | undefined,
  uaDataPlatform?: string | undefined,
): OperatingSystem {
  const hint = (uaDataPlatform ?? '').toLowerCase();
  if (hint) {
    if (hint.includes('win')) return 'windows';
    if (hint.includes('android')) return 'android';
    if (hint.includes('linux')) return 'linux';
    if (hint.includes('mac')) return 'macos';
  }
  const ua = (userAgent ?? '').toLowerCase();
  if (!ua) return 'unknown';
  // Ordem importa: Android contem "linux"; iPadOS se anuncia como Macintosh.
  if (ua.includes('android')) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (ua.includes('windows')) return 'windows';
  if (/cros|linux|x11/.test(ua)) return 'linux';
  if (/macintosh|mac os x/.test(ua)) return 'macos';
  return 'unknown';
}

/** Lida no browser; fora dele devolve `unknown` (o componente so renderiza apos montar). */
export function currentOperatingSystem(): OperatingSystem {
  if (typeof navigator === 'undefined') return 'unknown';
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return detectOperatingSystem(navigator.userAgent, data?.platform);
}

export interface DownloadOffer {
  /** Botao destacado, ou `null` quando nao ha app desktop para o sistema. */
  primary: DownloadOption | null;
  /** Alternativas listadas como links discretos. */
  secondary: DownloadOption[];
  /** Explicacao curta mostrada junto dos botoes. */
  note: string;
}

export function downloadOffer(os: OperatingSystem): DownloadOffer {
  switch (os) {
    case 'windows':
      return {
        primary: WINDOWS,
        secondary: [LINUX_APPIMAGE, LINUX_DEB],
        note: 'Atualiza sozinho a cada nova versão.',
      };
    case 'linux':
      return {
        primary: LINUX_APPIMAGE,
        secondary: [LINUX_DEB, WINDOWS],
        note: 'Dê permissão de execução no arquivo e abra. O AppImage se atualiza sozinho.',
      };
    case 'macos':
      return {
        primary: null,
        secondary: [WINDOWS, LINUX_APPIMAGE],
        note: 'Ainda não há app para macOS. Use o Scale pelo navegador ou instale como aplicativo da web.',
      };
    case 'android':
    case 'ios':
      return {
        primary: null,
        secondary: [],
        note: 'No celular, use o Scale pelo navegador ou instale como aplicativo da web pelo menu do navegador.',
      };
    default:
      return {
        primary: null,
        secondary: [WINDOWS, LINUX_APPIMAGE, LINUX_DEB],
        note: 'Escolha o instalador do seu sistema.',
      };
  }
}
