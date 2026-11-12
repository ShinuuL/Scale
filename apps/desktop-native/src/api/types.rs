//! Tipos serde do contrato REST/socket do servidor Scale.
//!
//! Fase 1 (comunidades): `docs/plano-comunidades-desktop-nativo.md`.
//! DMs/amigos: `apps/server/src/routes/social.ts` + `@scale/shared/social.ts`.
//! Todos os campos `createdAt`/`expiresAt` chegam como ISO 8601 em string.
//!
//! São DTOs de contrato: nem todo campo é lido pela UI na R1, mas faz parte
//! do payload do servidor.
#![allow(dead_code)]

use serde::{Deserialize, Serialize};

/// Usuário logado (login/me). `email` só aparece nas rotas de conta.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: String,
}

/// Resposta de `POST /api/auth/login` e `GET /api/auth/me`.
/// O JWT NÃO vem no corpo: só em `Set-Cookie: token=<jwt>` (HttpOnly).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub user: User,
}

/// Resposta de `GET /api/health`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Health {
    pub status: String,
}

/// Usuário como aparece para outro usuário (nunca e-mail).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicUser {
    pub id: String,
    pub username: Option<String>,
    pub name: String,
    pub avatar_updated_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendRequestDto {
    pub id: String,
    pub user: PublicUser,
    pub created_at: String,
}

/// Resposta de `GET /api/friends`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendsList {
    pub friends: Vec<PublicUser>,
    pub incoming: Vec<FriendRequestDto>,
    pub outgoing: Vec<FriendRequestDto>,
}

/// Mensagem privada (`directMessageSchema` em @scale/shared).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectMessage {
    pub id: String,
    pub sender_id: String,
    pub recipient_id: String,
    pub content: String,
    pub created_at: String,
}

// ---- Comunidades (Fase 1) ----

/// Resumo de `GET /api/communities`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunitySummary {
    pub id: String,
    pub name: String,
    pub role: CommunityRole,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum CommunityRole {
    Owner,
    Admin,
    Member,
}

impl CommunityRole {
    pub fn label(self) -> &'static str {
        match self {
            CommunityRole::Owner => "Dono",
            CommunityRole::Admin => "Admin",
            CommunityRole::Member => "Membro",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum ChannelKind {
    Text,
    Voice,
}

/// Canal de comunidade (é um `Room` com communityId no servidor).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub kind: ChannelKind,
    pub position: i32,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityMember {
    pub user_id: String,
    pub name: String,
    pub username: Option<String>,
    pub role: CommunityRole,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityInner {
    pub id: String,
    pub name: String,
    pub owner_id: String,
}

/// Resposta de `GET /api/communities/:id`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommunityDetail {
    pub community: CommunityInner,
    pub my_role: CommunityRole,
    pub channels: Vec<Channel>,
    pub members: Vec<CommunityMember>,
}

/// Autor visível das mensagens de canal.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAuthor {
    pub id: String,
    pub name: String,
    pub username: Option<String>,
}

/// Mensagem de canal de texto.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessage {
    pub id: String,
    pub channel_id: String,
    pub author: ChannelAuthor,
    pub content: String,
    pub created_at: String,
    pub edited_at: Option<String>,
    pub deleted_at: Option<String>,
}

/// Histórico de canal aceita tanto `[msg, ...]` quanto `{messages, nextCursor}`.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ChannelHistory {
    Plain(Vec<ChannelMessage>),
    Paged {
        messages: Vec<ChannelMessage>,
        #[serde(default, rename = "nextCursor")]
        next_cursor: Option<String>,
    },
}

impl ChannelHistory {
    pub fn into_parts(self) -> (Vec<ChannelMessage>, Option<String>) {
        match self {
            ChannelHistory::Plain(msgs) => (msgs, None),
            ChannelHistory::Paged { messages, next_cursor } => (messages, next_cursor),
        }
    }
}

/// Validade de convite: 1h, 24h ou 7d.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum ExpiresIn {
    #[serde(rename = "1h")]
    OneHour,
    #[serde(rename = "24h")]
    TwentyFourHours,
    #[serde(rename = "7d")]
    SevenDays,
}

impl ExpiresIn {
    pub fn label(self) -> &'static str {
        match self {
            ExpiresIn::OneHour => "1 hora",
            ExpiresIn::TwentyFourHours => "24 horas",
            ExpiresIn::SevenDays => "7 dias",
        }
    }
}

/// Resposta de `POST /api/communities/:id/invites`. O código aparece UMA vez.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteCreated {
    pub id: String,
    pub code: String,
    pub expires_at: String,
    pub max_uses: Option<u32>,
}

/// Resposta de `POST /api/invites/preview`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitePreview {
    pub community: InvitePreviewCommunity,
    pub already_member: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitePreviewCommunity {
    pub id: String,
    pub name: String,
    pub member_count: u64,
}

/// Resposta de `POST /api/invites/accept`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteAccepted {
    pub community_id: String,
}

/// Membro em um canal de voz (`community:voice-state`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceMember {
    pub user_id: String,
    pub name: String,
}

/// Estado de voz de um canal (`community:voice-state`).
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceState {
    pub channel_id: String,
    pub members: Vec<VoiceMember>,
}

/// Ack de `community:subscribe`: `{success:true, voiceStates}` ou `{error}`.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum SubscribeAck {
    Ok {
        #[allow(dead_code)]
        success: bool,
        #[serde(rename = "voiceStates")]
        voice_states: Vec<VoiceState>,
    },
    Err { error: String },
}

