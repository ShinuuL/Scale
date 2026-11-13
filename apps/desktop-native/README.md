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

Com o [cargo-packager](https://crates.io/crates/cargo-packager) (o
`before-packaging-command` do `Cargo.toml` já compila o release):

```bash
cargo install cargo-packager --locked

cargo packager --release --formats nsis            # Windows: setup .exe
cargo packager --release --formats deb,appimage    # Linux
```

Saída em `target/dist/`.

## Publicar uma versão (GitHub Releases)

1. Suba `version` no `Cargo.toml` (ex.: `0.2.0`) e faça merge na `main`.
2. `git tag desktop-v0.2.0 && git push origin desktop-v0.2.0`

O workflow [`desktop-release.yml`](../../.github/workflows/desktop-release.yml)
confere tag = `Cargo.toml`, roda testes e clippy, gera os instaladores em
runners Windows e Linux e publica a release com `SHA256SUMS`.

## Aviso de atualização

Ao abrir, o app consulta `api.github.com/repos/ShinuuL/Scale/releases` e, se
houver release `desktop-v*` (sem rascunho/pré-release) mais nova que a versão
compilada, mostra uma faixa no topo com "Baixar atualização" (abre a página da
release no navegador). Não baixa nem executa nada sozinho. Fork: compile com
`SCALE_UPDATE_REPO=dono/repo`.
