//! `ScaleApp`: estado, despacho das tarefas de rede e aplicação dos eventos.
//!
//! Toda chamada de rede roda numa tarefa tokio; o resultado volta por um
//! canal std (`UiEvent`) que a UI drena com `try_recv` a cada frame. A UI
//! nunca espera a rede.

use std::collections::HashSet;
use std::sync::mpsc::{Receiver, Sender};

use tokio::runtime::Handle;

use crate::api::client::{Api, ApiError};
use crate::api::types::*;
use crate::config;
use crate::net::socketio::{self, Packet, SocketEvent, SocketHandle};
use crate::state::*;
use crate::token_store;

pub struct ScaleApp {
    pub rt: Handle,
    pub socket: SocketHandle,
    pub events_tx: Sender<UiEvent>,
    pub events_rx: Receiver<UiEvent>,
    pub socket_rx: Receiver<SocketEvent>,

    pub screen: Screen,
    pub origin: String,
    pub token: Option<String>,
    /// Usuário logado (identidade nas mensagens).
    pub me: Option<User>,

    // Tela "Conectar ao servidor".
    pub origin_input: String,
    pub connect_error: String,
    pub connect_busy: bool,

    // Tela de login.
    pub email: String,
    pub password: String,
    pub login_error: String,
    pub login_busy: bool,

    pub main: Option<MainState>,

    // Diálogos e seus campos.
    pub show_create_community: bool,
    pub create_community_name: String,
    pub show_invite: bool,
    pub invite_expiry: ExpiresIn,
    pub invite_result: Option<InviteCreated>,
    pub show_join_invite: bool,
    pub join_invite_input: String,
    pub join_invite_busy: bool,
    pub join_invite_preview: Option<(String, InvitePreview)>,
    pub show_create_channel: bool,
    pub create_channel_name: String,
    pub create_channel_voice: bool,

    /// Composer do chat e o contexto em que ele vale (ch:<id> / dm:<id>).
    pub composer: String,
    pub composer_for: String,

    /// Mensagem transitória de status/erro (barra do chat).
    pub status_message: String,
    /// Comunidades com `community:subscribe` já enviado (re-subscreve ao
    /// reconectar).
    pub subscribed: HashSet<String>,
    /// Evita laço infinito de refresh: uma tentativa por 401.
    pub refreshing: bool,
}

impl ScaleApp {
    pub fn new(_cc: &eframe::CreationContext<'_>, rt: Handle) -> Self {
        let (events_tx, events_rx) = std::sync::mpsc::channel::<UiEvent>();
        let (socket_tx, socket_rx) = std::sync::mpsc::channel::<SocketEvent>();
        let socket = socketio::spawn(&rt, socket_tx);

        let saved_origin = config::load_origin().unwrap_or_default();
        let token = token_store::load();
        let screen = if saved_origin.is_empty() {
            Screen::Conectar
        } else {
            Screen::Login
        };

        Self {
            rt,
            socket,
            events_tx,
            events_rx,
            socket_rx,
            screen,
            origin: saved_origin.clone(),
            token,
            me: None,
            origin_input: saved_origin,
            connect_error: String::new(),
            connect_busy: false,
            email: String::new(),
            password: String::new(),
            login_error: String::new(),
            login_busy: false,
            main: None,
            show_create_community: false,
            create_community_name: String::new(),
            show_invite: false,
            invite_expiry: ExpiresIn::SevenDays,
            invite_result: None,
            show_join_invite: false,
            join_invite_input: String::new(),
            join_invite_busy: false,
            join_invite_preview: None,
            show_create_channel: false,
            create_channel_name: String::new(),
            create_channel_voice: false,
            composer: String::new(),
            composer_for: String::new(),
            status_message: String::new(),
            subscribed: HashSet::new(),
            refreshing: false,
        }
    }

    /// Despacha um futuro na runtime tokio. O futuro envia `UiEvent`s de
    /// volta; nunca toca no estado da UI.
    pub fn spawn(&self, fut: impl std::future::Future<Output = ()> + Send + 'static) {
        self.rt.spawn(fut);
    }

