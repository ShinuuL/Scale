# Estado de implantação e pendências

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
