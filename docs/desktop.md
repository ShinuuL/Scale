# Scale Desktop (Electron)

Cliente desktop do Scale para Windows (x64). O app **não empacota o frontend**:
ele abre a URL do servidor Scale numa janela endurecida. Assim o login (cookie
HttpOnly `SameSite=Strict`), o CSP e as atualizações do front são os mesmos do
navegador — atualizar o servidor atualiza o app, sem reinstalar.

Código: `apps/desktop` (workspace `scale-desktop`).

## Requisitos

- **Servidor com HTTPS** e certificado válido (domínio próprio ou o túnel
  `*.trycloudflare.com`, ver `docs/tunnel-setup.md`). `http://` só é aceito para
  `localhost` / `127.0.0.1` (desenvolvimento). Erros de certificado não são
  ignorados.
- O servidor precisa responder `GET /api/health` com `{"status":"ok"}`.
- Windows 10/11 x64. Microfone e captura de tela pedem a permissão normal do
  Windows (Configurações > Privacidade).

## Uso

1. Na primeira execução aparece a tela **Conectar ao servidor Scale**.
2. Digite só o endereço base (ex.: `https://scale.exemplo.com.br`) — sem caminho,
   parâmetros, usuário ou senha.
3. **Testar e salvar** chama `/api/health`; se responder ok, o endereço é salvo e
   o Scale abre.

**Trocar servidor:** menu Arquivo > Trocar servidor (`Ctrl+Shift+S`). Se o servidor
estiver fora do ar, a janela de erro também oferece Trocar servidor.

Configuração salva em `%APPDATA%\Scale\config.json` (origin) e
`window-state.json` (tamanho/posição). Arquivo inválido ou adulterado é
descartado e a tela de configuração volta.

Compartilhar tela abre o seletor do app (telas e janelas com miniatura; setas
navegam, Enter compartilha, Esc cancela). A opção "Compartilhar áudio do sistema"
aparece no Windows, desmarcada; ela só fica ativa quando a chamada pede áudio no
`getDisplayMedia`. Permissões e suporte do sistema continuam necessários.

**Fechar e sair:** com bandeja disponível, o botão de fechar oculta a janela e
mantém a chamada. Clique no ícone da bandeja para abrir. Para encerrar chamadas
e o processo, use **Sair do Scale e encerrar chamadas** na bandeja ou Arquivo >
Sair. Sem bandeja disponível, fechar a janela encerra o aplicativo.

**Microfone global:** o menu da bandeja oferece ativação opcional de
`Ctrl+Shift+M`. O atalho alterna o microfone somente numa chamada ativa; não é
push-to-talk. Se outro aplicativo ocupar o atalho, o Scale informa a falha e o
mantém desligado. A preferência vale nesta execução. O main envia apenas um
evento DOM literal à página principal da origin configurada: não há preload
remoto, IPC remoto nem API privilegiada exposta à página.

**Notificações:** em **Aplicativo e notificações**, ative os alertas opcionais.
No desktop há confirmação nativa adicional, por servidor e somente nesta
sessão. São alertas genéricos de menção e mensagem privada recebida, sem texto
da conversa; aparecem quando a página está oculta. Não há push com app fechado.

**Energia e recuperação:** a janela principal mantém os timers ao ficar oculta.
Um bloqueio de suspensão automática do aplicativo existe durante reprodução de
mídia observada pelo Electron; não detecta sozinho chamada com captura local
sem reprodução, não impede suspensão manual/fechamento da tampa e não mantém a
tela acesa. O bloqueio é liberado na pausa, navegação, suspensão, encerramento
ou crash do renderer. A retomada envia evento à página para recuperar a
conexão sem recarregar uma chamada; um crash pede confirmação para reabrir o
servidor. Isso usa recursos do cliente, sem trabalho periódico novo na VPS.

**Instalação web:** o frontend também tem manifest e instalação opcional pelo
navegador. O service worker guarda somente assets públicos selecionados e
uma página genérica de indisponibilidade; não guarda salas, tickets, mensagens,
API nem downloads. Uma nova versão espera todas as janelas antigas fecharem,
sem recarregar chamadas. A instalação depende de HTTPS/origin estável e do
suporte do navegador; URLs efêmeras do túnel mudam sua identidade.

## Desenvolvimento

```bash
npm install                 # na raiz
npm run dev:desktop         # build + abre apontando para http://localhost:8090 (stack Docker)
npm run build -w scale-desktop
npm run test -w scale-desktop
npm run lint -w scale-desktop
```

- `--dev` (só fora do pacote) habilita DevTools e o override `--server=<url>`
  (não é salvo). `--profile=<pasta>` isola config/cookies (útil em testes).
- Se a variável `ELECTRON_RUN_AS_NODE` estiver definida no shell (alguns
  terminais de IDE baseados em Electron a definem), o Electron sobe como Node e
  o app falha com `Cannot read properties of undefined (reading 'isPackaged')`.
  Remova-a antes: `env -u ELECTRON_RUN_AS_NODE npm run dev:desktop`.

## Gerar instalador

```bash
npm run dist:desktop
```

Saída: `release/desktop/Scale-Setup-<versão>-x64.exe` (NSIS, por usuário,
permite escolher a pasta). O hook `scripts/after-pack.cjs` grava os fuses do
Electron antes do instalador. Sem certificado de assinatura configurado o
instalador sai **sem assinatura** (SmartScreen vai alertar).

## Segurança (resumo)

| Item | Onde |
|------|------|
| `contextIsolation`, `sandbox`, `webSecurity`, sem `nodeIntegration`/`webviewTag`/conteúdo inseguro | `src/main/security.ts` (`secureWebPreferences`) |
| Página remota sem preload; preloads mínimos só nas telas locais | `src/main/mainWindow.ts`, `src/preload/*` |
| Telas locais via `scale-app://local` (sem privilégios de `file://`) | `src/main/localProtocol.ts`, `src/core/localAsset.ts` |
| Navegação / `window.open` só na origin; `https:` externo no navegador | `src/core/navigation.ts`, `src/main/security.ts` |
| Permissões: microfone/captura da origin; saída só frame principal; notificações com consentimento nativo por sessão | `src/core/permissions.ts`, `src/main/security.ts` |
| Seletor de tela próprio | `src/main/picker.ts`, `src/renderer/picker/*` |
| IPC: remetente conferido + zod | `src/main/ipcGuard.ts`, `src/core/ipcSchemas.ts` |
| Instância única, sem DevTools em produção, CSP nas telas locais | `src/main/main.ts`, `src/main/paths.ts`, `src/renderer/*/index.html` |
| Fuses | `scripts/after-pack.cjs` |

## Pendências

- Assinatura de código (certificado EV/OV) para o instalador e o executável.
- Auto-update do app (o front já atualiza sozinho; só o shell Electron precisa).
- Builds macOS e Linux (código é multiplataforma; falta alvo, ícone `.icns` e
  assinatura/notarização no macOS).