    fn origin_token(&self) -> Option<(String, String)> {
        Some((self.origin.clone(), self.token.clone()?))
    }

    // ---- despacho: conexão e login ----

    pub fn check_health(&mut self) {
        let Ok(origin) = config::validate_origin(&self.origin_input) else {
            self.connect_error = "Endereço inválido: use https://servidor (http só para localhost)".to_string();
            return;
        };
        self.connect_busy = true;
        self.connect_error.clear();
        let tx = self.events_tx.clone();
        self.spawn(async move {
            let result = Api::new().health(&origin).await.map_err(|e| e.to_string());
            let _ = tx.send(UiEvent::HealthChecked(result));
        });
    }

    pub fn do_login(&mut self) {
        if self.email.trim().is_empty() || self.password.is_empty() {
            self.login_error = "Preencha e-mail e senha.".to_string();
            return;
        }
        self.login_busy = true;
        self.login_error.clear();
        let tx = self.events_tx.clone();
        let origin = self.origin.clone();
        let email = self.email.trim().to_string();
        let password = std::mem::take(&mut self.password);
        self.spawn(async move {
            let result = Api::new().login(&origin, &email, &password).await;
            let _ = tx.send(match result {
                Ok((user, token)) => UiEvent::LoginOk { user, token },
                Err(ApiError::Unauthorized) => UiEvent::LoginErr("E-mail ou senha inválidos.".into()),
                Err(e) => UiEvent::LoginErr(e.to_string()),
            });
        });
    }

    /// Carrega /api/auth/me com o token guardado (abertura do app).
    pub fn restore_session(&mut self) {
        let Some((origin, token)) = self.origin_token() else {
            self.screen = Screen::Login;
            return;
        };
        let tx = self.events_tx.clone();
        self.spawn(async move {
            let result = Api::new().me(&origin, &token).await;
            let _ = tx.send(match result {
                Ok(user) => UiEvent::MeOk(user),
                Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                Err(e) => UiEvent::Err(e.to_string()),
            });
        });
    }

    pub fn logout(&mut self) {
        self.socket.disconnect();
        token_store::clear();
        self.token = None;
        self.me = None;
        self.main = None;
        self.subscribed.clear();
        self.refreshing = false;
        self.screen = Screen::Login;
        self.login_error.clear();
    }

