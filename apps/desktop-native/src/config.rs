//! Persistência local: origin do servidor (pasta de config do SO).
//!
//! Usa `directories::ProjectDirs` com qualifier "br", organization
//! "codecoffee", application "Scale".

use directories::ProjectDirs;

fn project_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from("br", "codecoffee", "Scale")
}

fn config_dir() -> Option<std::path::PathBuf> {
    project_dirs().map(|d| d.config_dir().to_path_buf())
}

/// Servidor de produção, fixo no app. Sobrescrevível no build:
/// `SCALE_SERVER_ORIGIN=https://outro.servidor cargo build --release`.
pub const PRODUCTION_ORIGIN: &str = match option_env!("SCALE_SERVER_ORIGIN") {
    Some(origin) => origin,
    None => "https://scale.nexushosts.tech",
};

/// Origin usada ao abrir. Release: sempre a de produção (não dá para trocar).
/// Debug: a salva na tela "Conectar" (desenvolvimento local) ou a de produção.
pub fn initial_origin() -> String {
    if cfg!(debug_assertions) {
        load_origin().unwrap_or_else(|| PRODUCTION_ORIGIN.to_string())
    } else {
        PRODUCTION_ORIGIN.to_string()
    }
}

/// Carrega a origin salva (sem barra final).
pub fn load_origin() -> Option<String> {
    let path = config_dir()?.join("origin.txt");
    let raw = std::fs::read_to_string(path).ok()?;
    let origin = raw.trim();
    (!origin.is_empty()).then(|| origin.to_string())
}

/// Grava a origin na pasta de configuração.
pub fn save_origin(origin: &str) -> Result<(), String> {
    let dir = config_dir().ok_or("pasta de configuração indisponível")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("origin.txt");
    std::fs::write(path, origin).map_err(|e| e.to_string())
}

/// Caminho do arquivo de fallback do token (fora do keyring).
pub fn token_file_path() -> Option<std::path::PathBuf> {
    config_dir().map(|d| d.join("token"))
}

/// Valida e normaliza a origin digitada.
///
/// - `https` sempre aceito
/// - `http` só para localhost / 127.0.0.1
/// - tudo além de scheme + host (+ porta) é descartado; sem barra final
pub fn validate_origin(input: &str) -> Result<String, String> {
    let input = input.trim();
    let parsed = url::Url::parse(input).map_err(|_| "Use uma URL completa, ex.: https://scale.example.com".to_string())?;
    let scheme = parsed.scheme();
    let host = parsed
        .host_str()
        .ok_or_else(|| "URL sem host".to_string())?;
    match scheme {
        "https" => {}
        "http" => {
            if host != "localhost" && host != "127.0.0.1" {
                return Err("http só é permitido para localhost ou 127.0.0.1; use https".to_string());
            }
        }
        _ => return Err("O endereço precisa começar com https:// (ou http://localhost)".to_string()),
    }
    let mut origin = format!("{scheme}://{host}");
    if let Some(port) = parsed.port() {
        origin.push_str(&format!(":{port}"));
    }
    Ok(origin)
}

/// Monta a URL do Socket.IO a partir da origin (só websocket, EIO=4).
pub fn socket_url(origin: &str) -> Result<String, String> {
    let parsed = url::Url::parse(origin).map_err(|e| e.to_string())?;
    let scheme = match parsed.scheme() {
        "https" => "wss",
        "http" => "ws",
        other => return Err(format!("scheme inválido: {other}")),
    };
    let host = parsed.host_str().ok_or("URL sem host")?;
    let mut url = format!("{scheme}://{host}");
    if let Some(port) = parsed.port() {
        url.push_str(&format!(":{port}"));
    }
    url.push_str("/socket.io/?EIO=4&transport=websocket");
    Ok(url)
}

/// Extrai o código de convite de um link `.../invite#<code>` ou do código puro.
pub fn extract_invite_code(input: &str) -> String {
    let input = input.trim();
    match input.split('#').next_back() {
        Some(code) => code.trim().to_string(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_https_origin() {
        assert_eq!(
            validate_origin("https://scale.example.com/").unwrap(),
            "https://scale.example.com"
        );
        assert_eq!(
            validate_origin("https://vps:8443/login").unwrap(),
            "https://vps:8443"
        );
    }

    #[test]
    fn production_origin_is_valid() {
        assert_eq!(validate_origin(PRODUCTION_ORIGIN).as_deref(), Ok(PRODUCTION_ORIGIN));
    }

    #[test]
    fn http_only_for_localhost() {
        assert!(validate_origin("http://localhost:4100").is_ok());
        assert!(validate_origin("http://127.0.0.1:4100").is_ok());
        assert!(validate_origin("http://scale.example.com").is_err());
    }

    #[test]
    fn rejects_garbage() {
        assert!(validate_origin("scale.example.com").is_err());
        assert!(validate_origin("ftp://x").is_err());
        assert!(validate_origin("").is_err());
    }

    #[test]
    fn builds_socket_url() {
        assert_eq!(
            socket_url("https://scale.example.com").unwrap(),
            "wss://scale.example.com/socket.io/?EIO=4&transport=websocket"
        );
        assert_eq!(
            socket_url("http://localhost:4100").unwrap(),
            "ws://localhost:4100/socket.io/?EIO=4&transport=websocket"
        );
    }

    #[test]
    fn extracts_invite_code() {
        assert_eq!(extract_invite_code("https://x/invite#abc123"), "abc123");
        assert_eq!(extract_invite_code("  abc123 "), "abc123");
        assert_eq!(extract_invite_code(""), "");
    }
}
