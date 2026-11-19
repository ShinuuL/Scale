# Scale Desktop (nativo, Rust)

Cliente desktop do Scale para Windows e Linux (x64). **UI nativa em Rust +
[egui](https://github.com/emilk/egui)** — não é um navegador embutido: a tela é
desenhada pelo próprio app e a conversa com o servidor é HTTP + WebSocket
direto.

Código: `apps/desktop-native` (crate `scale-desktop`). Detalhes de
desenvolvimento no [README do crate](../apps/desktop-native/README.md).

> **Histórico:** até novembro de 2026 existia um cliente Electron em
> `apps/desktop` que apenas abria a URL do servidor numa janela endurecida. Ele
> foi removido quando o nativo passou a ser o único desktop publicado. O
> histórico continua no git (último commit com ele: `aa15b4c`).

## O que já funciona (R1)

- Login por e-mail/senha; o JWT vai para o **keyring do sistema** (fallback:
  arquivo `0600` na pasta de configuração).
- Comunidades, canais de texto em tempo real, convites e mensagens diretas.

**Ainda não:** voz e compartilhamento de tela (R2+). Para chamada, use o Scale
pelo navegador. A landing page diz isso junto do botão de download.

## Requisitos

- Rust estável (1.85+)
- Linux: `libxcb`, `libxkbcommon`, `fontconfig`, `freetype` e `pkg-config`

```bash
# Ubuntu/Debian
sudo apt install libxcb1-dev libxcb-render0-dev libxcb-shape0-dev \
  libxcb-xfixes0-dev libxkbcommon-dev libfontconfig1-dev libfreetype6-dev pkg-config
```

## Rodar e verificar

```bash
npm run dev:desktop   # atalho para: cargo run --manifest-path apps/desktop-native/Cargo.toml

cd apps/desktop-native
cargo test
cargo clippy -- -D warnings
```

Na primeira tela, informe a origin do servidor (https; http só para
`localhost`/`127.0.0.1`).

## Gerar instaladores

```bash
cargo install cargo-packager --locked
npm run dist:desktop   # atalho para: cargo packager --release --manifest-path apps/desktop-native/Cargo.toml
```

Cada alvo só sai no seu próprio sistema (Linux também sai de um WSL/contêiner
Ubuntu). Sem certificado de assinatura configurado, o instalador sai **sem
assinatura** — o SmartScreen vai alertar no Windows.

## Publicar uma versão

A publicação é automática e a regra de versão é obrigatória: **toda mudança em
`apps/desktop-native` sobe `version` no `Cargo.toml`** (padrão: patch). O
workflow [`desktop-release.yml`](../.github/workflows/desktop-release.yml) faz
valer — o PR falha se a versão não for maior que a última release `desktop-v*`,
e o merge na `main` roda testes e clippy, gera os instaladores nos runners
Windows e Linux, calcula o `SHA256SUMS` e publica a release `desktop-v<version>`
criando a tag.

## Auto-update

Ao abrir, o app consulta a API de releases do GitHub. Havendo `desktop-v*` mais
nova (sem rascunho/pré-release), ele baixa o instalador da plataforma, **confere
o SHA-256 pelo `SHA256SUMS`** e avisa com "Reiniciar agora" / "Adiar". Checksum
diferente descarta a atualização. No `.deb` ele só avisa e abre a página da
release, porque instalar exige root. Detalhes no
[README do crate](../apps/desktop-native/README.md).

## Download no site

`apps/web/src/lib/downloads.ts` resolve os instaladores **pela mesma API de
releases que o app usa para se atualizar** e `DesktopDownload.tsx` mostra o
botão do sistema do visitante: `.exe` no Windows, AppImage no Linux (com `.deb`
como alternativa), e só uma explicação no macOS e no celular.

Dois detalhes que valem lembrar antes de mexer:

- **Por que a API e não um link fixo.** O cargo-packager nomeia os arquivos com
  a versão (`scale-desktop_0.1.2_x64-setup.exe`), então
  `releases/latest/download/<arquivo>` não tem nome estável para apontar. E o
  `latest` do GitHub devolve a release mais recente de **qualquer** tag, não só
  as de desktop — por isso a busca filtra `desktop-v*` e compara a versão
  numericamente (`0.10.0` > `0.9.0`).
- **Os assets são achados pela extensão**, nunca pelo nome completo: uma mudança
  de convenção do cargo-packager não quebra a página.

Tudo roda **depois da montagem**, porque a página é exportada estaticamente e o
HTML servido não pode depender nem do navegador nem da API do GitHub. Falha de
rede ou o limite de 60 requisições/hora da API pública caem no link para a
página de releases.

## Pendências

- Voz e compartilhamento de tela (R2+). Até lá, chamada só pelo navegador — a
  landing page diz isso junto do botão.
- Assinatura de código (certificado EV/OV) para o instalador e o executável.
- Build macOS (falta alvo, ícone `.icns`, assinatura/notarização e runner).
