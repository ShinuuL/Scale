# Estado de implantação e pendências

## 2026-11-12 — nova landing "Escamas do dragão"

Branch `feat/nova-landing`, local. Landing refeita do zero com identidade própria (azul-noite, gradiente do logo, Sora) e cenas guiadas pela rolagem com `motion`. Código em `apps/web/src/components/landing/`. Vitest 272/272, build ok (rota `/` 67,6 kB, First Load 283 kB). Pendente: conferir em aparelho real (celular e Safari) e deploy.

## 2026-11-09 — comunidades (servidor + web) e desktop nativo Rust (R1)

Estado local, sem commit e sem implantação. Branch `feat/scale-interface`.
Plano e contrato: `docs/plano-comunidades-desktop-nativo.md`.

- Servidor: comunidades só por convite (código 128 bits, só hash no banco, até 7 dias,
  `maxUses`, aceite atômico), cargos OWNER/ADMIN/MEMBER, canais TEXT/VOICE como `Room`
  com `communityId`, chat de canal REST + socket (`community:subscribe` com `voiceStates`,
  edição/exclusão), membership checada em `join-room`, histórico, arquivos e TURN.
  Requer `prisma db push` (tabelas novas e colunas anuláveis em `Room`).
  **294 testes** verdes; lint (2 avisos antigos) e tsc ok. Revisão cruzada (Kimi) sem
  crítico/alto; médio e baixos corrigidos.
- Web: `/communities` (trilho, canais, chat, membros; gavetas abaixo de 1024px, membros
  abaixo de 1280px), `/invite#código`, `next` restrito a `/invite` e `/communities`.
  **212 testes**, lint e build ok. Validado no navegador com banco descartável: login com
  `next`, layout de 4 colunas, envio em tempo real, convite gerado e mostrado uma vez.
  Erro antigo de tsc em `useRoomDeleted.test.ts:37` não é deste trabalho.
- Desktop nativo `apps/desktop-native` (Rust, egui): conectar ao servidor, login
  e-mail/senha (JWT do `Set-Cookie` no keyring), comunidades, canais de texto em tempo
  real, convites, DMs. Cliente Socket.IO v4 próprio com ack. **34 testes**, clippy limpo.
  `cargo packager --release --formats deb,appimage` gera `.deb` e AppImage (~12 MB) em
  `target/dist`; abriu no Wayland sem erro. Sem voz/tela ainda.

Pendências: R2 voz nativa (webrtc-rs + cpal + Opus, interop com o navegador), R3/R4 tela;
instalador Windows (`.msi`/NSIS) só via `cargo-xwin` ou Actions `windows-latest`
(`apps/desktop-native/ci/build.yml`, não testado); assinatura de código no Windows;
OAuth no nativo; validação com leitor de tela e em celular; UX: Editar/Apagar sempre
visíveis (no estilo Discord seriam no hover) e `/communities` sem comunidade escolhida
mostra o texto de "criar" mesmo com comunidades existentes. `.tmp/visual/` é ambiente
descartável de teste (contas `*@scale.test`), pode apagar. `stash@{0}` (autostash do pull)
tem só restos de uma tentativa interrompida e pode ser descartado.

## 2026-11-06 — implementação local de PWA, mídia, desktop e VPS

Estado local, sem implantação na VPS. A análise histórica abaixo usa o HEAD
`706075f`; os achados daquele baseline não descrevem todas as mudanças atuais.

Entregas:

- PWA: manifest, instalação opcional, service worker limitado a assets públicos
  e página offline genérica; atualização aguarda fechar as janelas antigas.
- Mídia: seleção de entrada/saída conforme suporte, áudio de tela separado do
  microfone, atualização de ICE/TURN e recuperação sem recarregar a chamada.
- Desktop: bandeja, fechar para ocultar quando disponível, toggle global do
  microfone opcional, consentimento de notificações e recuperação após suspensão.
