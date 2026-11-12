//! Scale Desktop — app nativo Rust/egui.
//!
//! R1 (texto): comunidades, canais de texto em tempo real, convites, DMs e
//! login por e-mail/senha. A rede roda em tarefas tokio; a UI (eframe) recebe
//! os eventos por canal e nunca bloqueia.

mod api;
mod app;
mod config;
mod icons;
mod net;
mod state;
mod theme;
mod token_store;
mod ui;
mod util;

use std::time::Duration;

use eframe::egui;

use app::ScaleApp;
use state::Screen;

fn main() -> eframe::Result<()> {
    let rt = tokio::runtime::Runtime::new().expect("falha ao criar a runtime tokio");
    let rt_handle = rt.handle().clone();

    let options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_title("Scale")
            .with_app_id("br.com.codecoffee.scale")
            .with_inner_size([1120.0, 720.0])
            .with_min_inner_size([900.0, 540.0]),
        ..Default::default()
    };

    eframe::run_native(
        "Scale",
        options,
        Box::new(move |cc| {
            cc.egui_ctx.set_visuals(theme::visuals());
            let mut app = ScaleApp::new(cc, rt_handle);
            // Origin salva + token guardado: tenta restaurar a sessão.
            if app.screen == Screen::Login && app.token.is_some() {
                app.restore_session();
            }
            Ok(Box::new(app))
        }),
    )
}

impl eframe::App for ScaleApp {
    fn ui(&mut self, ui: &mut egui::Ui, _frame: &mut eframe::Frame) {
        let ctx = ui.ctx().clone();

        // Drena os canais (nunca bloqueia): socket primeiro, depois REST.
        while let Ok(event) = self.socket_rx.try_recv() {
            self.apply_socket_event(event, &ctx);
        }
        while let Ok(event) = self.events_rx.try_recv() {
            self.apply_ui_event(event, &ctx);
        }

        // friends:changed chegou por socket? Refaz o GET uma vez.
        let friends_dirty = self
            .main
            .as_ref()
            .map(|m| m.friends_dirty)
            .unwrap_or(false);
        if friends_dirty {
            self.load_friends();
        }

        match self.screen {
            Screen::Conectar => self.render_connect(ui),
            Screen::Login => self.render_login(ui),
            Screen::Principal => self.render_main(ui, &ctx),
        }

        // Redesenha periodicamente para relógio, reconexão e estados busy.
        ctx.request_repaint_after(Duration::from_millis(500));
    }
}
