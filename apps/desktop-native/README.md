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

## Versão e publicação (regra)

**Toda mudança em `apps/desktop-native` sobe `version` no `Cargo.toml`**
(semver: correção = patch, recurso = minor). O workflow
[`desktop-release.yml`](../../.github/workflows/desktop-release.yml) faz valer:

- PR: falha se a `version` não for maior que a última release `desktop-v*`.
- Merge na `main`: testes + clippy, instaladores em runners Windows e Linux,
  `SHA256SUMS` e release `desktop-v<version>` (tag criada pelo workflow).

## Atualização automática

Ao abrir, o app consulta `api.github.com/repos/ShinuuL/Scale/releases`. Havendo
`desktop-v*` mais nova (sem rascunho/pré-release):

1. baixa o instalador da plataforma e confere o SHA-256 pelo `SHA256SUMS`;
2. mostra "Versão X pronta" com "Reiniciar agora" / "Adiar" (30 min) e, sem
   ação, reinicia sozinho em 15 s;
3. Windows: fecha, roda o setup NSIS em silêncio (`/S`) e reabre o Scale.
   AppImage: troca o próprio arquivo e reabre. `.deb`: só avisa e abre a
   página da release (instalar exige root).

Checksum diferente descarta a atualização. Fork: compile com
`SCALE_UPDATE_REPO=dono/repo`.