- Alertas opcionais com página oculta: menções em sala e DMs recebidas em
  `/friends`; não cobrem todas as rotas nem aplicativo fechado.
- Backend: quota com exclusão mútua por sala, limite em streaming, transação e
  compensação; avatar em streaming com concorrência limitada; GC inicial/diário
  em lotes e exclusão retomável, preservando retenção de sete dias.
- Infra: rotação de logs; backup SQLite online com anexos referenciados,
  publicação atômica, retenção por dias/quantidade e teste de restauração isolado;
  métricas restritas a admin; TURN para convidados com ticket e segredo REST
  opcional para credenciais temporárias.

Evidências locais: backend **207 testes**; backup **5 testes** com SQLite WAL e
Docker simulado; PWA **24 testes**; desktop **103 testes**, lint e TypeScript;
chat **34 testes**; mídia **47 testes dirigidos**. Lint, testes e builds globais
(shared, backend, web e desktop) passaram; testes/build completos do frontend
foram repetidos após o ajuste de TURN. Permanecem dois avisos de console
preexistentes no backend. Compose base e overlay de produção foram validados
com valores sintéticos; detector de glifos da UI retornou `[]`.

Teste local disponível em **http://localhost:18480**, backend/proxy saudáveis,
com HOME, `/health`, API, manifest e service worker respondendo HTTP 200; CSP
inclui `worker-src 'self'` e `manifest-src 'self'`. Projeto Docker isolado
`scale-validation-20261106-204856`, portas somente em loopback, banco vazio e
volumes exclusivos com esse prefixo; dados descartáveis e sem túnel/TURN.
O build Docker concluiu, porém a imagem do proxy apresentou arquivos zerados
e falhou no Caddy (`adapting config using caddyfile: EOF`). O runtime local foi
recuperado **somente no override temporário** com binds de leitura do Caddyfile,
CSP e export local já compilado. A imagem autocontida ainda requer diagnóstico;
não está validada para implantação. Serviços mantidos em execução. Para parar,
sem remover volumes:

```bash
docker compose --env-file /dev/null -p scale-validation-20261106-204856 -f docker-compose.yml -f .tmp/validation/compose.yml down
```

E2E em navegador, áudio/hardware real e Windows não foram validados nesta etapa.

Pendências: overlay, PTT por pressionar/soltar e Web Push com app fechado;
áudio real no Windows, TURN em redes restritas, chamada com oito peers,
instalação/uso minimizado e retomada em hardware; capacidade/custos da VPS.
Locks de quota pressupõem **uma instância backend**. Pipeline de imagens
pré-compiladas e backup incremental/deduplicado não foram implementados.
Auditoria de dependências de produção encontrou **11 vulnerabilidades
preexistentes (1 crítica, 7 altas, 3 moderadas)**; sem upgrades nesta tarefa.
Esses testes não equivalem a auditoria de segurança nem aprovação de produção.

Detalhes: [desktop](./desktop.md), [operação e backup](./vps-deploy.md),
[análise histórica](./analise-pwa-recursos-vps.md).

## 2026-11-06 — análise de PWA, recursos e VPS

Baseline analisado: HEAD `706075f`. Entrega documental em
[analise-pwa-recursos-vps.md](./analise-pwa-recursos-vps.md), sem alteração
funcional, acesso à VPS, medições ou testes de hardware.

Constatado no código: frontend estático sem implementação PWA; Electron abre
o frontend remoto; voz e tela existem, mas áudio do sistema não é solicitado
nem enviado pelo hook web. Não há seleção de entrada/saída, notificações,
bandeja, atalhos globais, PTT ou overlay implementados.

Recomendação registrada: manter web e Electron compartilhando o núcleo;
adicionar PWA para instalação e recursos desktop conforme demanda.

