//! Cliente REST do servidor Scale (reqwest + rustls).
//!
//! Autenticação: o login devolve o JWT só no `Set-Cookie: token=...`; o
//! cliente extrai, guarda em [`crate::token_store`] e passa adiante como
//! `Authorization: Bearer`. 401 vira [`ApiError::Unauthorized`] para a UI
//! voltar à tela de login.

use reqwest::header::{AUTHORIZATION, SET_COOKIE};
use serde_json::json;
use thiserror::Error;

use crate::api::types::*;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("sessão expirada (401)")]
    Unauthorized,
    #[error("HTTP {0}: {1}")]
    Http(u16, String),
    #[error("rede: {0}")]
    Reqwest(#[from] reqwest::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, ApiError>;

fn map_status(status: reqwest::StatusCode, body: String) -> ApiError {
    if status.as_u16() == 401 {
        ApiError::Unauthorized
    } else {
        ApiError::Http(status.as_u16(), body)
    }
}

/// Extrai `token=<jwt>` do header Set-Cookie (primeiro cookie com esse nome).
fn extract_token(resp: &reqwest::Response) -> Option<String> {
    for value in resp.headers().get_all(SET_COOKIE).iter() {
        let Ok(s) = value.to_str() else { continue };
        for part in s.split(';') {
            let part = part.trim();
            if let Some(jwt) = part.strip_prefix("token=") {
                return Some(jwt.to_string());
            }
        }
    }
    None
}

pub struct Api {
    client: reqwest::Client,
}

impl Default for Api {
    fn default() -> Self {
        Self::new()
    }
}

impl Api {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    fn url(origin: &str, path: &str) -> String {
        format!("{origin}{path}")
    }

    fn bearer(token: &str) -> String {
        format!("Bearer {token}")
    }

    // ---- autenticação ----

    /// `GET /api/health` → 200 {"status":"ok"}.
    pub async fn health(&self, origin: &str) -> Result<()> {
        let resp = self
            .client
            .get(Self::url(origin, "/api/health"))
            .send()
            .await?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(map_status(status, body));
        }
        let health: Health = serde_json::from_str(&body)?;
        if health.status != "ok" {
            return Err(ApiError::Http(200, format!("status inesperado: {body}")));
        }
        Ok(())
    }

    /// `POST /api/auth/login` → usuário + JWT do Set-Cookie.
    pub async fn login(
        &self,
        origin: &str,
        email: &str,
        password: &str,
    ) -> Result<(User, String)> {
        let resp = self
            .client
            .post(Self::url(origin, "/api/auth/login"))
            .json(&json!({ "email": email, "password": password }))
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_status(status, body));
        }
        let token = extract_token(&resp).ok_or(ApiError::Http(
            200,
            "login sem cookie token".to_string(),
        ))?;
        let auth: AuthResponse = resp.json().await?;
        Ok((auth.user, token))
    }

    /// `GET /api/auth/me` com Bearer.
    pub async fn me(&self, origin: &str, token: &str) -> Result<User> {
        let resp = self
            .client
            .get(Self::url(origin, "/api/auth/me"))
            .header(AUTHORIZATION, Self::bearer(token))
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_status(status, body));
        }
        let auth: AuthResponse = resp.json().await?;
        Ok(auth.user)
    }

    /// `POST /api/auth/refresh` → novo JWT se o servidor regravar o cookie.
    pub async fn refresh(&self, origin: &str, token: &str) -> Result<Option<String>> {
        let resp = self
            .client
            .post(Self::url(origin, "/api/auth/refresh"))
            .header(AUTHORIZATION, Self::bearer(token))
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_status(status, body));
        }
        Ok(extract_token(&resp))
    }

    // ---- amigos e DMs ----

    /// `GET /api/friends`.
    pub async fn friends(&self, origin: &str, token: &str) -> Result<FriendsList> {
        self.get(origin, token, "/api/friends").await
    }

    /// `GET /api/dm/:userId/messages?before=<ISO>` — do mais antigo ao novo.
    pub async fn dm_history(
        &self,
        origin: &str,
        token: &str,
        user_id: &str,
        before: Option<&str>,
    ) -> Result<Vec<DirectMessage>> {
        let mut path = format!("/api/dm/{user_id}/messages");
        if let Some(before) = before {
            path.push_str(&format!("?before={}", url::form_urlencoded::byte_serialize(before.as_bytes()).next().unwrap_or("")));
        }
        self.get(origin, token, &path).await
    }

    /// `POST /api/dm/:userId/messages {content}`.
    pub async fn dm_send(
        &self,
        origin: &str,
        token: &str,
        user_id: &str,
        content: &str,
    ) -> Result<DirectMessage> {
        self.post(origin, token, &format!("/api/dm/{user_id}/messages"), &json!({ "content": content })).await
    }

    // ---- comunidades (Fase 1) ----

    /// `GET /api/communities` — minhas comunidades.
    pub async fn communities(&self, origin: &str, token: &str) -> Result<Vec<CommunitySummary>> {
        self.get(origin, token, "/api/communities").await
    }

    /// `GET /api/communities/:id` — detalhe (canais + membros + meu cargo).
    pub async fn community_detail(
        &self,
        origin: &str,
        token: &str,
        id: &str,
    ) -> Result<CommunityDetail> {
        self.get(origin, token, &format!("/api/communities/{id}")).await
    }

    /// `POST /api/communities {name}`.
    pub async fn create_community(
        &self,
        origin: &str,
        token: &str,
        name: &str,
    ) -> Result<CommunitySummary> {
        self.post(origin, token, "/api/communities", &json!({ "name": name })).await
    }

    /// `POST /api/communities/:id/channels {name, kind}`.
    pub async fn create_channel(
        &self,
        origin: &str,
        token: &str,
        community_id: &str,
        name: &str,
        kind: ChannelKind,
    ) -> Result<Channel> {
        self.post(
            origin,
            token,
            &format!("/api/communities/{community_id}/channels"),
            &json!({ "name": name, "kind": kind }),
        )
        .await
    }

    /// `GET /api/channels/:id/messages?cursor&limit` — histórico paginado.
    pub async fn channel_messages(
        &self,
        origin: &str,
        token: &str,
        channel_id: &str,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<ChannelHistory> {
        let mut path = format!("/api/channels/{channel_id}/messages?limit={limit}");
        if let Some(cursor) = cursor {
            path.push_str(&format!("&cursor={}", urlencoding(cursor)));
        }
        self.get(origin, token, &path).await
    }

    /// `POST /api/channels/:id/messages {content}`.
    pub async fn channel_send(
        &self,
        origin: &str,
        token: &str,
        channel_id: &str,
        content: &str,
    ) -> Result<ChannelMessage> {
        self.post(
            origin,
            token,
            &format!("/api/channels/{channel_id}/messages"),
            &json!({ "content": content }),
        )
        .await
    }

    /// `POST /api/communities/:id/invites {expiresIn, maxUses?}`.
    pub async fn create_invite(
        &self,
        origin: &str,
        token: &str,
        community_id: &str,
        expires_in: ExpiresIn,
    ) -> Result<InviteCreated> {
        self.post(
            origin,
            token,
            &format!("/api/communities/{community_id}/invites"),
            &json!({ "expiresIn": expires_in }),
        )
        .await
    }

    /// `POST /api/invites/preview {code}`.
    pub async fn preview_invite(
        &self,
        origin: &str,
        token: &str,
        code: &str,
    ) -> Result<InvitePreview> {
        self.post(origin, token, "/api/invites/preview", &json!({ "code": code })).await
    }

    /// `POST /api/invites/accept {code}` → {communityId}.
    pub async fn accept_invite(
        &self,
        origin: &str,
        token: &str,
        code: &str,
    ) -> Result<InviteAccepted> {
        self.post(origin, token, "/api/invites/accept", &json!({ "code": code })).await
    }

    /// `POST /api/communities/:id/leave`.
    pub async fn leave_community(&self, origin: &str, token: &str, id: &str) -> Result<()> {
        let resp = self
            .client
            .post(Self::url(origin, &format!("/api/communities/{id}/leave")))
            .header(AUTHORIZATION, Self::bearer(token))
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() && status.as_u16() != 404 {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_status(status, body));
        }
        Ok(())
    }

    // ---- genéricos ----

    async fn get<T: serde::de::DeserializeOwned>(
        &self,
        origin: &str,
        token: &str,
        path: &str,
    ) -> Result<T> {
        let resp = self
            .client
            .get(Self::url(origin, path))
            .header(AUTHORIZATION, Self::bearer(token))
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(map_status(status, body));
        }
        Ok(resp.json().await?)
    }

    async fn post<T: serde::de::DeserializeOwned>(
        &self,
        origin: &str,
        token: &str,
        path: &str,
        body: &serde_json::Value,
    ) -> Result<T> {
        let resp = self
            .client
            .post(Self::url(origin, path))
            .header(AUTHORIZATION, Self::bearer(token))
            .json(body)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(map_status(status, text));
        }
        Ok(resp.json().await?)
    }
}

/// Codifica um cursor para uso em query string.
fn urlencoding(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}
