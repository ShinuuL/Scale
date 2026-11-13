//! Renderização da UI (layout de 4 colunas, diálogos, telas de conexão/login).
//!
//! Tudo é `&mut self` + `egui::Ui`; nenhum código de rede roda aqui — as
//! ações apenas disparam as tarefas via [`ScaleApp`]. Os ícones são pintados
//! com `egui::Painter` dentro do retângulo do próprio botão (sem fonte de
//! ícones).

use egui::{
    Align, Button, Color32, ComboBox, Context, CornerRadius, Layout, RichText, ScrollArea,
    Sense, Stroke, TextEdit, Vec2, vec2,
};

use crate::api::types::{ChannelKind, CommunityRole, ExpiresIn};
use crate::app::ScaleApp;
use crate::icons;
use crate::state::{MainView, Screen};
use crate::theme::colors;
use crate::util;

/// Botão quadrado com ícone pintado (Painter) dentro do próprio retângulo.
fn icon_button(
    ui: &mut egui::Ui,
    size: f32,
    selected: bool,
    radius: u8,
    icon_color: Color32,
    tooltip: &str,
    draw: impl Fn(&egui::Painter, egui::Rect, Color32),
) -> egui::Response {
    let fill = if selected { colors::ACCENT_SOLID } else { colors::BG_TERTIARY };
    let response = ui.add(
        Button::new(RichText::new(" ").size(1.0))
            .min_size(Vec2::splat(size))
            .corner_radius(CornerRadius::same(radius))
            .fill(fill)
            .stroke(Stroke::new(0.0, Color32::TRANSPARENT)),
    );
    let color = if selected { Color32::WHITE } else { icon_color };
    draw(ui.painter(), response.rect.shrink(size * 0.26), color);
    response.on_hover_text(tooltip)
}

/// Quadrado de comunidade com as iniciais do nome pintadas no centro.
fn community_tile(
    ui: &mut egui::Ui,
    name: &str,
    selected: bool,
) -> egui::Response {
    let response = icon_button(ui, 52.0, selected, 16, colors::TEXT_PRIMARY, name, |_, _, _| {});
    let initials = util::initials(name);
    ui.painter().text(
        response.rect.center(),
        egui::Align2::CENTER_CENTER,
        initials,
        egui::FontId::proportional(16.0),
        if selected { Color32::WHITE } else { colors::TEXT_PRIMARY },
    );
    response
}

/// Linha de mensagem: autor + hora (+ editada) + conteúdo.
fn chat_row(ui: &mut egui::Ui, author: &str, mine: bool, time: &str, content: &str, deleted: bool) {
    ui.add_space(4.0);
    ui.horizontal_wrapped(|ui| {
        ui.spacing_mut().item_spacing.x = 6.0;
        ui.label(
            RichText::new(author)
                .strong()
                .color(if mine { colors::ACCENT } else { colors::TEXT_PRIMARY }),
        );
        ui.label(RichText::new(time).small().color(colors::TEXT_MUTED));
    });
    let text = if deleted {
        RichText::new(content).italics().color(colors::TEXT_MUTED)
    } else {
        RichText::new(content).color(colors::TEXT_SECONDARY)
    };
    ui.label(text);
}

/// Separação visual quando o dia da mensagem muda.
fn day_separator(ui: &mut egui::Ui, day: &str) {
    ui.with_layout(Layout::top_down(Align::Center), |ui| {
        ui.add_space(6.0);
        ui.label(RichText::new(day).small().color(colors::TEXT_MUTED));
        ui.add_space(2.0);
    });
}

impl ScaleApp {
    // ---- tela: conectar ao servidor ----