Pendências: definir fluxo de áudio de tela; implementar e validar seleção de
dispositivos; avaliar TURN para convidados e redes restritas; testar retomada de
suspensão, chamada minimizada e cenários com 2/4/8 peers; medir VPS e relay antes
de estimar capacidade. Nenhuma dessas funcionalidades foi entregue nesta análise.

Verificações: `npm run lint` falhou no frontend (`next: not found`); etapa
`build:shared`/lint TypeScript passou; ESLint do servidor teve zero erros e
três avisos. Build não executado por dependência faltante. Compose config
impedido por `.env` ausente. Não foram instaladas dependências ou iniciados
serviços. `git diff --check` passou; não houve testes de hardware/VPS.

## 2026-11-07 — redesign de interface

Na branch `feat/scale-interface`, foram atualizadas a identidade visual, a navegação shell, as rotas Salas/Amigos/Ajuda, os estados
de carregamento/erro/vazio, os controles de sala, chat, dispositivos e diálogos
de saída. A sessão da home distingue falha de autenticação de visitante; o
painel de dispositivos e o painel PWA fecham com Escape e restauram foco.

Verificações finais: `npm run lint` global sem erros (dois avisos
`no-console` preexistentes no backend); `npm run test -w scale-frontend`
passou com **178 testes**; `npm run build` global passou antes dos últimos
ajustes só de frontend, seguido por `npm run build -w scale-frontend` após eles.
O export estático e a CSP geraram 10 páginas e 29 hashes. Detector Impeccable
retornou `[]`; `git diff --check` passou.

QA local com Chrome em `http://localhost:18480` e instância descartável isolada:
home/login/cadastro/navegação; usuário sintético e convidado na sala; cabeçalho
e overflow em 1280/390/320 px; chat e dispositivos; confirmação de saída,
Escape/cancelamento e foco; painel PWA com retorno de foco. Sem `pageerror`, CSP,
React ou hydration. As únicas respostas HTTP em erro foram 401 do `GET
/api/auth/me` enquanto anônimo e 404 de avatar ausente de participantes; ambas
esperadas nesses estados. Áudio/hardware real, permissões de microfone e TURN
não foram validados; nenhuma captura de tela foi salva. Preview atualizado em
**http://localhost:18480**, backend e proxy saudáveis; o projeto de validação
original permanece em execução, com seus dados preservados.


## 2026-11-07 — conciliação do redesign com main para o PR #4

A branch `feat/scale-interface` incorporou a `main` por merge, preservando o
redesign e os recursos já existentes na base: chamadas entre amigos e convites
para a sala, login por @nome, Google/GitHub e vinculação de contas, seleção
global de microfone/saída nas Configurações e indicadores de fala. Os seletores
de áudio participam do foco preso do diálogo; erros de ligação permanecem
visíveis no conteúdo principal em telas pequenas. Sala apagada remotamente
encerra a mídia e volta à home com aviso, liberando a guarda de navegação.

Validação do código conciliado em worktree descartável, sem sobrescrever o
export/CSP do preview ativo: **192 testes frontend aprovados**, lint global sem
erros (dois avisos `no-console` preexistentes), build global shared/backend/web
aprovado e `git diff --check` sem achados. O cliente Prisma foi gerado somente
na worktree para refletir o schema atual, sem conexão ou migração de banco.
Compose base e overlay de produção validados com entradas sintéticas e sem
resolver arquivos de ambiente reais. Export: 10 páginas e 29 hashes CSP.

Smoke em Chrome headless, servidor estático temporário e API mockada: login
por e-mail/@nome e links Google, cadastro com @nome e Google, erro 429 de
ligação visível em 390 px e navegação em 1280 px; nenhum `pageerror`. Não houve
login OAuth real, chamada em rede ou teste adicional de hardware/áudio/TURN.
A instância anterior de preview, seus volumes e serviços foram preservados.
A pendência preexistente da imagem Docker autocontida do proxy continua aberta;
esta etapa não realizou deploy nem merge do PR na main.