// ---- Payloads de socket (eventos entrantes) ----

/// Evento `channel:message`: aceita o DTO direto ou `{message: ...}`.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ChannelMessageEvent {
    Direct(ChannelMessage),
    Wrapped { message: ChannelMessage },
}

impl ChannelMessageEvent {
    pub fn into_message(self) -> ChannelMessage {
        match self {
            ChannelMessageEvent::Direct(m) => m,
            ChannelMessageEvent::Wrapped { message } => message,
        }
    }
}

/// Evento `channel:message-edit`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageEditEvent {
    pub channel_id: String,
    pub message_id: String,
    pub content: String,
    pub edited_at: String,
}

/// Evento `channel:message-delete`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMessageDeleteEvent {
    pub channel_id: String,
    pub message_id: String,
    pub deleted_at: String,
}

/// Evento `dm:message`: o servidor emite o DTO da mensagem diretamente.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum DmMessageEvent {
    Direct(DirectMessage),
    Wrapped { message: DirectMessage },
}

impl DmMessageEvent {
    pub fn into_message(self) -> DirectMessage {
        match self {
            DmMessageEvent::Direct(m) => m,
            DmMessageEvent::Wrapped { message } => message,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_channel_edit_and_delete_events() {
        let e: ChannelMessageEditEvent = serde_json::from_str(
            r#"{"channelId":"c","messageId":"m","content":"oi","editedAt":"2026-11-09T10:00:00.000Z"}"#,
        )
        .unwrap();
        assert_eq!(e.message_id, "m");
        assert_eq!(e.content, "oi");
        let d: ChannelMessageDeleteEvent = serde_json::from_str(
            r#"{"channelId":"c","messageId":"m","deletedAt":"2026-11-09T10:01:00.000Z"}"#,
        )
        .unwrap();
        assert_eq!(d.channel_id, "c");
        assert_eq!(d.deleted_at, "2026-11-09T10:01:00.000Z");
    }

    #[test]
    fn parses_login_response() {
        let json = r#"{"user":{"id":"u1","email":"a@b.c","name":"Ana"}}"#;
        let auth: AuthResponse = serde_json::from_str(json).unwrap();
        assert_eq!(auth.user.name, "Ana");
    }

    #[test]
    fn parses_friends_list() {
        let json = r#"{
            "friends":[{"id":"u2","username":"bia","name":"Bia","avatarUpdatedAt":null}],
            "incoming":[], "outgoing":[]
        }"#;
        let list: FriendsList = serde_json::from_str(json).unwrap();
        assert_eq!(list.friends.len(), 1);
        assert_eq!(list.friends[0].username.as_deref(), Some("bia"));
    }

    #[test]
    fn parses_community_detail() {
        let json = r#"{
            "community":{"id":"c1","name":"Dev","ownerId":"u1"},
            "myRole":"OWNER",
            "channels":[{"id":"ch1","name":"geral","kind":"TEXT","position":0}],
            "members":[{"userId":"u1","name":"Ana","username":null,"role":"OWNER"}]
        }"#;
        let detail: CommunityDetail = serde_json::from_str(json).unwrap();
        assert_eq!(detail.my_role, CommunityRole::Owner);
        assert_eq!(detail.channels[0].kind, ChannelKind::Text);
    }

    #[test]
    fn channel_history_accepts_array_and_paged() {
        let msg = r#"{"id":"m1","channelId":"ch1","author":{"id":"u1","name":"Ana","username":null},"content":"oi","createdAt":"2026-11-09T12:00:00.000Z","editedAt":null,"deletedAt":null}"#;
        let plain: ChannelHistory = serde_json::from_str(&format!("[{msg}]")).unwrap();
        assert_eq!(plain.into_parts().0.len(), 1);
        let paged: ChannelHistory =
            serde_json::from_str(&format!(r#"{{"messages":[{msg}],"nextCursor":"abc"}}"#)).unwrap();
        assert_eq!(paged.into_parts().1.as_deref(), Some("abc"));
    }

    #[test]
    fn invite_expires_in_serializes() {
        assert_eq!(
            serde_json::to_string(&ExpiresIn::SevenDays).unwrap(),
            r#""7d""#
        );
    }

    #[test]
    fn subscribe_ack_parses_voice_states_and_error() {
        let ok: SubscribeAck = serde_json::from_str(
            r#"{"success":true,"voiceStates":[{"channelId":"ch1","members":[{"userId":"u1","name":"Ana"}]}]}"#,
        )
        .unwrap();
        match ok {
            SubscribeAck::Ok { voice_states, .. } => {
                assert_eq!(voice_states[0].channel_id, "ch1");
                assert_eq!(voice_states[0].members[0].name, "Ana");
            }
            other => panic!("esperava Ok, veio {other:?}"),
        }
        let err: SubscribeAck = serde_json::from_str(r#"{"error":"Sem acesso"}"#).unwrap();
        assert!(matches!(err, SubscribeAck::Err { error } if error == "Sem acesso"));
    }

    #[test]
    fn voice_state_event_parses() {
        let json = r#"{"channelId":"ch9","members":[{"userId":"u1","name":"Ana"}]}"#;
        let vs: VoiceState = serde_json::from_str(json).unwrap();
        assert_eq!(vs.members[0].name, "Ana");
    }
}
