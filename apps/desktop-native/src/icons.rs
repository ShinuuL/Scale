//! Ícones desenhados com `egui::Painter` — sem fonte de ícones, só traço.
//!
//! Todos seguem o estilo da UI web (SVG interno, stroke currentColor,
//! espessura ~1.75): recebem o retângulo alocado e a cor, e desenham traços
//! normalizados dentro dele.

use egui::{Color32, Painter, Pos2, Rect, Shape, Stroke, Vec2, vec2};

/// Largura de traço padrão, proporcional ao tamanho do ícone.
fn stroke(size: f32, color: Color32) -> Stroke {
    Stroke::new((size / 9.0).max(1.2), color)
}

fn line(painter: &Painter, a: Pos2, b: Pos2, s: Stroke) {
    painter.add(Shape::line_segment([a, b], s));
}

/// Hashtag `#` de canal de texto: duas barras verticais + duas horizontais
/// levemente inclinadas, como no Discord.
pub fn hash(painter: &Painter, rect: Rect, color: Color32) {
    let s = stroke(rect.width(), color);
    let p = |dx: f32, dy: f32| rect.min + vec2(rect.width() * dx, rect.height() * dy);
    // Verticais
    line(painter, p(0.36, 0.12), p(0.30, 0.88), s);
    line(painter, p(0.70, 0.12), p(0.64, 0.88), s);
    // Horizontais (inclinadas para a direita)
    line(painter, p(0.16, 0.38), p(0.84, 0.38), s);
    line(painter, p(0.16, 0.66), p(0.84, 0.66), s);
}

/// Alto-falante de canal de voz (cone + arcos de som).
pub fn speaker(painter: &Painter, rect: Rect, color: Color32) {
    let s = stroke(rect.width(), color);
    let p = |dx: f32, dy: f32| rect.min + vec2(rect.width() * dx, rect.height() * dy);
    // Caixa do alto-falante (trapézio)
    let points = vec![
        p(0.14, 0.40),
        p(0.32, 0.40),
        p(0.52, 0.22),
        p(0.52, 0.78),
        p(0.32, 0.60),
        p(0.14, 0.60),
        p(0.14, 0.40),
    ];
    painter.add(Shape::line(points, s));
    // Arcos de som
    painter.add(Shape::closed_line(
        vec![p(0.62, 0.36), p(0.74, 0.44), p(0.74, 0.56), p(0.62, 0.64)],
        s,
    ));
    painter.add(Shape::closed_line(
        vec![p(0.74, 0.28), p(0.90, 0.40), p(0.90, 0.60), p(0.74, 0.72)],
        s,
    ));
}

/// Sinal de mais (`+`), para criar comunidade/canal.
pub fn plus(painter: &Painter, rect: Rect, color: Color32) {
    let s = stroke(rect.width(), color);
    let c = rect.center();
    let h = rect.width() * 0.32;
    let v = rect.height() * 0.32;
    line(painter, c - Vec2::splat(h), c + Vec2::splat(h), s);
    line(
        painter,
        Pos2::new(c.x, c.y - v),
        Pos2::new(c.x, c.y + v),
        s,
    );
}

/// Porta com seta: entrar por convite / entrar em comunidade.
pub fn door_enter(painter: &Painter, rect: Rect, color: Color32) {
    let s = stroke(rect.width(), color);
    let p = |dx: f32, dy: f32| rect.min + vec2(rect.width() * dx, rect.height() * dy);
    // Batente da porta
    line(painter, p(0.20, 0.14), p(0.20, 0.86), s);
    line(painter, p(0.20, 0.14), p(0.52, 0.14), s);
    line(painter, p(0.52, 0.14), p(0.52, 0.86), s);
    line(painter, p(0.20, 0.86), p(0.52, 0.86), s);
    // Seta entrando
    line(painter, p(0.40, 0.50), p(0.86, 0.50), s);
    line(painter, p(0.70, 0.34), p(0.86, 0.50), s);
    line(painter, p(0.70, 0.66), p(0.86, 0.50), s);
}

/// Enviar mensagem (papelão com ponta), para o composer.
pub fn send(painter: &Painter, rect: Rect, color: Color32) {
    let s = stroke(rect.width(), color);
    let p = |dx: f32, dy: f32| rect.min + vec2(rect.width() * dx, rect.height() * dy);
    // Corpo em losango
    painter.add(Shape::closed_line(
        vec![p(0.10, 0.50), p(0.90, 0.14), p(0.66, 0.86), p(0.48, 0.60)],
        s,
    ));
    // Linha interna (dobra)
    line(painter, p(0.48, 0.60), p(0.90, 0.14), s);
}

/// Sair (seta para fora da porta).
pub fn logout(painter: &Painter, rect: Rect, color: Color32) {
    let s = stroke(rect.width(), color);
    let p = |dx: f32, dy: f32| rect.min + vec2(rect.width() * dx, rect.height() * dy);
    // Batente (aberto à direita)
    line(painter, p(0.44, 0.14), p(0.44, 0.86), s);
    line(painter, p(0.44, 0.14), p(0.76, 0.14), s);
    line(painter, p(0.44, 0.86), p(0.76, 0.86), s);
    // Seta saindo para a esquerda
    line(painter, p(0.66, 0.50), p(0.18, 0.50), s);
    line(painter, p(0.34, 0.34), p(0.18, 0.50), s);
    line(painter, p(0.34, 0.66), p(0.18, 0.50), s);
}

/// Copiar (dois retângulos sobrepostos), para o botão de copiar convite.
pub fn copy(painter: &Painter, rect: Rect, color: Color32) {
    let s = stroke(rect.width(), color);
    let p = |dx: f32, dy: f32| rect.min + vec2(rect.width() * dx, rect.height() * dy);
    let rect_back = Rect::from_min_max(p(0.30, 0.14), p(0.86, 0.70));
    let rect_front = Rect::from_min_max(p(0.14, 0.30), p(0.70, 0.86));
    painter.add(Shape::rect_stroke(rect_back, 0, s, egui::StrokeKind::Inside));
    painter.add(Shape::rect_stroke(rect_front, 0, s, egui::StrokeKind::Inside));
}

/// Balão de mensagens diretas (dois balões), usado no trilho.
pub fn messages(painter: &Painter, rect: Rect, color: Color32) {
    let s = stroke(rect.width(), color);
    let p = |dx: f32, dy: f32| rect.min + vec2(rect.width() * dx, rect.height() * dy);
    let r1 = Rect::from_min_max(p(0.10, 0.16), p(0.74, 0.58));
    let r2 = Rect::from_min_max(p(0.26, 0.44), p(0.90, 0.86));
    for r in [r1, r2] {
        painter.add(Shape::rect_stroke(r, egui::CornerRadius::same(4), s, egui::StrokeKind::Inside));
    }
    // Rabo do balão da frente
    line(painter, p(0.36, 0.86), p(0.32, 0.94), s);
    line(painter, p(0.36, 0.86), p(0.46, 0.86), s);
}
