# Scale Desktop (nativo)

Cliente desktop nativo do Scale em Rust + [egui](https://github.com/emilk/egui).
R1: comunidades, canais de texto em tempo real, convites, DMs e login por
e-mail/senha. Voz/tela chegam nas próximas versões (R2+).

## Requisitos

- Rust estável (1.85+; desenvolvido com 1.98)
- Linux: `libxcb`, `libxkbcommon`, `fontconfig`, `freetype` e `pkg-config`

```bash
# Ubuntu/Debian
sudo apt install libxcb1-dev libxcb-render0-dev libxcb-shape0-dev \
  libxcb-xfixes0-dev libxkbcommon-dev libfontconfig1-dev libfreetype6-dev pkg-config
```

## Rodar

```bash
cargo run
```

Primeira tela: informe a origin do servidor (https; http só para
localhost/127.0.0.1). Depois, e-mail/senha. O JWT vai para o keyring do SO
(fallback: arquivo com permissão 0600 na pasta de configuração).

## Verificação

```bash
cargo build
cargo test
cargo clippy -- -D warnings
```

## Instaladores

Com o [cargo-packager](https://crates.io/crates/cargo-packager):

```bash
cargo install cargo-packager --locked

# Linux: .deb + AppImage
cargo packager --release

# Windows (NSIS + MSI): ver ci/build.yml — build em windows-latest
# ou cross com cargo-xwin a partir do Linux
cargo install cargo-xwin --locked
cargo xwin build --release
cargo xwin packager --release
```

Saída em `target/release/bundles/`. Um workflow de exemplo está em
[`ci/build.yml`](ci/build.yml).
