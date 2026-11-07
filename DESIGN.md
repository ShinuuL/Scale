---
name: Scale
description: Salas de voz, tela e conversa para amigos e equipes.
colors:
  primary: "#a5aaff"
  primary-solid: "#6263da"
  primary-subtle: "#2c2c48"
  background: "#1c1d23"
  context: "#17181e"
  rail: "#111217"
  surface: "#25262e"
  hover: "#2b2d37"
  foreground: "#f2f3f8"
  secondary-text: "#b6b9c8"
  muted-text: "#9298ac"
  border: "#32343f"
  border-strong: "#4c5060"
  online: "#62c49a"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "36px"
    letterSpacing: "-0.025em"
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: "28px"
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "24px"
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: "20px"
rounded:
  control: "6px"
  navigation: "8px"
  surface: "12px"
spacing:
  unit: "4px"
  compact: "8px"
  group: "16px"
  section: "24px"
  workspace: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary-solid}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: "10px 20px"
    height: "44px"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    typography: "{typography.label}"
    padding: "10px 20px"
    height: "44px"
  input:
    backgroundColor: "{colors.context}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
    height: "44px"
---

# Design System: Scale

## Overview

**Creative North Star: "Um espaço para se encontrar".** O Scale tem a organização de um aplicativo de comunicação, com navegação global curta, contexto da tarefa e área principal. A interface atende conversas entre amigos, jogos e reuniões de equipe com a mesma linguagem.

A identidade é grafite frio com azul-violeta derivado do logo existente. A marca aparece no acento, na seleção e no ritmo; a mídia e a conversa ocupam a maior parte do espaço. São características centrais: superfícies foscas, divisórias finas, tipografia nativa legível e ações explícitas.

## Colors

As variáveis canônicas vivem em `apps/web/src/app/globals.css`; o Tailwind expõe `surface.*`, `ink.*`, `line`/`line-strong` e `accent`/`accent-solid`/`accent-subtle`. `brand`, `moss` e `forest` continuam como aliases de compatibilidade, agora dentro desta identidade.

O acento claro destaca seleção, links e foco; a variante sólida oferece contraste para texto branco em ações primárias. Verde comunica presença ou sucesso, vermelho erro/ação destrutiva e âmbar avisos. Nunca usar verde como tema principal.

O tema padrão se chama **Íris**. A chave persistida `jade` é mantida para não perder preferências antigas, mas seus valores foram substituídos pelo azul-violeta. Grafite e Safira ajustam apenas o acento; superfícies, navegação e hierarquia permanecem consistentes. O boot de tema continua em arquivo externo permitido pela CSP.

Contraste calculado a partir das cores sólidas do CSS: texto primário sobre fundo base 15,17:1; secundário sobre base 8,61:1; muted sobre superfície terciária 5,24:1; acento de leitura sobre base 7,84:1. Texto branco sobre ação sólida: Íris 4,87:1, Grafite 5,42:1 e Safira 5,11:1. Esses cálculos verificam os pares indicados; não certificam todas as combinações renderizadas, transparências ou estados da aplicação.

## Typography

A fonte entregue é a sans nativa do sistema. Não há fonte remota, Geist/Inter empacotada nem fonte proprietária de outra marca. A família mono nativa fica reservada a códigos e medidas.

A escala operacional usa 14px para corpo e ações, 16px para cabeçalhos de região, 20px para contexto e 28px para títulos de página. Corpo de apoio usa line-height de 24px; controles usam 20px. Metadados usam 11–12px, e os rótulos da rail usam 10px no desktop e 11px no mobile. Não usar títulos gigantes ou sequências de texto com gradiente. A introdução do tutorial limita a prosa a 65ch; outros conteúdos de ajuda usam contêineres de até 768px.

## Layout

`AppShell` é apenas composição visual: não busca usuário, não cria sockets e não armazena estado de chamada. Recebe `activeSection`, `title`, `contextSidebar`, `actions`, `accountSlot`, `children` e `onNavigate`. O shell contém o único `main#main-content` da tela.

