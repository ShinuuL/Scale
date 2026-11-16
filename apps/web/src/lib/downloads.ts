/**
 * Instaladores do app desktop nativo (`apps/desktop-native`, Rust + egui).
 *
 * As releases saem do `desktop-release.yml` com a tag `desktop-v<version>` e os
 * nomes que o cargo-packager gera, COM a versao
 * (`scale-desktop_0.1.2_x64-setup.exe`). Como o nome muda a cada versao, nao da
 * para linkar `releases/latest/download/<arquivo>`: os assets sao resolvidos
 * pela API publica de releases, a mesma que o proprio app consulta para se
 * atualizar. Sem token (repositorio publico) e sem nada no backend.
 *
 * `latest` do GitHub tambem nao serve: ele devolve a release mais recente de
 * QUALQUER tag, e o repositorio publica outras coisas alem do desktop. Por isso
 * a busca filtra `desktop-v*` explicitamente.
 */
export const RELEASES_URL = 'https://github.com/ShinuuL/Scale/releases';

/** Pagina o suficiente para achar a release de desktop mais nova entre outras tags. */
export const RELEASES_API_URL =
  'https://api.github.com/repos/ShinuuL/Scale/releases?per_page=30';

const TAG_PREFIX = 'desktop-v';

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

/** Recorte do que a API de releases devolve; o resto e ignorado. */
export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface Release {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
}

/** Instaladores achados na release, por plataforma. */
export interface DesktopAssets {
  version: string;
  windows: DownloadOption | null;
  appImage: DownloadOption | null;
  deb: DownloadOption | null;
}

/** Compara `1.10.0` > `1.9.0` (comparacao numerica, nao lexicografica). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Release de desktop publicada mais nova. Rascunho e pre-release ficam de fora:
 * sao exatamente os estados em que os artefatos ainda podem estar incompletos.
 */
export function latestDesktopRelease(releases: Release[]): Release | null {
  const published = releases.filter(
    (r) => r.tag_name?.startsWith(TAG_PREFIX) && !r.draft && !r.prerelease,
  );
  if (published.length === 0) return null;
  return published.reduce((newest, candidate) =>
    compareVersions(
      candidate.tag_name.slice(TAG_PREFIX.length),
      newest.tag_name.slice(TAG_PREFIX.length),
    ) > 0
      ? candidate
      : newest,
  );
}

/**
 * Instaladores da release, achados pela EXTENSAO do arquivo — nao pelo nome
 * completo. Assim uma mudanca de convencao do cargo-packager (o nome carrega
 * crate, versao e arquitetura) nao quebra a pagina.
 */
export function desktopAssets(release: Release | null): DesktopAssets | null {
  if (!release) return null;
  const version = release.tag_name.slice(TAG_PREFIX.length);
  const find = (test: (name: string) => boolean) =>
    (release.assets ?? []).find((a) => test(a.name.toLowerCase()));

  const exe = find((n) => n.endsWith('.exe'));
  const appImage = find((n) => n.endsWith('.appimage'));
  const deb = find((n) => n.endsWith('.deb'));

  return {
    version,
    windows: exe
      ? {
          id: 'windows-exe',
          label: 'Baixar para Windows',
          detail: 'Instalador .exe (64 bits)',
          url: exe.browser_download_url,
        }
      : null,
    appImage: appImage
      ? {
          id: 'linux-appimage',
          label: 'Baixar para Linux',
          detail: 'AppImage (64 bits), roda sem instalar',
          url: appImage.browser_download_url,
        }
      : null,
    deb: deb
      ? {
          id: 'linux-deb',
          label: 'Baixar .deb',
          detail: 'Debian, Ubuntu e derivados (64 bits)',
          url: deb.browser_download_url,
        }
      : null,
  };
}

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

/** Voz e tela ainda nao existem no cliente nativo (R2+); o aviso e o mesmo em todo lugar. */
const SEM_VOZ = 'Comunidades, canais de texto e mensagens diretas. Voz e tela, por enquanto, só pelo navegador.';

export function downloadOffer(os: OperatingSystem, assets: DesktopAssets | null): DownloadOffer {
  const windows = assets?.windows ?? null;
  const appImage = assets?.appImage ?? null;
  const deb = assets?.deb ?? null;
  const todos = [windows, appImage, deb].filter((o): o is DownloadOption => o !== null);

  if (todos.length === 0) {
    return {
      primary: null,
      secondary: [],
      note: 'Não foi possível consultar os downloads agora. Veja as versões publicadas no GitHub.',
    };
  }

  switch (os) {
    case 'windows':
      return {
        primary: windows,
        secondary: [appImage, deb].filter((o): o is DownloadOption => o !== null),
        note: `${SEM_VOZ} O app se atualiza sozinho a cada nova versão.`,
      };
    case 'linux':
      return {
        primary: appImage,
        secondary: [deb, windows].filter((o): o is DownloadOption => o !== null),
        note: `Dê permissão de execução no arquivo e abra. ${SEM_VOZ}`,
      };
    case 'macos':
      return {
        primary: null,
        secondary: todos,
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
        secondary: todos,
        note: 'Escolha o instalador do seu sistema.',
      };
  }
}

/**
 * Busca a release de desktop mais nova. Qualquer falha (rede, limite de 60
 * requisicoes/hora por IP da API publica, repositorio sem release) devolve
 * `null` — a UI cai no link para a pagina de releases.
 */
export async function fetchDesktopAssets(signal?: AbortSignal): Promise<DesktopAssets | null> {
  try {
    const res = await fetch(RELEASES_API_URL, {
      signal,
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return null;
    return desktopAssets(latestDesktopRelease(data as Release[]));
  } catch {
    return null;
  }
}
