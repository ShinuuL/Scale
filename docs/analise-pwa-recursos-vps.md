# Scale: PWA, recursos de comunicação e VPS

Data: 2026-11-06. Baseline: HEAD `706075f`.

> **Análise histórica do baseline:** recomendações foram implementadas em parte
> após esta análise. Consulte o [estado atual da implementação](./implantacao.md)
> para entregas, verificações e pendências. Os achados abaixo foram preservados
> como registro do HEAD analisado; não constituem avaliação do código atual.

## Escopo e limites

Análise estática do repositório. Não houve acesso à VPS, coleta de métricas,
execução de testes em hardware ou alteração funcional. As capacidades indicadas
como viáveis ainda exigem implementação e validação. A comparação usa como
referência o uso cotidiano do Discord: voz, escolha de dispositivos, tela com
áudio, notificações, funcionamento minimizado, atalhos e push-to-talk.

O frontend é Next.js com exportação estática, servido pelo Caddy; API e
Socket.io ficam no mesmo origin. O Electron abre esse frontend remoto e não o
empacota. A arquitetura de mídia permanece WebRTC mesh, com limite de oito
peers, independentemente da forma de instalação.

Evidências: [exportação e origin](../apps/web/next.config.js#L5-L28),
[proxy](../Caddyfile#L40-L49), [limite de peers](../apps/web/src/hooks/useWebRTC.ts#L54-L57)
e [janela remota](../apps/desktop/src/main/mainWindow.ts#L23-L35).

## PWA e uso semelhante ao Discord

O frontend ainda não implementa uma PWA: há metadados e ícones, mas a inspeção
não encontrou manifest, registro de service worker ou fluxo de instalação.
A exportação estática existente facilita adicionar esses recursos. Instalar
como PWA mantém as capacidades e restrições do navegador; não concede APIs
nativas de Electron.

| Recurso | Web/PWA: estado e viabilidade | Electron atual e evolução |
| --- | --- | --- |
| Voz | Implementada via microfone e WebRTC; exige contexto seguro. | Reutiliza o mesmo código. Não há engine de voz nativa separada. |
| Seleção de entrada/saída | Hoje usa dispositivos padrão. Não foram encontrados `enumerateDevices`, `deviceId`, `selectAudioOutput` ou `setSinkId`. Seleção é viável, com detecção de suporte e fallback. | Também não tem seleção própria; pode reutilizar a implementação web. |
| Tela | Implementada, com `getDisplayMedia`. Browser exige escolha e permissão por captura. | Tem seletor próprio de telas/janelas. |
| Áudio da tela/sistema | Não implementado: a captura pede `audio:false` e só envia vídeo. Browser/SO determinam fontes de áudio disponíveis; pedir áudio não garante recebê-lo. | Picker tem loopback preparado apenas no Windows, condicionado ao pedido de áudio da página. Como o frontend não pede, também não funciona hoje. |
| Notificações | Não implementadas. Notificações com página aberta e Web Push com página fechada são entregas distintas; Push exige service worker e suporte no backend. | Não implementadas. A allowlist atual nega notificações web; notificações nativas exigem integração explícita. |
| Minimizar/fechar | Chamada com janela minimizada precisa validação por navegador/SO; service worker não mantém chamada após fechar a página. | Não há bandeja nem política explícita de energia/background. Fechar todas as janelas encerra o app; minimizar não é o mesmo que fechar. |
| Atalhos globais e PTT | Atalhos na página são viáveis com foco. PWA não fornece atalho global para comandar o mic enquanto outro aplicativo tem foco. | Não implementados. `globalShortcut` permite atalhos sem foco; PTT por pressionar/soltar exige avaliar captura de eventos e permissões por SO, além de um atalho de toggle. |
| Overlay | Não há overlay. Janelas web não oferecem integração equivalente a um overlay de jogo. | Possível entrega própria, com limitações por SO/jogo. Uma janela sobreposta não garante compatibilidade com fullscreen exclusivo ou anti-cheat. |
| Arquivos e clipboard | Input de arquivo, download via fetch/blob e cópia de texto já usam APIs web. Não exigem Electron para o comportamento atual. | Usa as mesmas APIs; não há integração nativa adicional para esses fluxos. |

Evidências por recurso:

- Metadados e ícones: [layout](../apps/web/src/app/layout.tsx#L6-L21).
- Voz mono com processamento de eco, ruído e ganho:
  [constraints](../apps/web/src/hooks/useWebRTC.ts#L69-L76) e
  [captura sem câmera](../apps/web/src/hooks/useWebRTC.ts#L558-L561).
- Captura de tela sem áudio e envio apenas de vídeo:
  [hook](../apps/web/src/hooks/useWebRTC.ts#L742-L759).
- Loopback Windows condicionado ao pedido da página:
  [plataforma](../apps/desktop/src/main/picker.ts#L29-L30),
  [disponibilidade](../apps/desktop/src/main/picker.ts#L75-L77) e
  [callback de captura](../apps/desktop/src/main/picker.ts#L122-L141).
- Permissões limitadas a microfone e tela:
  [allowlist](../apps/desktop/src/core/permissions.ts#L3-L4) e
  [validação](../apps/desktop/src/core/permissions.ts#L21-L29).
- Encerramento com todas as janelas fechadas:
  [main](../apps/desktop/src/main/main.ts#L78-L80).
- Preferências atuais da janela:
  [janela](../apps/desktop/src/main/mainWindow.ts#L23-L35) e
  [segurança](../apps/desktop/src/main/security.ts#L27-L44).
- Aceleradores existentes são de menu, sem PTT:
  [menu](../apps/desktop/src/main/menu.ts#L10-L29).
- Arquivos: [input](../apps/web/src/components/ChatPanel.tsx#L356) e
  [download](../apps/web/src/lib/roomAccess.ts#L24-L45).
- Clipboard: [cópia e fallback](../apps/web/src/lib/clipboard.ts#L5-L32).

### Áudio de tela exige mudança no fluxo de mídia

Trocar `audio:false` por `audio:true` é insuficiente. O envio atual adiciona
somente a trilha de vídeo. No recebimento, toda trilha de áudio ocupa o mesmo
campo `existing.stream`, substituindo a referência anterior. Existe um único
player de áudio por peer.

Antes de implementar, escolher entre misturar microfone e loopback em uma
trilha ou transportar/reproduzir áudio de tela separadamente. A decisão deve
cobrir mute de microfone, deafen, volume, parada da captura, entrada de novos
peers, renegociação e prevenção de eco. O loopback atual representa áudio do
sistema; não há implementação de isolamento do áudio de um aplicativo.

Evidências: [envio](../apps/web/src/hooks/useWebRTC.ts#L751-L759),
[recebimento](../apps/web/src/hooks/useWebRTC.ts#L340-L371) e
[player por peer](../apps/web/src/components/room/VideoGrid.tsx#L58-L90).

### Ciclo de vida e conectividade

O socket tenta reconectar dez vezes, com atraso inicial de um segundo e
timeout de vinte segundos. O evento de conexão dispara callbacks para
reentrada; isso não substitui testar retomada depois de suspensão longa.
O hook de mídia evita recapturar um microfone que ainda tem trilha ativa.

TURN é buscado por API; qualquer falha cai em STUN. O código trata 401 de
convidados como uso sem TURN. Em rede que exige relay, isso pode impedir a
chamada de um convidado mesmo que a interface e o signaling carreguem. A
instalação PWA ou Electron não resolve essa dependência de rede.

Evidências: [reconexão](../apps/web/src/hooks/useSocket.ts#L94-L118),
[mídia idempotente](../apps/web/src/hooks/useWebRTC.ts#L525-L532) e
[fallback de TURN](../apps/web/src/hooks/useWebRTC.ts#L114-L136).

## Recomendação e prioridades

Manter web como núcleo compartilhado e Electron como cliente para os recursos
de desktop. Adicionar PWA como conveniência de instalação e acesso ao serviço,
sem apresentá-la como substituta de toda a experiência desktop do Discord.

1. **Prioridade alta — mídia compartilhada:** seleção de entrada/saída,
   tratamento de troca/desconexão de dispositivo e áudio da tela com fluxo de
   mídia definido. Validar primeiro Windows em Chrome, Edge e Electron.
2. **Prioridade alta — confiabilidade:** conectividade em redes restritas,
   cobertura TURN para convidados, retomada de suspensão e recuperação após
   reconexões esgotadas. Medir mídia com 2, 4 e 8 peers antes de aumentar escopo.
3. **Prioridade seguinte — desktop:** bandeja e semântica fechar/sair,
   notificações, atalhos globais e política de energia durante chamada.
   O renderer remoto hoje não tem preload; qualquer ponte nova deve expor
   operações mínimas e validar origin, frame, payload e estado no main.
4. **Prioridade seguinte — PWA:** manifest, ícones de instalação, janela
   standalone, estratégia de atualização e estado de indisponibilidade.
   Service worker deve cachear apenas assets públicos adequados; não guardar
   indiscriminadamente API, tickets, arquivos ou conteúdo autenticado.
5. **Depois de validar demanda:** PTT global por pressionar/soltar, overlay e
   suporte explícito a outros sistemas operacionais.

A implementação PWA deve usar origin HTTPS estável: a URL efêmera do túnel
muda a identidade de instalação, permissões, storage e sessão. O Caddy atual
já revalida HTML e usa cache imutável em assets com hash; a estratégia do
service worker precisa respeitar atualizações coordenadas do cliente/API.

Evidências: [sem preload remoto](../apps/desktop/src/main/mainWindow.ts#L33-L34),
[isolamento](../apps/desktop/src/main/security.ts#L27-L44) e
[cache do Caddy](../Caddyfile#L76-L80).

## Plano de validação

- **Base:** Windows com Chrome, Edge e Electron empacotado. Registrar versões,
  hardware, tipo de rede e estado das permissões. Outros SO entram conforme
  demanda, sem presumir paridade de áudio do sistema, saída de áudio ou atalhos.
- **Voz/dispositivos:** testar microfone e saída padrão, seleção explícita,
  headset USB/Bluetooth, remoção/reconexão, mute/deafen, áudio após primeiro gesto
  e entrada em chamada antes/depois de conceder permissão.
- **Tela/áudio:** tela e janela, aceitar/cancelar picker, áudio disponível ou
  ausente, parar pelo navegador/SO, compartilhar novamente, microfone simultâneo,
  deafen e peer que entra enquanto a tela já está ativa.
- **Background:** chamada prolongada minimizada, troca de foco para jogo/app,
  bloquear/desbloquear sessão e suspender/retomar o computador. Distinguir
  minimizar, fechar janela e sair. Verificar mic, playback, socket e peers.
- **Escala:** 2, 4 e 8 peers, voz e tela; medir CPU, memória, upload/download,
  perda, RTT, jitter e quadros, comparando navegador e Electron no mesmo cenário.
- **Rede:** LAN, redes distintas, NAT/rede restrita com TURN, relay forçado em
  ambiente de teste, falha de TURN, convidado versus logado, troca de rede e
  queda superior à janela de reconexão automática.
- **Integrações futuras:** notificações com app focado, minimizado e fechado;
  conflito de atalhos; pressionar/soltar PTT e recuperação de tecla após perda de
  foco; atualizar frontend durante chamada sem recarregamento destrutivo.

## VPS: riscos e melhorias priorizadas

Frontend estático, API/signaling e mídia têm perfis distintos. Mídia direta
entre peers não percorre o servidor de aplicação; relay TURN entra no cálculo
de banda/custo. PWA ou Electron não altera essa topologia por si só. Não há
evidência para prometer capacidade, percentuais de economia ou operação em 512 MB.

| Prioridade | Evidência e risco | Ação recomendada, ainda não implementada |
| --- | --- | --- |
| Alta | [files.ts:57](../apps/server/src/routes/files.ts#L57), [:85-109](../apps/server/src/routes/files.ts#L85-L109): quota é lida antes de uploads concorrentes. [:127-137](../apps/server/src/routes/files.ts#L127-L137): persistência dos metadados fora da compensação pode deixar arquivo órfão. | Reservar quota atomicamente ou serializar por sala e compensar falhas disco/banco. Testar uploads paralelos no limite. |
| Alta | [server.ts:83-87](../apps/server/src/server.ts#L83-L87): primeiro GC só após 24h. [uploads.ts:94-106](../apps/server/src/lib/uploads.ts#L94-L106): linha pode ser apagada mesmo após falha de unlink. [roomDeletion.ts:26-36](../apps/server/src/lib/roomDeletion.ts#L26-L36): metadados saem antes dos arquivos. | GC inicial em lotes e exclusão retomável, preservando retenção de sete dias. Não perder a referência de arquivos cuja remoção falhou. |
| Alta | [backup.sh:13-16](../deploy/backup.sh#L13-L16) gera arquivo completo SQLite/uploads a cada [deploy.sh:25-31](../deploy/deploy.sh#L25-L31); cron também é sugerido. | Medir tamanho, duração, I/O e restauração; avaliar backup incremental/deduplicado, snapshot consistente e retenção por quantidade. |
| Média | [profile.ts:129-149](../apps/server/src/routes/profile.ts#L129-L149): avatar é materializado em buffer até 32 MB. | Avaliar streaming, limite de concorrência e miniaturas para exibição. Medir memória com uploads simultâneos. |
| Alta | [turn.ts:47-68](../apps/server/src/routes/turn.ts#L47-L68): credencial estática; [fallback convidado](../apps/web/src/hooks/useWebRTC.ts#L120-L128) para STUN. | Preservar TURN; avaliar credenciais temporárias e política para convidados. Medir relay e validar redes restritas. |
| Média | [Compose](../docker-compose.yml) sem limites de recursos e rotação explícita de logs. | Configurar rotação; medir antes de definir limites que possam matar chamada/backend. |
| Média | [deploy.sh:31](../deploy/deploy.sh#L31) constrói na VPS; [Dockerfile:34](../apps/server/Dockerfile#L34) leva dependências do builder e [:45](../apps/server/Dockerfile#L45) executa `prisma db push` no boot. | Avaliar imagens pré-compiladas, dependências de produção e migração explícita com cuidado com Prisma. Medir ganho de rever os dois Caddy; não alterar o Nexus nesta tarefa. |
| Alta | [metrics rota:59-84](../apps/server/src/routes/metrics.ts#L59-L84) não expõe RSS/heap; [helper](../apps/server/src/lib/metrics.ts#L14) existe isoladamente. `chatFilesBytes` é acumulado desde boot, não ocupação em disco. | Instrumentar RSS/heap, CPU, latência, event loop, I/O, disco real, backups e relay; comparar cenários 2/4/8 participantes. |

O export estático, cache imutável e compressão já existentes devem ser
considerados na linha de base. Não recomendar SFU indiscriminadamente, remover
TURN ou reduzir qualidade sem medidas e critérios de produto.

## Verificações desta entrega

`npm run lint` falhou no frontend por `next: not found`; a etapa `build:shared`
e seu lint TypeScript passaram. ESLint do servidor: zero erros e três avisos
de console (`uploads.ts:108`, `socket/handler.ts:818,821`). Build não executado
por dependência faltante. `docker compose config --quiet` foi impedido pela
ausência de `.env`. Nenhuma dependência foi instalada nem serviço iniciado.
Verificação documental final: `git diff --check`.

## Fontes primárias

- [MDN — instalação de PWA](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
- [MDN — operação offline/background](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation):
  service workers são orientados a eventos e podem ser encerrados pelo browser.
- [MDN — getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia):
  gesto/permissão por captura e disponibilidade variável de áudio por browser/SO.
- [MDN — selectAudioOutput](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/selectAudioOutput):
  suporte e permissões para escolha de saída.
- [MDN — Notifications](https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API).
- [Electron — desktopCapturer](https://www.electronjs.org/docs/latest/api/desktop-capturer).
- [Electron — globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut):
  atalhos sem foco e particularidades de plataforma.
- [Electron — powerSaveBlocker](https://www.electronjs.org/docs/latest/api/power-save-blocker).
