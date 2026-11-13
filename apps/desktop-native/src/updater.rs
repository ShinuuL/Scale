//! Atualização automática pelas GitHub Releases do repositório.
//!
//! Fluxo: ao abrir, consulta as releases `desktop-v<semver>` (sem rascunho nem
//! pré-release). Havendo versão mais nova, baixa o instalador da plataforma,
//! confere o SHA-256 contra o `SHA256SUMS` da mesma release e instala:
//! - Windows: roda o setup NSIS em modo silencioso (`/S`) depois que o app
//!   fecha e reabre o Scale ao terminar;
//! - Linux AppImage: troca o próprio arquivo (`$APPIMAGE`) e reabre;
//! - Linux .deb (sem `$APPIMAGE`): não há como instalar sem root; abre a página.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use sha2::{Digest, Sha256};

/// Repositório das releases. Sobrescrevível no build: `SCALE_UPDATE_REPO=dono/repo`.
pub const REPO: &str = match option_env!("SCALE_UPDATE_REPO") {
    Some(repo) => repo,
    None => "ShinuuL/Scale",
};
pub const TAG_PREFIX: &str = "desktop-v";
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");
const SUMS_NAME: &str = "SHA256SUMS";
/// Teto de download (o setup tem ~7 MB; AppImage algumas dezenas).
const MAX_DOWNLOAD: u64 = 300 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateInfo {
    pub version: String,
    /// Página da release (fallback quando não dá para instalar sozinho).
    pub page_url: String,
    /// Instalador desta plataforma e o arquivo de checksums.
    pub asset: Option<Asset>,
    pub sums_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Asset {
    pub name: String,
    pub browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    assets: Vec<Asset>,
}

/// Instalador baixado e conferido, pronto para rodar.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Downloaded {
    pub version: String,
    pub path: PathBuf,
}

/// `1.2.3` → (1, 2, 3). Aceita sufixo de build/pré (`1.2.3-rc1` vira 1.2.3).
pub fn parse_version(raw: &str) -> Option<(u64, u64, u64)> {
    let core = raw.trim().split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let v = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(v)
}

/// Qual arquivo da release instala nesta plataforma.
fn is_platform_asset(name: &str) -> bool {
    if cfg!(windows) {
        name.ends_with("-setup.exe")
    } else {
        name.ends_with(".AppImage")
    }
}

fn is_github_url(url: &str) -> bool {
    url.starts_with("https://github.com/")
}

/// Escolhe a maior versão de desktop publicada que seja mais nova que `current`.
fn pick_update(releases: &[Release], current: &str) -> Option<UpdateInfo> {
    let current = parse_version(current)?;
    releases
        .iter()
        .filter(|r| !r.draft && !r.prerelease && is_github_url(&r.html_url))
        .filter_map(|r| {
            let version = r.tag_name.strip_prefix(TAG_PREFIX)?;
            Some((parse_version(version)?, version, r))
        })
        .filter(|(v, _, _)| *v > current)
        .max_by_key(|(v, _, _)| *v)
        .map(|(_, version, r)| {
            let github = |a: &&Asset| is_github_url(&a.browser_download_url);
            UpdateInfo {
                version: version.to_string(),
                page_url: r.html_url.clone(),
                asset: r.assets.iter().filter(github).find(|a| is_platform_asset(&a.name)).cloned(),
                sums_url: r
                    .assets
                    .iter()
                    .filter(github)
                    .find(|a| a.name == SUMS_NAME)
                    .map(|a| a.browser_download_url.clone()),
            }
        })
}

/// Linha `<sha256>  <arquivo>` do SHA256SUMS para `name`.
fn expected_hash(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let (hash, file) = line.split_once(char::is_whitespace)?;
        let file = file.trim().trim_start_matches('*');
        (file == name && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| hash.to_ascii_lowercase())
    })
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

fn client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("scale-desktop/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .ok()
}

async fn get_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("falha no download: {e}"))?;
    if response.content_length().is_some_and(|len| len > MAX_DOWNLOAD) {
        return Err("arquivo de atualização grande demais".into());
    }
    let bytes = response.bytes().await.map_err(|e| format!("falha no download: {e}"))?;
    if bytes.len() as u64 > MAX_DOWNLOAD {
        return Err("arquivo de atualização grande demais".into());
    }
    Ok(bytes.to_vec())
}

/// Consulta a API do GitHub. Erro de rede/limite vira `None` (tenta no próximo início).
pub async fn check() -> Option<UpdateInfo> {
    let releases: Vec<Release> = client()?
        .get(format!("https://api.github.com/repos/{REPO}/releases?per_page=30"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json()
        .await
        .ok()?;
    pick_update(&releases, CURRENT_VERSION)
}

/// Dá para instalar sozinho nesta plataforma/forma de instalação?
pub fn can_self_install(info: &UpdateInfo) -> bool {
    let supported = cfg!(windows) || std::env::var_os("APPIMAGE").is_some();
    supported && info.asset.is_some() && info.sums_url.is_some()
}

/// Baixa o instalador para a pasta temporária e confere o SHA-256.
pub async fn download(info: &UpdateInfo) -> Result<Downloaded, String> {
    let (Some(asset), Some(sums_url)) = (&info.asset, &info.sums_url) else {
        return Err("release sem instalador para esta plataforma".into());
    };
    let client = client().ok_or("falha ao iniciar o download")?;
    let sums = String::from_utf8(get_bytes(&client, sums_url).await?)
        .map_err(|_| "SHA256SUMS inválido".to_string())?;
    let expected = expected_hash(&sums, &asset.name).ok_or("instalador ausente do SHA256SUMS")?;
    let bytes = get_bytes(&client, &asset.browser_download_url).await?;
    if sha256_hex(&bytes) != expected {
        return Err("checksum do instalador não confere; atualização descartada".into());
    }
    // Nome só com caracteres seguros (vem da API): evita caminho estranho no temp.
    let safe: String = asset
        .name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' })
        .collect();
    let dir = std::env::temp_dir().join("scale-update");
    std::fs::create_dir_all(&dir).map_err(|e| format!("pasta temporária: {e}"))?;
    let path = dir.join(safe);
    std::fs::write(&path, &bytes).map_err(|e| format!("gravar instalador: {e}"))?;
    Ok(Downloaded { version: info.version.clone(), path })
}

/// Instala e reabre. Em caso de sucesso o chamador deve encerrar o processo.
pub fn install_and_restart(update: &Downloaded) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| format!("executável atual: {e}"))?;
    platform_install(&update.path, &exe)
}