    /// `POST /api/auth/refresh` → novo token do Set-Cookie, se houver.
    fn try_refresh(&mut self) {
        self.refreshing = true;
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new().refresh(&origin, &token).await;
                let _ = tx.send(match result {
                    Ok(new_token) => UiEvent::SessionRefreshed(new_token),
                    Err(_) => UiEvent::Unauthorized,
                });
            });
        } else {
            self.refreshing = false;
            self.logout();
        }
    }

    // ---- despacho: dados principais ----

    pub fn load_communities(&self) {
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new().communities(&origin, &token).await;
                let _ = tx.send(match result {
                    Ok(list) => UiEvent::CommunitiesOk(list),
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::Err(e.to_string()),
                });
            });
        }
    }

    pub fn load_friends(&self) {
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new().friends(&origin, &token).await;
                let _ = tx.send(match result {
                    Ok(list) => UiEvent::FriendsOk(list),
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::Err(e.to_string()),
                });
            });
        }
    }

    /// Abre uma comunidade: detalhe + subscribe no socket.
    pub fn open_community(&mut self, id: &str) {
        if let Some(main) = &mut self.main {
            main.view = MainView::Community(id.to_string());
            main.current_channel = None;
        }
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            let id = id.to_string();
            self.spawn(async move {
                let result = Api::new().community_detail(&origin, &token, &id).await;
                let _ = tx.send(match result {
                    Ok(detail) => UiEvent::CommunityOk(detail),
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::CommunityErr(e.to_string()),
                });
            });
        }
        self.subscribe_community(id);
    }

    /// `community:subscribe` no socket (idempotente; reenviado ao reconectar).
    pub fn subscribe_community(&mut self, id: &str) {
        if self.subscribed.insert(id.to_string()) {
            let (acks, ack_id, rx) = self.socket.send_event_with_ack(
                "community:subscribe",
                &serde_json::json!({ "communityId": id }),
            );
            let tx = self.events_tx.clone();
            self.spawn(async move {
                let ev = match acks.wait(ack_id, rx, socketio::ACK_TIMEOUT).await {
                    Some(v) => match serde_json::from_value::<SubscribeAck>(v) {
                        Ok(SubscribeAck::Ok { voice_states, .. }) => {
                            UiEvent::SubscribeAck(voice_states)
                        }
                        Ok(SubscribeAck::Err { error }) => UiEvent::Err(error),
                        Err(_) => UiEvent::Err("Resposta inválida ao assinar a comunidade.".into()),
                    },
                    None => UiEvent::Err("Sem resposta ao assinar a comunidade.".into()),
                };
                let _ = tx.send(ev);
            });
        }
    }

    pub fn open_channel(&mut self, id: &str) {
        if let Some(main) = &mut self.main {
            main.current_channel = Some(id.to_string());
        }
        self.load_channel_history(id, false);
    }

    pub fn load_channel_history(&self, channel: &str, older: bool) {
        let tx = self.events_tx.clone();
        let Some((origin, token)) = self.origin_token() else { return };
        let channel = channel.to_string();
        let (cursor, older, explicit) = match &self.main {
            Some(main) => match main.channel_logs.get(&channel) {
                Some(log) if older => {
                    if let Some(c) = &log.oldest_cursor {
                        (Some(c.clone()), true, log.explicit_cursor)
                    } else {
                        return;
                    }
                }
                _ => (None, false, false),
            },
            None => return,
        };
        self.spawn(async move {
            // Cursor padrão: createdAt da mensagem mais antiga (paginação por
            // data). O servidor também pode devolver nextCursor explícito.
            let result = Api::new()
                .channel_messages(&origin, &token, &channel, cursor.as_deref(), 50)
                .await;
            let _ = tx.send(match result {
                Ok(history) => {
                    let (messages, next_cursor) = history.into_parts();
                    UiEvent::ChannelHistoryOk {
                        channel,
                        messages,
                        next_cursor,
                        older,
                        explicit_cursor: explicit,
                    }
                }
                Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                Err(e) => UiEvent::Err(e.to_string()),
            });
        });
    }

    pub fn send_channel_message(&self, content: &str) {
        let content = content.trim().to_string();
        if content.is_empty() {
            return;
        }
        let Some((origin, token)) = self.origin_token() else { return };
        let Some(channel) = self
            .main
            .as_ref()
            .and_then(|m| m.current_channel.clone())
        else {
            return;
        };
        let tx = self.events_tx.clone();
        self.spawn(async move {
            let result = Api::new()
                .channel_send(&origin, &token, &channel, &content)
                .await;
            let _ = tx.send(match result {
                Ok(_msg) => UiEvent::MessagePosted,
                Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                Err(e) => UiEvent::Err(e.to_string()),
            });
        });
    }

    pub fn open_friend(&mut self, id: &str) {
        if let Some(main) = &mut self.main {
            main.current_friend = Some(id.to_string());
        }
        self.load_dm(id, false);
    }

    pub fn load_dm(&self, peer: &str, older: bool) {
        let tx = self.events_tx.clone();
        let Some((origin, token)) = self.origin_token() else { return };
        let peer = peer.to_string();
        let before = match &self.main {
            Some(main) => match main.dm_logs.get(&peer) {
                Some(log) if older && log.has_more => {
                    log.messages.first().map(|m| m.created_at.clone())
                }
                _ => None,
            },
            None => None,
        };
        if older && before.is_none() {
            return;
        }
        self.spawn(async move {
            let result = Api::new()
                .dm_history(&origin, &token, &peer, before.as_deref())
                .await;
            let _ = tx.send(match result {
                Ok(messages) => UiEvent::DmHistoryOk { peer, messages },
                Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                Err(e) => UiEvent::Err(e.to_string()),
            });
        });
    }

    pub fn send_dm(&self, content: &str) {
        let content = content.trim().to_string();
        if content.is_empty() {
            return;
        }
        let Some((origin, token)) = self.origin_token() else { return };
        let Some(peer) = self
            .main
            .as_ref()
            .and_then(|m| m.current_friend.clone())
        else {
            return;
        };
        let tx = self.events_tx.clone();
        self.spawn(async move {
            let result = Api::new().dm_send(&origin, &token, &peer, &content).await;
            let _ = tx.send(match result {
                Ok(msg) => UiEvent::DmSent(msg),
                Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                Err(e) => UiEvent::Err(e.to_string()),
            });
        });
    }

    // ---- despacho: comunidades / convites ----

    pub fn submit_create_community(&mut self) {
        let name = self.create_community_name.trim().to_string();
        if name.is_empty() {
            return;
        }
        self.show_create_community = false;
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new().create_community(&origin, &token, &name).await;
                let _ = tx.send(match result {
                    Ok(_) => UiEvent::CommunityChanged(String::new()),
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::Err(e.to_string()),
                });
            });
        }
    }

    pub fn submit_create_channel(&mut self) {
        let name = self.create_channel_name.trim().to_string();
        let community_id = match &self.main {
            Some(main) => match &main.view {
                MainView::Community(id) => id.clone(),
                MainView::Dms => return,
            },
            None => return,
        };
        if name.is_empty() {
            return;
        }
        self.show_create_channel = false;
        let kind = if self.create_channel_voice {
            ChannelKind::Voice
        } else {
            ChannelKind::Text
        };
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new()
                    .create_channel(&origin, &token, &community_id, &name, kind)
                    .await;
                let _ = tx.send(match result {
                    Ok(_) => UiEvent::CommunityChanged(community_id),
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::Err(e.to_string()),
                });
            });
        }
    }

    pub fn submit_create_invite(&mut self) {
        let community_id = match &self.main {
            Some(main) => match &main.view {
                MainView::Community(id) => id.clone(),
                MainView::Dms => return,
            },
            None => return,
        };
        self.invite_result = None;
        let expiry = self.invite_expiry;
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new()
                    .create_invite(&origin, &token, &community_id, expiry)
                    .await;
                let _ = tx.send(match result {
                    Ok(invite) => UiEvent::InviteCreated(invite),
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::Err(e.to_string()),
                });
            });
        }
    }

    pub fn submit_preview_invite(&mut self) {
        let code = config::extract_invite_code(&self.join_invite_input);
        if code.is_empty() {
            return;
        }
        self.join_invite_busy = true;
        self.join_invite_preview = None;
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new().preview_invite(&origin, &token, &code).await;
                let _ = tx.send(match result {
                    Ok(preview) => UiEvent::InvitePreviewOk { code, preview },
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::Err(e.to_string()),
                });
            });
        }
    }

    pub fn submit_accept_invite(&mut self) {
        let Some((code, _preview)) = self.join_invite_preview.take() else {
            return;
        };
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new().accept_invite(&origin, &token, &code).await;
                let _ = tx.send(match result {
                    Ok(accepted) => UiEvent::InviteAccepted {
                        community_id: accepted.community_id,
                    },
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::Err(e.to_string()),
                });
            });
        }
    }

    pub fn leave_current_community(&mut self) {
        let community_id = match &self.main {
            Some(main) => match &main.view {
                MainView::Community(id) => id.clone(),
                MainView::Dms => return,
            },
            None => return,
        };
        let tx = self.events_tx.clone();
        if let Some((origin, token)) = self.origin_token() {
            self.spawn(async move {
                let result = Api::new().leave_community(&origin, &token, &community_id).await;
                let _ = tx.send(match result {
                    Ok(()) => UiEvent::CommunityRemoved(community_id),
                    Err(ApiError::Unauthorized) => UiEvent::Unauthorized,
                    Err(e) => UiEvent::Err(e.to_string()),
                });
            });
        }
    }

    // ---- conexão do socket ----

    pub fn connect_socket(&self) {
        let Some((origin, token)) = self.origin_token() else { return };
        let Ok(url) = config::socket_url(&origin) else { return };
        self.socket.connect(url, token);
    }

    // ---- aplicação dos eventos ----

    pub fn apply_ui_event(&mut self, event: UiEvent, ctx: &egui::Context) {
        ctx.request_repaint();
        match event {
            UiEvent::HealthChecked(Ok(())) => {
                self.connect_busy = false;
                let origin = match config::validate_origin(&self.origin_input) {
                    Ok(o) => o,
                    Err(e) => {
                        self.connect_error = e;
                        return;
                    }
                };
                let _ = config::save_origin(&origin);
                self.origin = origin;
                self.screen = Screen::Login;
                self.restore_session();
            }
            UiEvent::HealthChecked(Err(e)) => {
                self.connect_busy = false;
                self.connect_error = format!("Não consegui falar com o servidor: {e}");
            }
            UiEvent::LoginOk { user, token } => {
                self.login_busy = false;
                token_store::store(&token);
                self.token = Some(token);
                self.me = Some(user.clone());
                self.enter_main(user);
            }
            UiEvent::MeOk(user) => {
                self.me = Some(user.clone());
                self.enter_main(user);
            }
            UiEvent::LoginErr(msg) => {
                self.login_busy = false;
                self.login_error = msg;
            }
            UiEvent::Unauthorized => {
                if self.refreshing {
                    // Já tentou refresh e voltou 401: encerra a sessão.
                    self.refreshing = false;
                    self.logout();
                } else if self.token.is_some() {
                    // Uma tentativa de refresh antes de deslogar.
                    self.try_refresh();
                } else {
                    self.logout();
                }
            }
            UiEvent::FriendsOk(list) => {
                if let Some(main) = &mut self.main {
                    main.friends = Some(list);
                    main.friends_dirty = false;
                }
            }
            UiEvent::DmHistoryOk { peer, messages } => {
                if let Some(main) = &mut self.main {
                    let log = main.dm_logs.entry(peer.clone()).or_default();
                    log.loading_older = false;
                    if messages.len() < 50 {
                        log.has_more = false;
                    } else if !log.has_more && log.messages.is_empty() {
                        log.has_more = true;
                    }
                    // Funde sem duplicar; página antiga vai no início.
                    for m in messages {
                        if !log.messages.iter().any(|x| x.id == m.id) {
                            log.messages.push(m);
                        }
                    }
                    log.messages.sort_by(|a, b| a.created_at.cmp(&b.created_at));
                }
            }
            UiEvent::DmSent(msg) => {
                if let Some(main) = &mut self.main {
                    if let Some(log) = main.dm_logs.get_mut(&msg.recipient_id) {
                        if !log.messages.iter().any(|m| m.id == msg.id) {
                            log.messages.push(msg);
                        }
                    }
                }
            }
            UiEvent::DmIncoming(msg) => {
                // O par da conversa é o outro lado: se eu enviei, é o
                // destinatário; senão, o remetente.
                let my_id = self.me.as_ref().map(|u| u.id.as_str()).unwrap_or("");
                let peer = if msg.sender_id == my_id {
                    msg.recipient_id.clone()
                } else {
                    msg.sender_id.clone()
                };
                if let Some(main) = &mut self.main {
                    let log = main.dm_logs.entry(peer).or_default();
                    if !log.messages.iter().any(|m| m.id == msg.id) {
                        log.messages.push(msg);
                    }
                }
            }
            UiEvent::CommunitiesOk(list) => {
                if let Some(main) = &mut self.main {
                    main.communities = list;
                    // Se a comunidade aberta sumiu da lista, volta para DMs.
                    if let MainView::Community(id) = &main.view {
                        if !main.communities.iter().any(|c| &c.id == id) {
                            main.view = MainView::Dms;
                            main.community = None;
                            main.current_channel = None;
                        }
                    }
                }
            }
            UiEvent::CommunityOk(detail) => {
                let id = detail.community.id.clone();
                if let Some(main) = &mut self.main {
                    if matches!(&main.view, MainView::Community(cur) if *cur == id) {
                        main.community = Some(detail);
                    }
                }
            }
            UiEvent::CommunityErr(e) => {
                self.status_message = format!("Comunidade indisponível: {e}");
                if let Some(main) = &mut self.main {
                    if matches!(main.view, MainView::Community(_)) {
                        main.view = MainView::Dms;
                        main.community = None;
                        main.current_channel = None;
                    }
                }
            }
            UiEvent::ChannelHistoryOk {
                channel,
                messages,
                next_cursor,
                older,
                explicit_cursor,
            } => {
                if let Some(main) = &mut self.main {
                    let log = main.channel_logs.entry(channel.clone()).or_default();
                    log.loading_older = false;
                    // Cursor da próxima página antiga (decidido uma vez só).
                    let oldest = match next_cursor {
                        Some(c) => Some(c),
                        None => messages_fallback_oldest(&messages),
                    };
                    if !older {
                        // Primeira carga: substitui o histórico.
                        log.messages = messages;
                        log.explicit_cursor = explicit_cursor;
                        log.oldest_cursor = oldest;
                    } else {
                        // Página antiga: prepend sem duplicar.
                        let mut incoming = messages;
                        incoming.retain(|m| !log.messages.iter().any(|x| x.id == m.id));
                        log.messages.splice(0..0, incoming);
                        log.oldest_cursor = if explicit_cursor {
                            oldest
                        } else {
                            log.messages.first().map(|m| m.created_at.clone())
                        };
                    }
                    log.has_more = log.oldest_cursor.is_some() || log.messages.len() >= 50;
                }
            }
            UiEvent::ChannelMessageNew(msg) => {
                if let Some(main) = &mut self.main {
                    let log = main.channel_logs.entry(msg.channel_id.clone()).or_default();
                    if !log.messages.iter().any(|m| m.id == msg.id) {
                        log.messages.push(msg);
                    }
                }
            }
            UiEvent::ChannelMessageEdited(e) => {
                if let Some(log) = self
                    .main
                    .as_mut()
                    .and_then(|m| m.channel_logs.get_mut(&e.channel_id))
                {
                    if let Some(m) = log.messages.iter_mut().find(|m| m.id == e.message_id) {
                        m.content = e.content;
                        m.edited_at = Some(e.edited_at);
                    }
                }
            }
            UiEvent::ChannelMessageDeleted(e) => {
                if let Some(log) = self
                    .main
                    .as_mut()
                    .and_then(|m| m.channel_logs.get_mut(&e.channel_id))
                {
                    if let Some(m) = log.messages.iter_mut().find(|m| m.id == e.message_id) {
                        m.deleted_at = Some(e.deleted_at);
                    }
                }
            }
            UiEvent::MessagePosted => {}
            UiEvent::CommunityChanged(id) => {
                self.load_communities();
                if !id.is_empty() {
                    self.open_community(&id);
                } else if let Some(main) = &mut self.main {
                    if let MainView::Community(cur) = main.view.clone() {
                        self.open_community(&cur);
                    }
                }
            }
            UiEvent::CommunityDeleted(id) | UiEvent::CommunityRemoved(id) => {
                self.subscribed.remove(&id);
                self.socket.send_event(
                    "community:unsubscribe",
                    &serde_json::json!({ "communityId": id }),
                );
                if let Some(main) = &mut self.main {
                    if matches!(&main.view, MainView::Community(cur) if *cur == id) {
                        main.view = MainView::Dms;
                        main.community = None;
                        main.current_channel = None;
                    }
                }
                self.load_communities();
            }
            UiEvent::VoiceState(vs) => {
                if let Some(main) = &mut self.main {
                    main.voice_states.insert(vs.channel_id, vs.members);
                }
            }
            UiEvent::SubscribeAck(states) => {
                if let Some(main) = &mut self.main {
                    main.voice_states.clear();
                    for vs in states {
                        main.voice_states.insert(vs.channel_id, vs.members);
                    }
                }
            }
            UiEvent::InviteCreated(invite) => {
                self.invite_result = Some(invite);
            }
            UiEvent::InvitePreviewOk { code, preview } => {
                self.join_invite_busy = false;
                self.join_invite_preview = Some((code, preview));
            }
            UiEvent::InviteAccepted { community_id } => {
                self.show_join_invite = false;
                self.join_invite_preview = None;
                self.join_invite_input.clear();
                self.load_communities();
                self.open_community(&community_id);
            }
            UiEvent::SocketConnected => {
                if let Some(main) = &mut self.main {
                    main.socket_connected = true;
                }
                // Re-subscreve tudo (reconexão).
                let ids: Vec<String> = self.subscribed.iter().cloned().collect();
                for id in ids {
                    self.subscribed.remove(&id);
                    self.subscribe_community(&id);
                }
            }
            UiEvent::SocketDisconnected => {
                if let Some(main) = &mut self.main {
                    main.socket_connected = false;
                }
            }
            UiEvent::SessionRefreshed(new_token) => {
                self.refreshing = false;
                match new_token {
                    Some(new_token) => {
                        token_store::store(&new_token);
                        self.token = Some(new_token);
                        self.restore_session();
                    }
                    None => self.logout(),
                }
            }
            UiEvent::Err(e) => {
                self.status_message = e;
            }
        }
    }

    fn enter_main(&mut self, _user: User) {
        self.screen = Screen::Principal;
        self.main = Some(MainState::new());
        self.connect_socket();
        self.load_communities();
        self.load_friends();
    }

    /// Converte eventos crus do socket em `UiEvent`.
    pub fn apply_socket_event(&mut self, event: SocketEvent, ctx: &egui::Context) {
        ctx.request_repaint();
        match event {
            SocketEvent::Connected => self.apply_ui_event(UiEvent::SocketConnected, ctx),
            SocketEvent::ConexaoPerdida => {
                self.apply_ui_event(UiEvent::SocketDisconnected, ctx)
            }
            SocketEvent::Packet(Packet::Event { event, payload, .. }) => {
                use crate::api::types as t;
                let ui = match event.as_str() {
                    "dm:message" => serde_json::from_value::<t::DmMessageEvent>(payload)
                        .map(|e| UiEvent::DmIncoming(e.into_message()))
                        .ok(),
                    "channel:message" => {
                        serde_json::from_value::<t::ChannelMessageEvent>(payload)
                            .map(|e| UiEvent::ChannelMessageNew(e.into_message()))
                            .ok()
                    }
                    "channel:message-edit" => {
                        serde_json::from_value::<t::ChannelMessageEditEvent>(payload)
                            .map(UiEvent::ChannelMessageEdited)
                            .ok()
                    }
                    "channel:message-delete" => {
                        serde_json::from_value::<t::ChannelMessageDeleteEvent>(payload)
                            .map(UiEvent::ChannelMessageDeleted)
                            .ok()
                    }
                    "community:voice-state" => serde_json::from_value::<t::VoiceState>(payload)
                        .map(UiEvent::VoiceState)
                        .ok(),
                    "community:changed" => payload
                        .get("communityId")
                        .and_then(|v| v.as_str())
                        .map(|id| UiEvent::CommunityChanged(id.to_string())),
                    "community:deleted" | "community:removed" => payload
                        .get("communityId")
                        .and_then(|v| v.as_str())
                        .map(|id| UiEvent::CommunityDeleted(id.to_string())),
                    "friends:changed" => {
                        if let Some(main) = &mut self.main {
                            main.friends_dirty = true;
                        }
                        None
                    }
                    _ => None,
                };
                if let Some(ui_event) = ui {
                    self.apply_ui_event(ui_event, ctx);
                }
            }
            SocketEvent::Packet(_) => {}
        }
    }
}

/// Cursor padrão de paginação: createdAt da mensagem mais antiga da página.
fn messages_fallback_oldest(messages: &[ChannelMessage]) -> Option<String> {
    messages.first().map(|m| m.created_at.clone())
}
