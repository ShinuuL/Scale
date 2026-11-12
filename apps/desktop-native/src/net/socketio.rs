//! Cliente Socket.IO v4 mínimo sobre Engine.IO v4, só websocket.
//!
//! Sem `rust_socketio`: o protocolo que o servidor usa está implementado aqui.
//!
//! - URL: `<ws(s)>://<host>/socket.io/?EIO=4&transport=websocket`
//! - Handshake: servidor manda `0{...}` (open); cliente conecta o namespace
//!   com `40{"token":...}` (auth) e recebe `40{"sid":...}`.
//! - Ping/pong Engine.IO: `2` -> `3` (respondemos o ping do servidor e
//!   enviamos o nosso no intervalo do handshake).
//! - Eventos: `42["nome",{...}]`; evento com ack pedido `42<id>[...]`,
//!   ack do servidor `43<id>[...]`.
//! - Pacotes podem vir agrupados num frame separados por `\x1e`.
//! - Reconexão com backoff exponencial (1 s -> 30 s, com jitter).

use std::collections::HashMap;
use std::sync::mpsc::Sender as StdSender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use thiserror::Error;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::{connect_async, tungstenite::Message};

/// Separador de pacotes num frame Engine.IO v4.
const RECORD_SEP: char = '\u{1e}';

/// Parser/encoder do protocolo. Puro: todo coberto por testes unitários.
pub mod proto {
    use super::*;

    #[derive(Debug, Error, PartialEq, Eq)]
    pub enum ParseError {
        #[error("pacote vazio")]
        Empty,
        #[error("tipo de pacote desconhecido: {0}")]
        UnknownType(char),
        #[error("payload JSON inválido: {0}")]
        BadJson(String),
    }

    /// Pacote Engine.IO/Socket.IO decodificado.
    #[derive(Debug, Clone, PartialEq)]
    pub enum Packet {
        /// `0{...}` — handshake (sid, pingInterval, pingTimeout).
        Open(Value),
        /// `1` — o servidor vai fechar a conexão.
        Close,
        /// `2` — ping (Engine.IO); responder com `3`.
        Ping(Option<String>),
        /// `3` — pong.
        Pong,
        /// `40{...}` — conectado no namespace (payload opcional: {sid}).
        Connect(Option<Value>),
        /// `41` — namespace desconectado.
        Disconnect,
        /// `42["evento", {...}]` / `42<id>[...]` — evento (id = ack pedido).
        Event {
            id: Option<u64>,
            event: String,
            payload: Value,
        },
        /// `43<id>[...]` — ack de um evento que enviamos com id.
        Ack { id: u64, payload: Value },
        /// `44{...}` — erro do Socket.IO.
        Error(Value),
        /// Pacote de tipo que não usamos (binário, upgrade, noop...).
        Other(u8),
    }

    fn parse_json(s: &str) -> Result<Value, ParseError> {
        serde_json::from_str(s).map_err(|e| ParseError::BadJson(e.to_string()))
    }

    /// Decodifica UM pacote de texto Engine.IO/Socket.IO.
    pub fn parse(input: &str) -> Result<Packet, ParseError> {
        let mut chars = input.chars();
        let engine = chars.next().ok_or(ParseError::Empty)?;
        let rest = chars.as_str();
        match engine {
            '0' => Ok(Packet::Open(parse_json(rest).unwrap_or(Value::Null))),
            '1' => Ok(Packet::Close),
            '2' => Ok(Packet::Ping(if rest.is_empty() {
                None
            } else {
                Some(rest.to_string())
            })),
            '3' => Ok(Packet::Pong),
            '4' => parse_socketio(rest),
            other => Err(ParseError::UnknownType(other)),
        }
    }