#[cfg(windows)]
fn platform_install(installer: &Path, exe: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    for p in [installer, exe] {
        if p.to_string_lossy().contains('"') {
            return Err("caminho inválido".into());
        }
    }
    // Espera o app fechar (~2 s), instala em silêncio e reabre o Scale.
    let script = format!(
        "ping -n 3 127.0.0.1 >nul & \"{}\" /S & start \"\" \"{}\"",
        installer.display(),
        exe.display()
    );
    std::process::Command::new("cmd")
        .arg("/C")
        .raw_arg(format!("\"{script}\""))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("iniciar instalador: {e}"))
}

#[cfg(not(windows))]
fn platform_install(downloaded: &Path, _exe: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let target = std::env::var_os("APPIMAGE").map(PathBuf::from).ok_or("instalação sem AppImage")?;
    let staged = target.with_extension("new");
    std::fs::copy(downloaded, &staged).map_err(|e| format!("copiar AppImage: {e}"))?;
    std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| format!("permissão do AppImage: {e}"))?;
    std::fs::rename(&staged, &target).map_err(|e| format!("trocar AppImage: {e}"))?;
    std::process::Command::new(&target)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("reabrir: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(name: &str) -> Asset {
        Asset {
            name: name.to_string(),
            browser_download_url: format!("https://github.com/x/y/releases/download/t/{name}"),
        }
    }

    fn rel(tag: &str, draft: bool, prerelease: bool) -> Release {
        Release {
            tag_name: tag.to_string(),
            html_url: format!("https://github.com/x/y/releases/tag/{tag}"),
            draft,
            prerelease,
            assets: vec![
                asset("scale-desktop_1.0.0_x64-setup.exe"),
                asset("scale-desktop_1.0.0_x86_64.AppImage"),
                asset("scale-desktop_1.0.0_amd64.deb"),
                asset(SUMS_NAME),
            ],
        }
    }

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("1.2.3"), Some((1, 2, 3)));
        assert_eq!(parse_version("0.10.0-rc1"), Some((0, 10, 0)));
        assert_eq!(parse_version("1.2"), None);
        assert_eq!(parse_version("1.2.3.4"), None);
        assert_eq!(parse_version("a.b.c"), None);
    }

    #[test]
    fn picks_highest_newer_desktop_release_with_platform_asset() {
        let releases = vec![
            rel("desktop-v0.1.1", false, false),
            rel("desktop-v0.3.0", false, false),
            rel("desktop-v0.2.0", false, false),
            rel("v9.9.9", false, false),
        ];
        let update = pick_update(&releases, "0.1.0").unwrap();
        assert_eq!(update.version, "0.3.0");
        assert!(update.page_url.ends_with("desktop-v0.3.0"));
        let name = update.asset.unwrap().name;
        assert!(if cfg!(windows) { name.ends_with("-setup.exe") } else { name.ends_with(".AppImage") });
        assert!(update.sums_url.unwrap().ends_with(SUMS_NAME));
    }

    #[test]
    fn ignores_drafts_prereleases_and_older() {
        let releases = vec![
            rel("desktop-v0.9.0", true, false),
            rel("desktop-v0.8.0", false, true),
            rel("desktop-v0.1.0", false, false),
        ];
        assert_eq!(pick_update(&releases, "0.1.0"), None);
    }

    #[test]
    fn ignores_foreign_urls() {
        let mut r = rel("desktop-v1.0.0", false, false);
        r.html_url = "https://evil.example/download".to_string();
        assert_eq!(pick_update(&[r], "0.1.0"), None);

        let mut r = rel("desktop-v1.0.0", false, false);
        for a in &mut r.assets {
            a.browser_download_url = "https://evil.example/x".to_string();
        }
        let update = pick_update(&[r], "0.1.0").unwrap();
        assert_eq!(update.asset, None);
        assert_eq!(update.sums_url, None);
    }

    #[test]
    fn reads_expected_hash() {
        let h = "a".repeat(64);
        let sums = format!("{h}  scale-desktop_1.0.0_x64-setup.exe\n{}  outro.deb\n", "b".repeat(64));
        assert_eq!(expected_hash(&sums, "scale-desktop_1.0.0_x64-setup.exe"), Some(h));
        assert_eq!(expected_hash(&sums, "nao-existe.exe"), None);
        assert_eq!(expected_hash("xyz  a.exe", "a.exe"), None);
    }

    #[test]
    fn hashes_sha256() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