Desktop: rail de 72px, contexto de 232px e área de trabalho flexível com header de 64px. A altura é `100dvh`, com `min-height: 0` nas regiões internas e scroll local visível. De 640 a 1023px a rail mede 64px e o contexto abre em dialog. Abaixo de 640px, a navegação fica no rodapé, com 64px mais safe area; o conteúdo contextual aparece no mesmo dialog. Nesse breakpoint, o header tem altura automática, mínimo de 64px e pode quebrar as ações para outra linha. Somente uma instância do contexto é montada por vez.

Salas usam linhas com ações independentes; busca e lista são prioritárias. Criação fica na coluna de apoio quando há largura e após a lista em telas menores. Amigos, sala, tutorial, documentação e métricas partilham a navegação. Login/cadastro são fluxos focados, sem navegação aninhada.

## Elevation & Depth

Painéis são distinguidos por tom e bordas de 1px, sem blur ou gradientes decorativos. Sombras ficam restritas a menu/popover e diálogo. Scrollbars permanecem perceptíveis. Não usar sombras coloridas ou um cartão dentro de outro para a mesma tarefa.

## Shapes

Controles base têm raio de 6px, itens da rail 8px e superfícies flutuantes 12px. Avatares podem ser circulares; pílulas ficam reservadas a pequenos estados. Botões base, inputs, atalhos de contexto e botões de ícone do shell usam mínimo de 44px. Há controles compactos de 40px no chat e ações inline menores nas mensagens; 44px é a meta para novas ações, não uma garantia universal do código atual. O foco global usa outline de 2px no acento, afastado 3px; inputs usam offset de 2px e componentes podem acrescentar ring.

## Components

Botões primários indicam a próxima ação; secundários oferecem caminhos paralelos e ações destrutivas ficam separadas. Inputs têm label persistente e erro associado por `aria-describedby`. Linhas de sala separam entrar, copiar e excluir, sem controles interativos aninhados.

O componente React `Button` usa peso 500, mínimo de 44px e padding padrão de 10px 20px; `sm` usa 8px 12px e `lg`, 12px 28px. A classe CSS `.btn-primary` usada diretamente mantém peso 600 e padding de 10px 16px. O frontmatter e o sidecar documentam o componente React no tamanho padrão. `Input` usa 14px/20px, padding de 10px 12px e foco explícito; não tem mudança de borda ao hover. `Badge` padrão usa fundo slate-700 (`#334155`) e texto primário; suas variantes carregam as cores semânticas.

O menu de perfil usa posicionamento fixo para não ser cortado pelo scroll. Configurações preservam nome, @nome, avatar e tema. Recursos opcionais de aplicativo/notificações abrem a partir do cabeçalho ou de um summary nas páginas sem shell. Nenhum footer aumenta a altura do aplicativo.

Carregamento, vazio confirmado, falha e acesso restrito são estados distintos. Nunca mostrar pessoas, mensagens, salas ou contagens inventadas. Navegação para outra rota pode desmontar a chamada; o guard de saída pertence à página da sala. Ctrl/Cmd e abertura em nova aba não encerram a chamada atual.

Esta documentação foi conferida por leitura de componentes, CSS e configuração Tailwind, com cálculo de contraste dos pares acima. Não registra aprovação visual por imagens, revisão manual com leitor de tela ou validação em dispositivos reais.

## Do's and Don'ts

- Usar o PNG existente em `public/logo.png`, sem redesenhar a marca.
- Usar apenas os SVGs de `components/ui/Icon.tsx`, com nomes acessíveis nos botões.
- Preservar room tickets, autenticação, dispositivos e contratos externos.
- Usar transições curtas que esclareçam estado, com reduced motion e hover apenas onde há hover.
- Não copiar cores, fonte, rótulos ou recursos do Discord.
- Não esconder scrollbars, simular servidores/canais, usar emojis de UI ou prometer chamada persistente entre rotas.