    fn parse_socketio(rest: &str) -> Result<Packet, ParseError> {
        let mut chars = rest.chars();
        let kind = chars.next().ok_or(ParseError::Empty)?;
        let mut rest = chars.as_str();
        match kind {
            '0' => Ok(Packet::Connect(if rest.is_empty() {
                None
            } else {
                Some(parse_json(rest)?)
            })),
            '1' => Ok(Packet::Disconnect),
            '2' | '3' => {
                // Evento ou ack: dígitos de id opcionais e depois o JSON.
                let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                rest = &rest[digits.len()..];
                let id = if digits.is_empty() {
                    None
                } else {
                    Some(digits.parse::<u64>().map_err(|_| {
                        ParseError::BadJson(format!("id de ack inválido: {digits}"))
                    })?)
                };
                let payload = if rest.is_empty() {
                    Value::Null
                } else {
                    parse_json(rest)?
                };
                if kind == '2' {
                    // Espera ["nome", args...]; args vem como Value (o elemento
                    // logo após o nome).
                    let arr = payload
                        .as_array()
                        .ok_or_else(|| ParseError::BadJson("evento não é um array".into()))?;
                    let event = arr
                        .first()
                        .and_then(Value::as_str)
                        .ok_or_else(|| ParseError::BadJson("evento sem nome".into()))?
                        .to_string();
                    let payload = match arr.get(1) {
                        Some(v) => v.clone(),
                        None => Value::Null,
                    };
                    Ok(Packet::Event { id, event, payload })
                } else {
                    match id {
                        Some(id) => Ok(Packet::Ack { id, payload }),
                        None => Err(ParseError::BadJson("ack sem id".into())),
                    }
                }
            }
            '4' => Ok(Packet::Error(if rest.is_empty() {
                Value::Null
            } else {
                parse_json(rest).unwrap_or_else(|_| Value::String(rest.to_string()))
            })),
            other => Ok(Packet::Other(other as u8)),
        }
    }

    /// Divide um frame em pacotes (`\x1e`) e decodifica todos.
    pub fn parse_frame(frame: &str) -> Vec<Result<Packet, ParseError>> {
        frame
            .split(RECORD_SEP)
            .filter(|s| !s.is_empty())
            .map(parse)
            .collect()
    }

    /// `40{"token":"..."}` — conecta o namespace `/` com auth.
    pub fn encode_connect(auth: &Value) -> String {
        format!("40{auth}")
    }

    /// `42["evento",{...}]` — emite um evento (sem ack).
    pub fn encode_event(event: &str, payload: &Value) -> String {
        serde_json::to_string(&[Value::String(event.to_string()), payload.clone()])
            .map(|body| format!("42{body}"))
            .expect("serialização de [String, Value] não falha")
    }

    /// `42<id>["evento",{...}]` — emite um evento pedindo ack.
    pub fn encode_event_with_id(id: u64, event: &str, payload: &Value) -> String {
        serde_json::to_string(&[Value::String(event.to_string()), payload.clone()])
            .map(|body| format!("42{id}{body}"))
            .expect("serialização de [String, Value] não falha")
    }

    /// `43<id>[...]` — responde um ack pedido pelo servidor.
    #[allow(dead_code)] // parte do toolkit do protocolo; coberto por testes
    pub fn encode_ack_reply(id: u64, payload: &Value) -> String {
        serde_json::to_string(payload)
            .map(|body| format!("43{id}{body}"))
            .expect("serialização de Value não falha")
    }

    /// `2` — ping Engine.IO.
    pub fn encode_ping() -> &'static str {
        "2"
    }

    /// `3` — pong Engine.IO.
    pub fn encode_pong() -> &'static str {
        "3"
    }
}

pub use proto::Packet;

/// Prazo para o servidor responder um ack.
pub const ACK_TIMEOUT: Duration = Duration::from_secs(10);

/// Mapa id de ack -> oneshot esperando a resposta. Compartilhado entre a
/// handle (registra) e a tarefa de rede (resolve ao receber `43<id>[...]`).
#[derive(Clone, Default)]
pub struct AckRouter {
    inner: Arc<Mutex<AckState>>,
}

#[derive(Default)]
struct AckState {
    next_id: u64,
    pending: HashMap<u64, oneshot::Sender<Value>>,
}

impl AckRouter {
    /// Reserva um id e devolve o receptor da resposta.
    pub fn register(&self) -> (u64, oneshot::Receiver<Value>) {
        let mut st = self.inner.lock().expect("mutex de acks");
        st.next_id += 1;
        let id = st.next_id;
        let (tx, rx) = oneshot::channel();
        st.pending.insert(id, tx);
        (id, rx)
    }

    /// Entrega a resposta ao id; `false` se o id é desconhecido (ignorado).
    /// O ack chega como array de argumentos: usa o primeiro.
    pub fn resolve(&self, id: u64, payload: Value) -> bool {
        let tx = self.inner.lock().expect("mutex de acks").pending.remove(&id);
        match tx {
            Some(tx) => {
                let first = match payload {
                    Value::Array(mut a) if !a.is_empty() => a.remove(0),
                    other => other,
                };
                let _ = tx.send(first);
                true
            }
            None => false,
        }
    }

    /// Descarta um id pendente (timeout).
    pub fn cancel(&self, id: u64) {
        self.inner.lock().expect("mutex de acks").pending.remove(&id);
    }

    /// Espera a resposta até `timeout`; `None` se estourar ou se cair.
    pub async fn wait(
        &self,
        id: u64,
        rx: oneshot::Receiver<Value>,
        timeout: Duration,
    ) -> Option<Value> {
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(v)) => Some(v),
            _ => {
                self.cancel(id);
                None
            }
        }
    }
}

