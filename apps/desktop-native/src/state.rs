//! Estado da aplicação e eventos que a thread de rede envia para a UI.

use std::collections::HashMap;

use crate::api::types::*;

/// Tela atual.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Screen {
    /// Informar/testar a origin do servidor.
    Conectar,
    /// E-mail/senha.
    Login,
    /// Principal (4 colunas).
    Principal,
}

/// O que a coluna do meio está mostrando.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MainView {
    Dms,
    Community(String),
}

/// Histórico de um canal de texto (paginação por cursor/createdAt).
#[derive(Debug)]
pub struct ChatLog {
    pub messages: Vec<ChannelMessage>,
    /// Pode carregar mais ao rolar para cima?
    pub has_more: bool,
    pub loading_older: bool,
    /// Cursor para a próxima página (oldest known id/createdAt).
    pub oldest_cursor: Option<String>,
    /// Se a resposta paginada deu nextCursor, usa ele; senão o createdAt da
    /// mensagem mais antiga.
    pub explicit_cursor: bool,
    /// Offset vertical da última frame (detectar scroll para cima).
    pub last_offset: f32,
    /// Já renderizou ao menos uma frame (não dispara carga na abertura).
    pub seen_frame: bool,
}

impl Default for ChatLog {
    fn default() -> Self {
        Self {
            messages: Vec::new(),
            has_more: true,
            loading_older: false,
            oldest_cursor: None,
            explicit_cursor: false,
            last_offset: f32::MAX,
            seen_frame: false,
        }
    }
}

/// Histórico de DM com um amigo (paginação por `before` ISO).
#[derive(Debug)]
pub struct DmLog {
    pub messages: Vec<DirectMessage>,
    pub has_more: bool,
    pub loading_older: bool,
    pub last_offset: f32,
    pub seen_frame: bool,
}

impl Default for DmLog {
    fn default() -> Self {
        Self {
            messages: Vec::new(),
            has_more: true,
            loading_older: false,
            last_offset: f32::MAX,
            seen_frame: false,
        }
    }
}

/// Estado completo da tela principal.
pub struct MainState {
    pub view: MainView,
    pub communities: Vec<CommunitySummary>,
    /// Detalhe da comunidade aberta (canais, membros, meu cargo).
    pub community: Option<CommunityDetail>,
    pub channel_logs: HashMap<String, ChatLog>,
    pub current_channel: Option<String>,
    /// friends:changed → true quando a lista precisa refazer GET.
    pub friends_dirty: bool,
    pub friends: Option<FriendsList>,
    pub current_friend: Option<String>,
    pub dm_logs: HashMap<String, DmLog>,
    /// community:voice-state por canal de voz.
    pub voice_states: HashMap<String, Vec<VoiceMember>>,
    /// Socket conectado agora?
    pub socket_connected: bool,
}

impl MainState {
    pub fn new() -> Self {
        Self {
            view: MainView::Dms,
            communities: Vec::new(),
            community: None,
            channel_logs: HashMap::new(),
            current_channel: None,
            friends_dirty: true,
            friends: None,
            current_friend: None,
            dm_logs: HashMap::new(),
            voice_states: HashMap::new(),
            socket_connected: false,
        }
    }

    /// Dono ou admin da comunidade aberta (criar canal etc.).
    pub fn can_manage(&self) -> bool {
        matches!(
            self.community.as_ref().map(|c| c.my_role),
            Some(CommunityRole::Owner) | Some(CommunityRole::Admin)
        )
    }
}

/// Eventos produzidos pelas tarefas de rede (REST e socket), consumidos com
/// `try_recv` no frame da UI — a UI nunca bloqueia.
/// Etapas da atualização automática do desktop.
#[derive(Debug, Clone, Default)]
pub enum UpdateState {
    #[default]
    Nenhuma,
    Baixando(String),
    /// Pronta: instala quando `deadline` passar (ou ao clicar em "Reiniciar agora").
    /// "Adiar" empurra o prazo em [`crate::app::POSTPONE`].
    Pronta { update: crate::updater::Downloaded, deadline: std::time::Instant },
    /// Não dá para instalar sozinho (ex.: .deb): só avisa e abre a página.
    Manual(crate::updater::UpdateInfo),
    Falhou(String),
}

pub enum UiEvent {
    HealthChecked(std::result::Result<(), String>),
    LoginOk { user: User, token: String },
    LoginErr(String),
    MeOk(User),
    Unauthorized,
    FriendsOk(FriendsList),
    DmHistoryOk { peer: String, messages: Vec<DirectMessage> },
    DmSent(DirectMessage),
    DmIncoming(DirectMessage),
    CommunitiesOk(Vec<CommunitySummary>),
    CommunityOk(CommunityDetail),
    CommunityErr(String),
    ChannelHistoryOk {
        channel: String,
        messages: Vec<ChannelMessage>,
        next_cursor: Option<String>,
        /// true quando era uma página antiga (prepend), não a primeira carga.
        older: bool,
        /// true quando o cursor veio do campo nextCursor do servidor.
        explicit_cursor: bool,
    },
    ChannelMessageNew(ChannelMessage),
    /// Ack de `community:subscribe`: substitui os estados de voz.
    SubscribeAck(Vec<VoiceState>),
    ChannelMessageEdited(ChannelMessageEditEvent),
    ChannelMessageDeleted(ChannelMessageDeleteEvent),
    MessagePosted,
    CommunityChanged(String),
    CommunityDeleted(String),
    CommunityRemoved(String),
    VoiceState(VoiceState),
    InviteCreated(InviteCreated),
    InvitePreviewOk { code: String, preview: InvitePreview },
    InviteAccepted { community_id: String },
    SocketConnected,
    SocketDisconnected,
    /// Resultado do refresh de sessão: novo JWT se o servidor regravou o cookie.
    SessionRefreshed(Option<String>),
    /// Nova versão do desktop publicada nas GitHub Releases.
    UpdateAvailable(crate::updater::UpdateInfo),
    /// Instalador baixado e conferido (ou o erro).
    UpdateDownloaded(std::result::Result<crate::updater::Downloaded, String>),
    Err(String),
}
