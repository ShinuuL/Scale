# Scale — identidade visual

A referência normativa de cores, tipografia, layout e componentes está em [DESIGN.md](../DESIGN.md). O contexto de produto e as restrições confirmadas estão em [PRODUCT.md](../PRODUCT.md).

O Scale organiza salas, voz, tela e conversa para amigos e equipes. A organização espacial se inspira em aplicativos como Discord: navegação global, contexto e tarefa principal. A identidade é própria, grafite frio com acento azul-violeta ligado ao logo existente; verde fica reservado à presença ou sucesso.

O PNG `apps/web/public/logo.png` continua sendo a fonte da verdade. Marca, favicon, ícones PWA e imagem Open Graph existentes foram preservados. O componente Logo usa esse PNG; nenhum novo desenho ou efeito de brilho foi aplicado. O arquivo SVG legado não substitui o PNG na aplicação.

## Aplicação

- Fundos `#1c1d23`, contexto `#17181e`, superfície `#25262e` e linhas `#32343f`.
- Acento de leitura/foco `#a5aaff`; ação sólida `#6263da` com texto branco.
- Tipografia sans nativa do sistema, sem download de fonte. Escala de interface 14/16/20/28px.
- Navegação global, contexto e tarefa no desktop; contexto em dialog abaixo de 1024px e navegação inferior abaixo de 640px. Header de 64px no desktop e automático, com mínimo de 64px e quebra de ações, no mobile.
- SVG interno em `components/ui/Icon.tsx`, sem emojis ou biblioteca nova de ícones.

## Preferências e acessibilidade

O tema padrão é Íris. A chave legada `jade` permanece para compatibilidade de armazenamento, com valores atuais azul-violeta. Grafite e Safira variam somente o acento; a estrutura visual é consistente. O script de tema externo continua aplicando a escolha antes da primeira pintura, sem mudar a CSP.

A identidade inclui foco visível, scroll perceptível, respeito à redução de movimento e estados de erro/vazio/carregamento. Controles principais têm mínimo de 44px; o chat ainda contém ações de 40px e ações inline menores. Os contrastes dos pares sólidos principais estão calculados em DESIGN.md. As classes legadas `glass` usam superfícies opacas, borda e nenhum blur.

A conferência documental se baseia em código, tokens e cálculo de contraste. Não representa aprovação visual por imagens, revisão manual com leitor de tela ou validação em dispositivos reais.

Voz e tela usam WebRTC P2P conforme o contrato do produto. O redesign não adiciona gravação, comunidades, servidores, canais ou continuidade de chamada entre rotas. As cores e símbolos de estado acompanham os dados reais.