/// Evento entregue à UI pela thread de rede.
#[derive(Debug, Clone)]
pub enum SocketEvent {
    /// `40` recebido: socket conectado e pronto para assinar.
    Connected,
    ConexaoPerdida,
    /// Pacote decodificado (evento, ack, erro de namespace etc.).
    Packet(Packet),
}

/// Comandos para a tarefa de rede.
#[derive(Debug)]
enum Cmd {
    Conectar { url: String, token: String },
    Desconectar,
    Enviar(String),
}

/// Handle barata para a UI: clonável, nunca bloqueia.
#[derive(Clone)]
pub struct SocketHandle {
    tx: mpsc::UnboundedSender<Cmd>,
    acks: AckRouter,
}

impl SocketHandle {
    pub fn connect(&self, url: String, token: String) {
        let _ = self.tx.send(Cmd::Conectar { url, token });
    }

    pub fn disconnect(&self) {
        let _ = self.tx.send(Cmd::Desconectar);
    }

    /// Envia um pacote já codificado (use [`proto::encode_event`]).
    pub fn send_raw(&self, packet: String) {
        let _ = self.tx.send(Cmd::Enviar(packet));
    }

    pub fn send_event(&self, event: &str, payload: &Value) {
        self.send_raw(proto::encode_event(event, payload));
    }

    /// Envia um evento pedindo ack. Devolve o roteador, o id e o receptor
    /// para `AckRouter::wait` (timeout [`ACK_TIMEOUT`]).
    pub fn send_event_with_ack(
        &self,
        event: &str,
        payload: &Value,
    ) -> (AckRouter, u64, oneshot::Receiver<Value>) {
        let (id, rx) = self.acks.register();
        self.send_raw(proto::encode_event_with_id(id, event, payload));
        (self.acks.clone(), id, rx)
    }
}

/// Intervalo/ping padrão caso o handshake não traga.
const DEFAULT_PING_INTERVAL: Duration = Duration::from_secs(25);

/// Cria a tarefa de socket. Os eventos chegam por `events` (std channel,
/// consumido com `try_recv` no frame da UI — nunca bloqueia).
pub fn spawn(rt: &tokio::runtime::Handle, events: StdSender<SocketEvent>) -> SocketHandle {
    let (tx, mut rx) = mpsc::unbounded_channel::<Cmd>();
    let acks = AckRouter::default();
    let task_acks = acks.clone();
    rt.spawn(async move {
        loop {
            // Desconectado: espera um Conectar (ou morre com o handle).
            let (url, token) = loop {
                match rx.recv().await {
                    Some(Cmd::Conectar { url, token }) => break (url, token),
                    Some(_) => {}
                    None => return,
                }
            };
            // Alvo atual de (re)conexão: repetido a cada reconexão.
            let mut target = Some((url, token));
            let mut attempt: u32 = 0;

            // Conectado: sessões em loop até Desconectar ou fim do handle.
            while let Some((url, token)) = target.clone() {
                match run_session(&mut rx, &events, &task_acks, &url, &token, &mut attempt).await {
                    // Comando recebido durante o backoff: aplica e reitera.
                    Some(Cmd::Conectar { url, token }) => {
                        attempt = 0;
                        target = Some((url, token));
                    }
                    Some(Cmd::Desconectar) => {
                        target = None;
                        let _ = events.send(SocketEvent::ConexaoPerdida);
                    }
                    Some(Cmd::Enviar(_)) => {}
                    None => return, // handle descartado
                }
            }
        }
    });
    SocketHandle { tx, acks }
}

