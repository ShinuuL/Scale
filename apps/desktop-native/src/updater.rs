//! Aviso de nova versão: consulta as GitHub Releases do repositório.
//!
//! Só avisa e abre a página da release no navegador; nunca baixa nem executa
//! instalador sozinho (o usuário confere a origem e roda o instalador).
//! Releases do desktop usam tags `desktop-v<semver>`; rascunhos e pré-releases
//! são ignorados.

use serde::Deserialize;

/// Repositório das releases. Sobrescrevível no build: `SCALE_UPDATE_REPO=dono/repo`.
pub const REPO: &str = match option_env!("SCALE_UPDATE_REPO") {
    Some(repo) => repo,
    None => "ShinuuL/Scale",
};
pub const TAG_PREFIX: &str = "desktop-v";
pub const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpdateInfo {
    pub version: String,
    pub url: String,
}

#[derive(Debug, Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    draft: bool,
    #[serde(default)]
    prerelease: bool,
}

/// `1.2.3` → (1, 2, 3). Aceita sufixo de build/pré (`1.2.3-rc1` vira 1.2.3).
fn parse_version(raw: &str) -> Option<(u64, u64, u64)> {
    let core = raw.trim().split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let v = (parts.next()??, parts.next()??, parts.next()??);
    parts.next().is_none().then_some(v)
}

/// Escolhe a maior versão de desktop publicada que seja mais nova que `current`.
fn pick_update(releases: &[Release], current: &str) -> Option<UpdateInfo> {
    let current = parse_version(current)?;
    releases
        .iter()
        .filter(|r| !r.draft && !r.prerelease)
        .filter(|r| r.html_url.starts_with("https://github.com/"))
        .filter_map(|r| {
            let version = r.tag_name.strip_prefix(TAG_PREFIX)?;
            Some((parse_version(version)?, version, r))
        })
        .filter(|(v, _, _)| *v > current)
        .max_by_key(|(v, _, _)| *v)
        .map(|(_, version, r)| UpdateInfo {
            version: version.to_string(),
            url: r.html_url.clone(),
        })
}

/// Consulta a API do GitHub. Erro de rede/limite vira `None` (tenta no próximo início).
pub async fn check() -> Option<UpdateInfo> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("scale-desktop/", env!("CARGO_PKG_VERSION")))
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .ok()?;
    let releases: Vec<Release> = client
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rel(tag: &str, draft: bool, prerelease: bool) -> Release {
        Release {
            tag_name: tag.to_string(),
            html_url: format!("https://github.com/x/y/releases/tag/{tag}"),
            draft,
            prerelease,
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
    fn picks_highest_newer_desktop_release() {
        let releases = vec![
            rel("desktop-v0.1.1", false, false),
            rel("desktop-v0.3.0", false, false),
            rel("desktop-v0.2.0", false, false),
            rel("v9.9.9", false, false),
        ];
        let update = pick_update(&releases, "0.1.0").unwrap();
        assert_eq!(update.version, "0.3.0");
        assert!(update.url.ends_with("desktop-v0.3.0"));
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
    }
}