    /// Faixa fina no topo com o estado da atualização automática.
    pub fn render_update_banner(&mut self, ui: &mut egui::Ui) {
        use crate::state::UpdateState;
        use std::time::Instant;

        // Prazo vencido: instala (o processo encerra se der certo).
        if let UpdateState::Pronta { update, deadline } = &self.update {
            if Instant::now() >= *deadline {
                let update = update.clone();
                self.install_update(&update);
            }
        }

        enum Action {
            Nada,
            Agora,
            Adiar,
            Fechar,
            Pagina(String),
        }
        let mut action = Action::Nada;
        let (text, show) = match &self.update {
            UpdateState::Nenhuma => (String::new(), false),
            UpdateState::Baixando(v) => (format!("Baixando a versão {v} do Scale..."), true),
            UpdateState::Pronta { update, deadline } => {
                let left = deadline.saturating_duration_since(Instant::now()).as_secs();
                let msg = if left <= crate::app::RESTART_DELAY.as_secs() {
                    format!("Versão {} pronta. O Scale reinicia em {left} s para atualizar.", update.version)
                } else {
                    format!("Versão {} pronta para instalar.", update.version)
                };
                (msg, true)
            }
            UpdateState::Manual(info) => (
                format!("Nova versão do Scale disponível: {} (você usa {}).", info.version, crate::updater::CURRENT_VERSION),
                true,
            ),
            UpdateState::Falhou(err) => (format!("Não foi possível atualizar: {err}"), true),
        };
        if !show {
            return;
        }

        egui::Panel::top("atualizacao")
            .resizable(false)
            .frame(
                egui::Frame::NONE
                    .fill(colors::ACCENT_SUBTLE)
                    .inner_margin(egui::Margin::symmetric(16, 6)),
            )
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.label(egui::RichText::new(&text).color(colors::TEXT_PRIMARY));
                    ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| match &self.update {
                        UpdateState::Pronta { .. } => {
                            if ui.button("Adiar").clicked() {
                                action = Action::Adiar;
                            }
                            if ui.button(egui::RichText::new("Reiniciar agora").color(colors::ACCENT)).clicked() {
                                action = Action::Agora;
                            }
                        }
                        UpdateState::Manual(info) => {
                            if ui.button("Depois").clicked() {
                                action = Action::Fechar;
                            }
                            if ui.button(egui::RichText::new("Baixar atualização").color(colors::ACCENT)).clicked() {
                                action = Action::Pagina(info.page_url.clone());
                            }
                        }
                        UpdateState::Falhou(_) if ui.button("Fechar").clicked() => {
                            action = Action::Fechar;
                        }
                        _ => {}
                    });
                });
            });

        match action {
            Action::Nada => {}
            Action::Agora => {
                if let UpdateState::Pronta { update, .. } = &self.update {
                    let update = update.clone();
                    self.install_update(&update);
                }
            }
            Action::Adiar => {
                if let UpdateState::Pronta { deadline, .. } = &mut self.update {
                    *deadline = Instant::now() + crate::app::POSTPONE;
                }
            }
            Action::Fechar => self.update = UpdateState::Nenhuma,
            Action::Pagina(url) => ui.ctx().open_url(egui::OpenUrl::new_tab(url)),
        }
    }

    pub fn render_connect(&mut self, ui: &mut egui::Ui) {
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(colors::BG_BASE))
            .show(ui, |ui| {
                ui.with_layout(Layout::top_down(Align::Center), |ui| {
                    ui.add_space(ui.available_height() * 0.20);
                    ui.label(
                        RichText::new("Scale").size(34.0).strong().color(colors::TEXT_PRIMARY),
                    );
                    ui.add_space(8.0);
                    ui.label(
                        RichText::new("Conectar ao servidor")
                            .size(18.0)
                            .color(colors::TEXT_SECONDARY),
                    );
                    ui.add_space(24.0);

                    let width = 380.0;
                    ui.allocate_ui_with_layout(
                        vec2(width, 0.0),
                        Layout::top_down(Align::LEFT),
                        |ui| {
                            ui.label(RichText::new("Endereço do servidor").color(colors::TEXT_MUTED));
                            ui.add(
                                TextEdit::singleline(&mut self.origin_input)
                                    .desired_width(f32::INFINITY)
                                    .hint_text("https://scale.example.com"),
                            );
                            ui.add_space(12.0);

                            if !self.connect_error.is_empty() {
                                ui.label(RichText::new(&self.connect_error).color(colors::ACCENT));
                                ui.add_space(8.0);
                            }

                            let label = if self.connect_busy { "Testando..." } else { "Conectar" };
                            let button =
                                Button::new(RichText::new(label).color(Color32::WHITE))
                                    .fill(colors::ACCENT_SOLID)
                                    .min_size(vec2(width, 40.0))
                                    .corner_radius(CornerRadius::same(6));
                            let clicked = ui.add(button).clicked();
                            let enter = ui.input(|i| i.key_pressed(egui::Key::Enter));
                            if (clicked || enter) && !self.connect_busy {
                                self.check_health();
                            }
                            ui.add_space(12.0);
                            ui.label(
                                RichText::new(
                                    "Só https é aceito. http entra apenas para localhost ou 127.0.0.1.",
                                )
                                .small()
                                .color(colors::TEXT_MUTED),
                            );
                        },
                    );
                });
            });
    }

    // ---- tela: login ----

    pub fn render_login(&mut self, ui: &mut egui::Ui) {
        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(colors::BG_BASE))
            .show(ui, |ui| {
                ui.with_layout(Layout::top_down(Align::Center), |ui| {
                    ui.add_space(ui.available_height() * 0.20);
                    ui.label(
                        RichText::new("Scale").size(34.0).strong().color(colors::TEXT_PRIMARY),
                    );
                    ui.add_space(8.0);
                    ui.label(
                        RichText::new(format!("Entrar em {}", self.origin))
                            .size(15.0)
                            .color(colors::TEXT_MUTED),
                    );
                    ui.add_space(24.0);

                    let width = 380.0;
                    ui.allocate_ui_with_layout(
                        vec2(width, 0.0),
                        Layout::top_down(Align::LEFT),
                        |ui| {
                            ui.label(RichText::new("E-mail ou @nome").color(colors::TEXT_MUTED));
                            ui.add(
                                TextEdit::singleline(&mut self.email)
                                    .desired_width(f32::INFINITY)
                                    .hint_text("voce@exemplo.com"),
                            );
                            ui.add_space(12.0);
                            ui.label(RichText::new("Senha").color(colors::TEXT_MUTED));
                            ui.add(
                                TextEdit::singleline(&mut self.password)
                                    .password(true)
                                    .desired_width(f32::INFINITY),
                            );
                            ui.add_space(12.0);

                            if !self.login_error.is_empty() {
                                ui.label(RichText::new(&self.login_error).color(colors::ACCENT));
                                ui.add_space(8.0);
                            }

                            let label = if self.login_busy { "Entrando..." } else { "Entrar" };
                            let button = Button::new(RichText::new(label).color(Color32::WHITE))
                                .fill(colors::ACCENT_SOLID)
                                .min_size(vec2(width, 40.0))
                                .corner_radius(CornerRadius::same(6));
                            let clicked = ui.add(button).clicked();
                            let enter = ui.input(|i| i.key_pressed(egui::Key::Enter));
                            if (clicked || enter) && !self.login_busy {
                                self.do_login();
                            }
                            ui.add_space(12.0);
                            if ui
                                .add(Button::new(
                                    RichText::new("Trocar de servidor").color(colors::TEXT_SECONDARY),
                                ))
                                .clicked()
                            {
                                self.screen = Screen::Conectar;
                            }
                        },
                    );
                });
            });
    }

    // ---- tela principal (4 colunas) ----

    pub fn render_main(&mut self, ui: &mut egui::Ui, ctx: &Context) {
        egui::Panel::left("trilho")
            .resizable(false)
            .exact_size(76.0)
            .frame(egui::Frame::NONE.fill(colors::BG_SECONDARY))
            .show(ui, |ui| self.render_rail(ui));

        let view = self
            .main
            .as_ref()
            .map(|m| m.view.clone())
            .unwrap_or(MainView::Dms);

        match view {
            MainView::Dms => {
                egui::Panel::left("lista")
                    .resizable(false)
                    .exact_size(248.0)
                    .frame(egui::Frame::NONE.fill(colors::BG_SECONDARY))
                    .show(ui, |ui| self.render_dm_column(ui));
            }
            MainView::Community(_) => {
                egui::Panel::left("canais")
                    .resizable(false)
                    .exact_size(248.0)
                    .frame(egui::Frame::NONE.fill(colors::BG_SECONDARY))
                    .show(ui, |ui| self.render_channel_column(ui));
            }
        }

        if matches!(view, MainView::Community(_)) {
            egui::Panel::right("membros")
                .resizable(false)
                .exact_size(232.0)
                .frame(egui::Frame::NONE.fill(colors::BG_SECONDARY))
                .show(ui, |ui| self.render_members(ui));
        }

        egui::CentralPanel::default()
            .frame(egui::Frame::NONE.fill(colors::BG_BASE))
            .show(ui, |ui| self.render_chat(ui));

        self.render_dialogs(ctx);
    }

    /// Trilho estreito: DMs no topo, comunidades como quadrados, + e entrar.
    fn render_rail(&mut self, ui: &mut egui::Ui) {
        enum RailAction {
            OpenDms,
            OpenCommunity(String),
            CreateCommunity,
            JoinInvite,
        }
        let mut action: Option<RailAction> = None;

        let (view_is_dms, communities, socket_connected) = match &self.main {
            Some(main) => (
                matches!(main.view, MainView::Dms),
                main.communities.clone(),
                main.socket_connected,
            ),
            None => (true, Vec::new(), false),
        };
        let current_community = match &self.main {
            Some(main) => match &main.view {
                MainView::Community(id) => Some(id.clone()),
                MainView::Dms => None,
            },
            None => None,
        };

        ui.with_layout(Layout::top_down(Align::Center), |ui| {
            ui.add_space(10.0);

            let response = icon_button(ui, 52.0, view_is_dms, 16, colors::TEXT_SECONDARY, "Mensagens diretas", |p, r, c| {
                icons::messages(p, r, c)
            });
            if response.clicked() {
                action = Some(RailAction::OpenDms);
            }

            ui.add_space(6.0);
            ui.separator();
            ui.add_space(6.0);

            for community in &communities {
                let selected = current_community.as_deref() == Some(community.id.as_str());
                if community_tile(ui, &community.name, selected).clicked() {
                    action = Some(RailAction::OpenCommunity(community.id.clone()));
                }
            }

            ui.add_space(4.0);
            let response = icon_button(ui, 52.0, false, 16, colors::ONLINE, "Criar comunidade", |p, r, c| {
                icons::plus(p, r, c)
            });
            if response.clicked() {
                action = Some(RailAction::CreateCommunity);
            }

            let response = icon_button(ui, 52.0, false, 16, colors::TEXT_SECONDARY, "Entrar em uma comunidade por convite", |p, r, c| {
                icons::door_enter(p, r, c)
            });
            if response.clicked() {
                action = Some(RailAction::JoinInvite);
            }

            // Indicador de conexão do socket no rodapé.
            ui.with_layout(Layout::bottom_up(Align::Center), |ui| {
                ui.add_space(12.0);
                let (fill, tooltip) = if socket_connected {
                    (colors::ONLINE, "Conectado em tempo real")
                } else {
                    (colors::TEXT_MUTED, "Sem conexão em tempo real (reconectando)")
                };
                let (rect, response) = ui.allocate_exact_size(Vec2::splat(12.0), Sense::hover());
                ui.painter().circle_filled(rect.center(), 5.0, fill);
                ui.painter()
                    .circle_stroke(rect.center(), 5.0, Stroke::new(1.0, colors::BORDER));
                response.on_hover_text(tooltip);
            });
        });

        match action {
            Some(RailAction::OpenDms) => {
                if let Some(main) = &mut self.main {
                    main.view = MainView::Dms;
                    main.current_channel = None;
                }
            }
            Some(RailAction::OpenCommunity(id)) => self.open_community(&id),
            Some(RailAction::CreateCommunity) => {
                self.show_create_community = true;
                self.create_community_name.clear();
            }
            Some(RailAction::JoinInvite) => {
                self.show_join_invite = true;
                self.join_invite_input.clear();
                self.join_invite_preview = None;
            }
            None => {}
        }
    }

    /// Coluna da esquerda no modo DMs: lista de amigos.
    fn render_dm_column(&mut self, ui: &mut egui::Ui) {
        let mut open_friend: Option<String> = None;
        ui.add_space(12.0);
        ui.label(
            RichText::new("Mensagens diretas")
                .size(13.0)
                .strong()
                .color(colors::TEXT_MUTED),
        );
        if let Some(main) = &self.main {
            if let Some(friends) = &main.friends {
                let pending = friends.incoming.len();
                if pending > 0 {
                    ui.label(
                        RichText::new(format!("{pending} pedido(s) de amizade na web"))
                            .small()
                            .color(colors::TEXT_MUTED),
                    );
                }
            }
        }
        ui.add_space(8.0);

        let friends = self
            .main
            .as_ref()
            .and_then(|m| m.friends.as_ref().map(|f| f.friends.clone()))
            .unwrap_or_default();
        let current = self
            .main
            .as_ref()
            .and_then(|m| m.current_friend.clone());

        ScrollArea::vertical()
            .id_salt("dm_lista_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                if friends.is_empty() {
                    ui.label(
                        RichText::new("Sem amigos ainda. Adicione pelo @nome na web.")
                            .color(colors::TEXT_MUTED),
                    );
                }
                for friend in &friends {
                    let selected = current.as_deref() == Some(friend.id.as_str());
                    let label = match &friend.username {
                        Some(u) => format!("{}  @{}", friend.name, u),
                        None => friend.name.clone(),
                    };
                    let button = Button::new(
                        RichText::new(label)
                            .color(if selected { Color32::WHITE } else { colors::TEXT_SECONDARY }),
                    )
                    .fill(if selected { colors::BG_HOVER } else { Color32::TRANSPARENT })
                    .min_size(vec2(ui.available_width(), 34.0))
                    .corner_radius(CornerRadius::same(6));
                    if ui.add(button).clicked() {
                        open_friend = Some(friend.id.clone());
                    }
                }
            });

        if let Some(id) = open_friend {
            self.open_friend(&id);
        }
        self.render_user_footer(ui);
    }

    /// Coluna da esquerda no modo comunidade: canais + rodapé do usuário.
    fn render_channel_column(&mut self, ui: &mut egui::Ui) {
        enum ColAction {
            OpenChannel(String),
            CreateChannel,
            Leave,
            Invite,
        }
        let mut action: Option<ColAction> = None;

        let Some(community) = self
            .main
            .as_ref()
            .and_then(|m| m.community.clone())
        else {
            ui.add_space(12.0);
            ui.label(RichText::new("Carregando comunidade...").color(colors::TEXT_MUTED));
            self.render_user_footer(ui);
            return;
        };

        let can_manage = self.main.as_ref().is_some_and(|m| m.can_manage());

        ui.add_space(12.0);
        ui.horizontal(|ui| {
            ui.label(
                RichText::new(&community.community.name)
                    .size(15.0)
                    .strong()
                    .color(colors::TEXT_PRIMARY),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if community.my_role != CommunityRole::Owner
                    && ui
                        .add(Button::new(RichText::new("Sair").color(colors::TEXT_MUTED)))
                        .on_hover_text("Sair da comunidade")
                        .clicked()
                {
                    action = Some(ColAction::Leave);
                }
                if ui
                    .add(Button::new(RichText::new("Convite").color(colors::TEXT_SECONDARY)))
                    .on_hover_text("Criar convite de entrada")
                    .clicked()
                {
                    action = Some(ColAction::Invite);
                }
                if can_manage
                    && ui
                    .add(Button::new(RichText::new("+ Canal").color(colors::TEXT_SECONDARY)))
                    .on_hover_text("Criar canal (admin)")
                    .clicked()
                {
                    action = Some(ColAction::CreateChannel);
                }
            });
        });
        ui.add_space(4.0);

        let mut channels = community.channels.clone();
        channels.sort_by_key(|c| c.position);
        let current_channel = self
            .main
            .as_ref()
            .and_then(|m| m.current_channel.clone());
        let voice_states = self
            .main
            .as_ref()
            .map(|m| m.voice_states.clone())
            .unwrap_or_default();

        ScrollArea::vertical()
            .id_salt("canais_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for channel in &channels {
                    match channel.kind {
                        ChannelKind::Text => {
                            let selected =
                                current_channel.as_deref() == Some(channel.id.as_str());
                            let (rect, response) = ui.allocate_exact_size(
                                vec2(ui.available_width(), 30.0),
                                Sense::click(),
                            );
                            if selected {
                                ui.painter()
                                    .rect_filled(rect, CornerRadius::same(6), colors::BG_HOVER);
                            }
                            let painter = ui.painter_at(rect);
                            icons::hash(
                                &painter,
                                egui::Rect::from_min_size(
                                    rect.min + vec2(8.0, 6.0),
                                    Vec2::splat(18.0),
                                ),
                                colors::TEXT_MUTED,
                            );
                            painter.text(
                                rect.min + vec2(32.0, rect.height() / 2.0),
                                egui::Align2::LEFT_CENTER,
                                &channel.name,
                                egui::FontId::proportional(14.0),
                                if selected { Color32::WHITE } else { colors::TEXT_SECONDARY },
                            );
                            let response = response.on_hover_text(&channel.name);
                            if response.clicked() {
                                action = Some(ColAction::OpenChannel(channel.id.clone()));
                            }                        }
                        ChannelKind::Voice => {
                            let (rect, response) =
                                ui.allocate_exact_size(vec2(ui.available_width(), 30.0), Sense::hover());
                            let painter = ui.painter_at(rect);
                            icons::speaker(
                                &painter,
                                egui::Rect::from_min_size(
                                    rect.min + vec2(8.0, 6.0),
                                    Vec2::splat(18.0),
                                ),
                                colors::TEXT_MUTED,
                            );
                            painter.text(
                                rect.min + vec2(32.0, rect.height() / 2.0),
                                egui::Align2::LEFT_CENTER,
                                &channel.name,
                                egui::FontId::proportional(14.0),
                                colors::TEXT_MUTED,
                            );
                            response.on_hover_text("Voz chega na próxima versão");
                            if let Some(members) = voice_states.get(&channel.id) {
                                for member in members {
                                    ui.horizontal(|ui| {
                                        ui.add_space(30.0);
                                        ui.colored_label(colors::ONLINE, "•");
                                        ui.label(
                                            RichText::new(&member.name)
                                                .small()
                                                .color(colors::TEXT_MUTED),
                                        );
                                    });
                                }
                            }
                        }
                    }
                }
            });

        match action {
            Some(ColAction::OpenChannel(id)) => self.open_channel(&id),
            Some(ColAction::CreateChannel) => {
                self.show_create_channel = true;
                self.create_channel_name.clear();
                self.create_channel_voice = false;
            }
            Some(ColAction::Leave) => self.leave_current_community(),
            Some(ColAction::Invite) => {
                self.show_invite = true;
                self.invite_result = None;
            }
            None => {}
        }

        self.render_user_footer(ui);
    }

    /// Rodapé das colunas da esquerda: usuário + sair.
    fn render_user_footer(&mut self, ui: &mut egui::Ui) {
        let mut logout_clicked = false;
        ui.with_layout(Layout::bottom_up(Align::Center), |ui| {
            ui.add_space(8.0);
            ui.horizontal(|ui| {
                ui.colored_label(colors::ONLINE, "●");
                let name = self.me.as_ref().map(|u| u.name.as_str()).unwrap_or("");
                ui.label(RichText::new(name).color(colors::TEXT_PRIMARY));
                ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                    let response = icon_button(ui, 30.0, false, 6, colors::TEXT_MUTED, "Sair da conta", |p, r, c| {
                        icons::logout(p, r, c)
                    });
                    if response.clicked() {
                        logout_clicked = true;
                    }
                });
            });
            ui.add_space(4.0);
        });
        if logout_clicked {
            self.logout();
        }
    }

    /// Coluna da direita: membros por cargo.
    fn render_members(&mut self, ui: &mut egui::Ui) {
        let Some(main) = &self.main else { return };
        let Some(community) = &main.community else { return };
        ui.add_space(12.0);
        ui.label(
            RichText::new(format!("Membros — {}", community.members.len()))
                .size(13.0)
                .strong()
                .color(colors::TEXT_MUTED),
        );
        ui.add_space(8.0);

        ScrollArea::vertical()
            .id_salt("membros_scroll")
            .auto_shrink([false, false])
            .show(ui, |ui| {
                for role in
                    [CommunityRole::Owner, CommunityRole::Admin, CommunityRole::Member]
                {
                    let members: Vec<_> =
                        community.members.iter().filter(|m| m.role == role).collect();
                    if members.is_empty() {
                        continue;
                    }
                    ui.label(
                        RichText::new(format!("{} — {}", role.label(), members.len()))
                            .small()
                            .color(colors::TEXT_MUTED),
                    );
                    ui.add_space(2.0);
                    for member in members {
                        ui.horizontal(|ui| {
                            ui.colored_label(colors::ONLINE, "●");
                            let label = match &member.username {
                                Some(u) => format!("{}  @{}", member.name, u),
                                None => member.name.clone(),
                            };
                            ui.label(RichText::new(label).color(colors::TEXT_SECONDARY));
                        });
                    }
                    ui.add_space(10.0);
                }
            });
    }

    // ---- chat central (canal de texto ou DM) ----

    fn render_chat(&mut self, ui: &mut egui::Ui) {
        let context_key = match &self.main {
            Some(main) => match &main.view {
                MainView::Dms => main
                    .current_friend
                    .as_ref()
                    .map(|id| format!("dm:{id}"))
                    .unwrap_or_default(),
                MainView::Community(_) => main
                    .current_channel
                    .as_ref()
                    .map(|id| format!("ch:{id}"))
                    .unwrap_or_default(),
            },
            None => String::new(),
        };

        // Troca de contexto limpa o composer.
        if self.composer_for != context_key {
            self.composer_for = context_key.clone();
            self.composer.clear();
        }

        let title = match &self.main {
            Some(main) => match &main.view {
                MainView::Dms => match &main.current_friend {
                    Some(id) => main
                        .friends
                        .as_ref()
                        .and_then(|f| f.friends.iter().find(|x| &x.id == id))
                        .map(|u| u.name.clone())
                        .unwrap_or_else(|| "Conversa".to_string()),
                    None => "Selecione uma conversa".to_string(),
                },
                MainView::Community(_) => main
                    .current_channel
                    .as_ref()
                    .and_then(|id| {
                        main.community
                            .as_ref()
                            .and_then(|c| c.channels.iter().find(|ch| &ch.id == id))
                            .map(|ch| format!("# {}", ch.name))
                    })
                    .unwrap_or_else(|| "Selecione um canal".to_string()),
            },
            None => String::new(),
        };

        // Cabeçalho
        ui.add_space(10.0);
        ui.horizontal(|ui| {
            ui.label(
                RichText::new(title).size(15.0).strong().color(colors::TEXT_PRIMARY),
            );
            ui.with_layout(Layout::right_to_left(Align::Center), |ui| {
                if !self.status_message.is_empty() {
                    ui.label(
                        RichText::new(&self.status_message).small().color(colors::ACCENT),
                    );
                }
                if !self.socket_connected() {
                    ui.label(
                        RichText::new("reconectando...")
                            .small()
                            .color(colors::TEXT_MUTED),
                    );
                }
            });
        });
        ui.separator();

        if context_key.is_empty() {
            ui.centered_and_justified(|ui| {
                ui.label(
                    RichText::new("Escolha um canal ao lado para começar a conversar.")
                        .color(colors::TEXT_MUTED),
                );
            });
            return;
        }

        let my_id = self.me.as_ref().map(|u| u.id.clone()).unwrap_or_default();
        let view = self.main.as_ref().map(|m| m.view.clone());

        // Estado de scroll antes de renderizar (para decidir "carregar mais").
        let (has_more, loading, last_offset, seen_frame) = match (&self.main, &view) {
            (Some(main), Some(MainView::Dms)) => match &main.current_friend {
                Some(peer) => match main.dm_logs.get(peer) {
                    Some(log) => (log.has_more, log.loading_older, log.last_offset, log.seen_frame),
                    None => (true, false, f32::MAX, false),
                },
                None => (false, false, 0.0, true),
            },
            (Some(main), Some(MainView::Community(_))) => match &main.current_channel {
                Some(channel) => match main.channel_logs.get(channel) {
                    Some(log) => (log.has_more, log.loading_older, log.last_offset, log.seen_frame),
                    None => (true, false, f32::MAX, false),
                },
                None => (false, false, 0.0, true),
            },
            _ => (false, false, 0.0, true),
        };

        let output = ScrollArea::vertical()
            .id_salt(format!("chat_{context_key}"))
            .auto_shrink([false, false])
            .stick_to_bottom(true)
            .show(ui, |ui| {
                let Some(main) = &mut self.main else { return };
                match view.as_ref() {
                    Some(MainView::Dms) => {
                        let Some(peer) = main.current_friend.clone() else { return };
                        let friends = main.friends.clone();
                        let log = main.dm_logs.entry(peer).or_default();
                        let mut last_day = String::new();
                        for msg in &log.messages {
                            let day = msg.created_at.get(0..10).unwrap_or("").to_string();
                            if day != last_day {
                                last_day = day.clone();
                                day_separator(ui, &day);
                            }
                            let mine = msg.sender_id == my_id;
                            let sender_name = if mine {
                                "Você".to_string()
                            } else {
                                friends
                                    .as_ref()
                                    .and_then(|f| {
                                        f.friends.iter().find(|x| x.id == msg.sender_id)
                                    })
                                    .map(|u| u.name.clone())
                                    .unwrap_or_else(|| "Desconhecido".to_string())
                            };
                            chat_row(
                                ui,
                                &sender_name,
                                mine,
                                &util::fmt_message_time(&msg.created_at),
                                &msg.content,
                                false,
                            );
                        }
                    }
                    Some(MainView::Community(_)) => {
                        let Some(channel) = main.current_channel.clone() else { return };
                        let log = main.channel_logs.entry(channel).or_default();
                        let mut last_day = String::new();
                        for msg in &log.messages {
                            if msg.deleted_at.is_some() {
                                chat_row(
                                    ui,
                                    &msg.author.name,
                                    msg.author.id == my_id,
                                    &util::fmt_message_time(&msg.created_at),
                                    "mensagem apagada",
                                    true,
                                );
                                continue;
                            }
                            let day = msg.created_at.get(0..10).unwrap_or("").to_string();
                            if day != last_day {
                                last_day = day.clone();
                                day_separator(ui, &day);
                            }
                            let edited = if msg.edited_at.is_some() { " (editada)" } else { "" };
                            let time = format!(
                                "{}{edited}",
                                util::fmt_message_time(&msg.created_at)
                            );
                            chat_row(
                                ui,
                                &msg.author.name,
                                msg.author.id == my_id,
                                &time,
                                &msg.content,
                                false,
                            );
                        }
                    }
                    None => {}
                }
            });

        // Decisão de paginação: no topo E houve scroll para cima (ou primeira
        // renderização). Após carregar, o stick_to_bottom afasta o offset.
        let offset = output.state.clamped_offset().y;
        let scrolled_up = offset < last_offset - 2.0 || !seen_frame;
        let load_older = has_more && !loading && scrolled_up && offset < 24.0;

        if let Some(main) = &mut self.main {
            match view.as_ref() {
                Some(MainView::Dms) => {
                    if let Some(log) = main
                        .current_friend
                        .clone()
                        .and_then(|p| main.dm_logs.get_mut(&p))
                    {
                        log.seen_frame = true;
                        log.last_offset = offset;
                    }
                }
                Some(MainView::Community(_)) => {
                    if let Some(log) = main
                        .current_channel
                        .clone()
                        .and_then(|c| main.channel_logs.get_mut(&c))
                    {
                        log.seen_frame = true;
                        log.last_offset = offset;
                    }
                }
                None => {}
            }
        }

        if load_older {
            match view.as_ref() {
                Some(MainView::Dms) => {
                    if let Some(peer) = &self.main.as_ref().and_then(|m| m.current_friend.clone())
                    {
                        if let Some(main) = &mut self.main {
                            if let Some(log) = main.dm_logs.get_mut(peer) {
                                log.loading_older = true;
                            }
                        }
                        self.load_dm(peer, true);
                    }
                }
                Some(MainView::Community(_)) => {
                    if let Some(channel) =
                        &self.main.as_ref().and_then(|m| m.current_channel.clone())
                    {
                        if let Some(main) = &mut self.main {
                            if let Some(log) = main.channel_logs.get_mut(channel) {
                                log.loading_older = true;
                            }
                        }
                        self.load_channel_history(channel, true);
                    }
                }
                None => {}
            }
        }

        // Composer
        ui.add_space(6.0);
        let mut send_now = false;
        ui.horizontal(|ui| {
            let edit = TextEdit::singleline(&mut self.composer)
                .desired_width(f32::INFINITY)
                .hint_text("Enviar mensagem");
            let response = ui.add(edit);
            if response.has_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                send_now = true;
            }
            let response = icon_button(ui, 34.0, false, 6, colors::ACCENT, "Enviar", |p, r, c| {
                icons::send(p, r, c)
            });
            if response.clicked() {
                send_now = true;
            }
        });
        if send_now {
            self.submit_composer();
        }
    }

    fn socket_connected(&self) -> bool {
        self.main.as_ref().map(|m| m.socket_connected).unwrap_or(false)
    }

    fn submit_composer(&mut self) {
        let content = self.composer.trim().to_string();
        if content.is_empty() {
            return;
        }
        let is_dm = matches!(
            self.main.as_ref().map(|m| &m.view),
            Some(MainView::Dms)
        );
        if is_dm {
            self.send_dm(&content);
        } else {
            self.send_channel_message(&content);
        }
        self.composer.clear();
    }

    // ---- diálogos ----

    fn render_dialogs(&mut self, ctx: &Context) {
        // Criar comunidade
        let mut open = self.show_create_community;
        egui::Window::new("Criar comunidade")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, vec2(0.0, 0.0))
            .show(ctx, |ui| {
                ui.add_space(6.0);
                ui.label(RichText::new("Nome da comunidade").color(colors::TEXT_MUTED));
                let response = ui.add(
                    TextEdit::singleline(&mut self.create_community_name)
                        .desired_width(300.0)
                        .hint_text("Ex.: Equipe de vendas"),
                );
                ui.add_space(12.0);
                let mut submit = false;
                ui.horizontal(|ui| {
                    if ui
                        .add(
                            Button::new(RichText::new("Criar").color(Color32::WHITE))
                                .fill(colors::ACCENT_SOLID)
                                .corner_radius(CornerRadius::same(6)),
                        )
                        .clicked()
                    {
                        submit = true;
                    }
                    if ui.button("Cancelar").clicked() {
                        self.show_create_community = false;
                    }
                });
                if response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                    submit = true;
                }
                if submit {
                    self.submit_create_community();
                }
            });
        self.show_create_community = open;

        // Criar convite
        let mut open = self.show_invite;
        egui::Window::new("Convidar para a comunidade")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, vec2(0.0, 0.0))
            .show(ctx, |ui| {
                ui.add_space(6.0);
                ui.label(RichText::new("Validade do convite").color(colors::TEXT_MUTED));
                ComboBox::from_id_salt("invite_expiry")
                    .selected_text(self.invite_expiry.label())
                    .show_ui(ui, |ui| {
                        ui.selectable_value(&mut self.invite_expiry, ExpiresIn::OneHour, "1 hora");
                        ui.selectable_value(
                            &mut self.invite_expiry,
                            ExpiresIn::TwentyFourHours,
                            "24 horas",
                        );
                        ui.selectable_value(
                            &mut self.invite_expiry,
                            ExpiresIn::SevenDays,
                            "7 dias",
                        );
                    });
                ui.add_space(10.0);
                if ui
                    .add(
                        Button::new(RichText::new("Gerar convite").color(Color32::WHITE))
                            .fill(colors::ACCENT_SOLID)
                            .corner_radius(CornerRadius::same(6)),
                    )
                    .clicked()
                {
                    self.submit_create_invite();
                }
                if let Some(invite) = &self.invite_result {
                    ui.add_space(10.0);
                    let link = format!("{}/invite#{}", self.origin, invite.code);
                    ui.label(
                        RichText::new("Link de convite (o código aparece uma vez):")
                            .color(colors::TEXT_MUTED),
                    );
                    ui.add_space(4.0);
                    ui.horizontal(|ui| {
                        ui.label(RichText::new(&link).color(colors::ACCENT));
                        if icon_button(ui, 28.0, false, 6, colors::TEXT_SECONDARY, "Copiar link", |p, r, c| {
                            icons::copy(p, r, c)
                        })
                        .clicked()
                        {
                            ctx.send_cmd(egui::OutputCommand::CopyText(link.clone()));
                        }
                    });
                    ui.label(
                        RichText::new(format!(
                            "Expira em {}",
                            util::fmt_message_time(&invite.expires_at)
                        ))
                        .small()
                        .color(colors::TEXT_MUTED),
                    );
                }
            });
        self.show_invite = open;

        // Entrar por convite
        let mut open = self.show_join_invite;
        egui::Window::new("Entrar por convite")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, vec2(0.0, 0.0))
            .show(ctx, |ui| {
                ui.add_space(6.0);
                ui.label(
                    RichText::new("Cole o link de convite ou só o código")
                        .color(colors::TEXT_MUTED),
                );
                ui.add(
                    TextEdit::singleline(&mut self.join_invite_input)
                        .desired_width(340.0)
                        .hint_text("https://servidor/invite#codigo"),
                );
                ui.add_space(10.0);
                ui.horizontal(|ui| {
                    if ui
                        .add(
                            Button::new(RichText::new("Ver convite").color(Color32::WHITE))
                                .fill(colors::ACCENT_SOLID)
                                .corner_radius(CornerRadius::same(6)),
                        )
                        .clicked()
                    {
                        self.submit_preview_invite();
                    }
                    if ui.button("Cancelar").clicked() {
                        self.show_join_invite = false;
                        self.join_invite_preview = None;
                    }
                });
                if self.join_invite_busy {
                    ui.add_space(8.0);
                    ui.label(RichText::new("Consultando...").color(colors::TEXT_MUTED));
                }
                if let Some((_code, preview)) = &self.join_invite_preview {
                    ui.add_space(10.0);
                    ui.separator();
                    ui.add_space(8.0);
                    ui.label(
                        RichText::new(&preview.community.name)
                            .size(16.0)
                            .strong()
                            .color(colors::TEXT_PRIMARY),
                    );
                    ui.label(
                        RichText::new(format!("{} membros", preview.community.member_count))
                            .color(colors::TEXT_MUTED),
                    );
                    ui.add_space(8.0);
                    if preview.already_member {
                        ui.add_enabled(
                            false,
                            Button::new(
                                RichText::new("Você já é membro").color(colors::TEXT_MUTED),
                            ),
                        );
                    } else if ui
                        .add(
                            Button::new(RichText::new("Entrar").color(Color32::WHITE))
                                .fill(colors::ACCENT_SOLID)
                                .corner_radius(CornerRadius::same(6)),
                        )
                        .clicked()
                    {
                        self.submit_accept_invite();
                    }
                }
            });
        self.show_join_invite = open;

        // Criar canal (ADMIN+)
        let mut open = self.show_create_channel;
        egui::Window::new("Criar canal")
            .open(&mut open)
            .collapsible(false)
            .resizable(false)
            .anchor(egui::Align2::CENTER_CENTER, vec2(0.0, 0.0))
            .show(ctx, |ui| {
                ui.add_space(6.0);
                ui.label(RichText::new("Nome do canal").color(colors::TEXT_MUTED));
                let response = ui.add(
                    TextEdit::singleline(&mut self.create_channel_name)
                        .desired_width(300.0)
                        .hint_text("Ex.: anúncios"),
                );
                ui.add_space(10.0);
                ui.label(RichText::new("Tipo").color(colors::TEXT_MUTED));
                ui.horizontal(|ui| {
                    ui.selectable_value(&mut self.create_channel_voice, false, "Texto (#)");
                    ui.selectable_value(&mut self.create_channel_voice, true, "Voz");
                });
                ui.label(
                    RichText::new("Canais de voz chegam na próxima versão.")
                        .small()
                        .color(colors::TEXT_MUTED),
                );
                ui.add_space(10.0);
                let mut submit = false;
                ui.horizontal(|ui| {
                    if ui
                        .add(
                            Button::new(RichText::new("Criar").color(Color32::WHITE))
                                .fill(colors::ACCENT_SOLID)
                                .corner_radius(CornerRadius::same(6)),
                        )
                        .clicked()
                    {
                        submit = true;
                    }
                    if ui.button("Cancelar").clicked() {
                        self.show_create_channel = false;
                    }
                });
                if response.lost_focus() && ui.input(|i| i.key_pressed(egui::Key::Enter)) {
                    submit = true;
                }
                if submit {
                    self.submit_create_channel();
                }
            });
        self.show_create_channel = open;
    }
}