/// Uma sessão ws: conecta, faz handshake, bombeia mensagens até cair.
/// No fim aplica o backoff; retorna o comando que interrompeu a espera
/// (ou None se o canal morreu).
async fn run_session(
    rx: &mut mpsc::UnboundedReceiver<Cmd>,
    events: &StdSender<SocketEvent>,
    acks: &AckRouter,
    url: &str,
    token: &str,
    attempt: &mut u32,
) -> Option<Cmd> {
    let Ok((mut ws, _response)) = connect_async(url).await else {
        return backoff_sleep(rx, attempt).await;
    };

    // Handshake Engine.IO: espera o `0{...}` de open.
    let ping_interval = match tokio::time::timeout(Duration::from_secs(10), ws.next()).await {
        Ok(Some(Ok(Message::Text(frame)))) => {
            let mut interval = DEFAULT_PING_INTERVAL;
            for pkt in proto::parse_frame(&frame) {
                if let Ok(Packet::Open(v)) = pkt {
                    if let Some(ms) = v.get("pingInterval").and_then(Value::as_u64) {
                        interval = Duration::from_millis(ms);
                    }
                    break;
                }
            }
            interval
        }
        _ => {
            let _ = ws.close(None).await;
            return backoff_sleep(rx, attempt).await;
        }
    };

    // Conecta o namespace / com o token (auth).
    let connect_pkt = proto::encode_connect(&serde_json::json!({ "token": token }));
    if ws.send(Message::Text(connect_pkt.into())).await.is_err() {
        return backoff_sleep(rx, attempt).await;
    }

    let mut ping = tokio::time::interval(ping_interval);
    ping.tick().await; // o primeiro tick dispara na hora; pula

    let mut interrupted: Option<Cmd> = None;
    'session: loop {
        tokio::select! {
            _ = ping.tick() => {
                if ws.send(Message::Text(proto::encode_ping().into())).await.is_err() {
                    break 'session;
                }
            }
            cmd = rx.recv() => match cmd {
                Some(Cmd::Enviar(packet)) => {
                    if ws.send(Message::Text(packet.into())).await.is_err() {
                        break 'session;
                    }
                }
                Some(other) => { interrupted = Some(other); break 'session; }
                None => { interrupted = None; break 'session; }
            },
            msg = ws.next() => match msg {
                Some(Ok(Message::Text(frame))) => {
                    for pkt in proto::parse_frame(&frame) {
                        match pkt {
                            Ok(Packet::Ping(_)) => {
                                if ws.send(Message::Text(proto::encode_pong().into())).await.is_err() {
                                    break 'session;
                                }
                            }
                            Ok(Packet::Connect(_)) => {
                                let _ = events.send(SocketEvent::Connected);
                            }
                            Ok(Packet::Close) | Ok(Packet::Disconnect) => break 'session,
                            Ok(Packet::Ack { id, payload }) => {
                                acks.resolve(id, payload);
                            }
                            Ok(p) => { let _ = events.send(SocketEvent::Packet(p)); }
                            Err(_) => {}
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None => break 'session,
                Some(Ok(_)) => {} // binário/pong de ws: ignorado
                Some(Err(_)) => break 'session,
            },
        }
    }

    let _ = events.send(SocketEvent::ConexaoPerdida);
    let _ = ws.close(None).await;

    match interrupted {
        // O usuário pediu algo no meio da sessão: não espera mais nada.
        Some(cmd) => Some(cmd),
        None => backoff_sleep(rx, attempt).await,
    }
}

/// Espera 1 s, 2 s, 4 s ... teto 30 s (com jitter) e devolve o comando que
/// chegou durante a espera, se houver.
async fn backoff_sleep(
    rx: &mut mpsc::UnboundedReceiver<Cmd>,
    attempt: &mut u32,
) -> Option<Cmd> {
    let secs = (1u64 << (*attempt).min(5)).min(30);
    *attempt = (*attempt + 1).min(6);
    let jitter = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_millis() as u64)
        .unwrap_or_default())
        % 250;
    tokio::time::timeout(Duration::from_millis(secs * 1000 + jitter), rx.recv())
        .await
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::proto::*;
    use super::{AckRouter, Duration};
    use serde_json::json;

    #[tokio::test]
    async fn ack_router_resolves_right_id() {
        let r = AckRouter::default();
        let (id1, rx1) = r.register();
        let (id2, rx2) = r.register();
        assert_ne!(id1, id2);
        assert!(r.resolve(id2, json!([{ "success": true }])));
        assert_eq!(
            r.wait(id2, rx2, Duration::from_secs(1)).await,
            Some(json!({ "success": true }))
        );
        // id1 continua pendente.
        assert!(r.resolve(id1, json!([1])));
        assert_eq!(r.wait(id1, rx1, Duration::from_secs(1)).await, Some(json!(1)));
    }

    #[test]
    fn ack_router_ignores_unknown_id() {
        let r = AckRouter::default();
        assert!(!r.resolve(999, json!([])));
    }

    #[tokio::test]
    async fn ack_router_times_out_and_cleans_up() {
        let r = AckRouter::default();
        let (id, rx) = r.register();
        assert_eq!(r.wait(id, rx, Duration::from_millis(20)).await, None);
        // Depois do timeout o id não resolve mais.
        assert!(!r.resolve(id, json!([])));
    }

    #[test]
    fn parse_open_packet() {
        let pkt = parse(r#"0{"sid":"abc","pingInterval":25000,"pingTimeout":5000}"#).unwrap();
        match pkt {
            Packet::Open(v) => assert_eq!(v["sid"], "abc"),
            other => panic!("esperava Open, veio {other:?}"),
        }
    }

    #[test]
    fn parse_ping_pong_close() {
        assert_eq!(parse("2").unwrap(), Packet::Ping(None));
        assert_eq!(parse("2probe").unwrap(), Packet::Ping(Some("probe".into())));
        assert_eq!(parse("3").unwrap(), Packet::Pong);
        assert_eq!(parse("1").unwrap(), Packet::Close);
    }

    #[test]
    fn parse_connect_packet() {
        let pkt = parse(r#"40{"sid":"s1"}"#).unwrap();
        match pkt {
            Packet::Connect(Some(v)) => assert_eq!(v["sid"], "s1"),
            other => panic!("esperava Connect, veio {other:?}"),
        }
        assert_eq!(parse("40").unwrap(), Packet::Connect(None));
    }

    #[test]
    fn parse_event_without_id() {
        let pkt = parse(r#"42["dm:message",{"id":"m1"}]"#).unwrap();
        match pkt {
            Packet::Event { id, event, payload } => {
                assert_eq!(id, None);
                assert_eq!(event, "dm:message");
                assert_eq!(payload["id"], "m1");
            }
            other => panic!("esperava Event, veio {other:?}"),
        }
    }

    #[test]
    fn parse_event_with_ack_id() {
        let pkt = parse(r#"4212["community:subscribe",{"communityId":"c1"}]"#).unwrap();
        match pkt {
            Packet::Event { id, event, payload } => {
                assert_eq!(id, Some(12));
                assert_eq!(event, "community:subscribe");
                assert_eq!(payload["communityId"], "c1");
            }
            other => panic!("esperava Event, veio {other:?}"),
        }
    }

    #[test]
    fn parse_ack_from_server() {
        let pkt = parse(r#"439["ok"]"#).unwrap();
        assert_eq!(
            pkt,
            Packet::Ack {
                id: 9,
                payload: json!(["ok"])
            }
        );
    }

    #[test]
    fn parse_error_packet() {
        let pkt = parse(r#"44{"message":"unauthorized"}"#).unwrap();
        match pkt {
            Packet::Error(v) => assert_eq!(v["message"], "unauthorized"),
            other => panic!("esperava Error, veio {other:?}"),
        }
    }

    #[test]
    fn parse_rejects_garbage() {
        assert!(parse("").is_err());
        assert!(parse("x2").is_err());
        assert!(parse(r#"42{"nao":"array"}"#).is_err());
        assert!(parse(r#"42[123]"#).is_err()); // nome do evento não é string
    }

    #[test]
    fn parse_frame_splits_records() {
        let pkts = parse_frame("2\u{1e}3\u{1e}42[\"a\",null]");
        assert_eq!(pkts.len(), 3);
        assert_eq!(pkts[0].as_ref().unwrap(), &Packet::Ping(None));
        assert_eq!(pkts[1].as_ref().unwrap(), &Packet::Pong);
    }

    #[test]
    fn encode_connect_roundtrip() {
        let out = encode_connect(&json!({ "token": "jwt" }));
        assert_eq!(out, r#"40{"token":"jwt"}"#);
        assert_eq!(
            parse(&out).unwrap(),
            Packet::Connect(Some(json!({ "token": "jwt" })))
        );
    }

    #[test]
    fn encode_event_roundtrip() {
        let out = encode_event("channel:message", &json!({ "id": 7 }));
        assert!(out.starts_with("42["));
        match parse(&out).unwrap() {
            Packet::Event { id, event, payload } => {
                assert_eq!(id, None);
                assert_eq!(event, "channel:message");
                assert_eq!(payload, json!({ "id": 7 }));
            }
            other => panic!("esperava Event, veio {other:?}"),
        }
    }

    #[test]
    fn encode_event_with_id_roundtrip() {
        let out = encode_event_with_id(3, "community:subscribe", &json!({ "communityId": "c" }));
        match parse(&out).unwrap() {
            Packet::Event { id, event, .. } => {
                assert_eq!(id, Some(3));
                assert_eq!(event, "community:subscribe");
            }
            other => panic!("esperava Event, veio {other:?}"),
        }
    }

    #[test]
    fn encode_ack_reply_roundtrip() {
        let out = encode_ack_reply(5, &json!(["ok"]));
        assert_eq!(
            parse(&out).unwrap(),
            Packet::Ack {
                id: 5,
                payload: json!(["ok"])
            }
        );
    }

    #[test]
    fn ping_pong_encode() {
        assert_eq!(encode_ping(), "2");
        assert_eq!(encode_pong(), "3");
    }
}
