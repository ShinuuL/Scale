//! Guarda do JWT: keyring do SO, com fallback em arquivo 0600.
//!
//! O JWT nunca vem no corpo das respostas — só em `Set-Cookie: token=...`
//! (HttpOnly). Aqui ele fica disponível para o header `Authorization: Bearer`
//! (REST) e o `auth.token` do Socket.IO.

use crate::config;
use keyring::Entry;

const SERVICE: &str = "br.com.codecoffee.scale";
const USER: &str = "token";

/// Grava o token: keyring se der; senão arquivo com permissão 0600.
pub fn store(token: &str) {
    match Entry::new(SERVICE, USER).and_then(|e| e.set_password(token)) {
        Ok(()) => {
            // Se existir um fallback antigo, remove.
            if let Some(path) = config::token_file_path() {
                let _ = std::fs::remove_file(path);
            }
        }
        Err(_) => store_fallback(token),
    }
}

fn store_fallback(token: &str) {
    let Some(path) = config::token_file_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    use std::io::Write as _;
    if let Ok(mut f) = std::fs::File::create(&path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let _ = f.set_permissions(std::fs::Permissions::from_mode(0o600));
        }
        let _ = f.write_all(token.as_bytes());
    }
}

/// Lê o token de onde estiver. None = não logado.
pub fn load() -> Option<String> {
    if let Ok(entry) = Entry::new(SERVICE, USER) {
        if let Ok(token) = entry.get_password() {
            if !token.is_empty() {
                return Some(token);
            }
        }
    }
    let path = config::token_file_path()?;
    let token = std::fs::read_to_string(path).ok()?;
    let token = token.trim();
    (!token.is_empty()).then(|| token.to_string())
}

/// Apaga o token (logout): dos dois lugares.
pub fn clear() {
    if let Ok(entry) = Entry::new(SERVICE, USER) {
        let _ = entry.delete_credential();
    }
    if let Some(path) = config::token_file_path() {
        let _ = std::fs::remove_file(path);
    }
}
