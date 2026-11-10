//! Tema Scale: cores de `apps/web/src/app/globals.css` (linhas 8-23) e
//! `DESIGN.md`, aplicadas num [`egui::Visuals`] escuro.

use egui::{Color32, CornerRadius, Stroke, Visuals};
use egui::style::WidgetVisuals;

/// Tokens de cor da marca.
pub mod colors {
    use egui::Color32;
    pub const BG_BASE: Color32 = Color32::from_rgb(0x1c, 0x1d, 0x23);
    pub const BG_SECONDARY: Color32 = Color32::from_rgb(0x17, 0x18, 0x1e);
    pub const BG_TERTIARY: Color32 = Color32::from_rgb(0x25, 0x26, 0x2e);
    pub const BG_HOVER: Color32 = Color32::from_rgb(0x2b, 0x2d, 0x37);
    pub const TEXT_PRIMARY: Color32 = Color32::from_rgb(0xf2, 0xf3, 0xf8);
    pub const TEXT_SECONDARY: Color32 = Color32::from_rgb(0xb6, 0xb9, 0xc8);
    pub const TEXT_MUTED: Color32 = Color32::from_rgb(0x92, 0x98, 0xac);
    pub const ACCENT: Color32 = Color32::from_rgb(0xa5, 0xaa, 0xff);
    pub const ACCENT_SOLID: Color32 = Color32::from_rgb(0x62, 0x63, 0xda);
    pub const ACCENT_SUBTLE: Color32 = Color32::from_rgb(0x2c, 0x2c, 0x48);
    pub const BORDER: Color32 = Color32::from_rgb(0x32, 0x34, 0x3f);
    pub const BORDER_STRONG: Color32 = Color32::from_rgb(0x4c, 0x50, 0x60);
    /// Verde só para presença (online).
    pub const ONLINE: Color32 = Color32::from_rgb(0x62, 0xc4, 0x9a);
}

fn widget_visuals(bg: Color32, weak_bg: Color32, fg: Color32) -> WidgetVisuals {
    WidgetVisuals {
        bg_fill: bg,
        weak_bg_fill: weak_bg,
        bg_stroke: Stroke::new(1.0, colors::BORDER),
        corner_radius: CornerRadius::same(6),
        fg_stroke: Stroke::new(1.0, fg),
        expansion: 0.0,
    }
}

/// Visuals do egui no tema Scale.
pub fn visuals() -> Visuals {
    let mut v = Visuals::dark();
    v.override_text_color = Some(colors::TEXT_PRIMARY);
    v.weak_text_color = Some(colors::TEXT_MUTED);
    v.panel_fill = colors::BG_BASE;
    v.window_fill = colors::BG_TERTIARY;
    v.extreme_bg_color = colors::BG_SECONDARY;
    v.faint_bg_color = colors::BG_TERTIARY;
    v.code_bg_color = colors::BG_SECONDARY;
    v.window_stroke = Stroke::new(1.0, colors::BORDER);
    v.window_corner_radius = CornerRadius::same(10);
    v.menu_corner_radius = CornerRadius::same(6);
    v.widgets.noninteractive = widget_visuals(
        colors::BG_TERTIARY,
        colors::BG_TERTIARY,
        colors::TEXT_SECONDARY,
    );
    v.widgets.inactive = widget_visuals(colors::BG_TERTIARY, colors::BG_TERTIARY, colors::TEXT_PRIMARY);
    v.widgets.hovered = widget_visuals(colors::BG_HOVER, colors::BG_HOVER, colors::TEXT_PRIMARY);
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, colors::BORDER_STRONG);
    v.widgets.hovered.fg_stroke = Stroke::new(1.25, colors::TEXT_PRIMARY);
    v.widgets.active = widget_visuals(colors::ACCENT_SOLID, colors::ACCENT_SOLID, Color32::WHITE);
    v.widgets.active.fg_stroke = Stroke::new(1.25, Color32::WHITE);
    v.widgets.open = widget_visuals(colors::BG_HOVER, colors::BG_HOVER, colors::TEXT_PRIMARY);
    v.selection.bg_fill = colors::ACCENT_SUBTLE;
    v.selection.stroke = Stroke::new(1.0, colors::ACCENT);
    v.hyperlink_color = colors::ACCENT;
    v.text_cursor.stroke = Stroke::new(2.0, colors::ACCENT);
    v
}
