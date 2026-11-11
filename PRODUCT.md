<!-- impeccable:product-schema 1 -->

# Scale

## Produto e plataforma
Scale é um aplicativo de salas de voz, compartilhamento de tela e chat para 2 a 8 pessoas. A plataforma principal é web (Next.js com export estático); o cliente Electron abre a mesma aplicação. O áudio e a tela usam WebRTC P2P. O servidor mantém autenticação, sinalização e os recursos persistentes de texto.

## Público e trabalho
Amigos que conversam e jogam, e equipes que se reúnem e trabalham juntas. O sucesso é encontrar ou criar uma sala ou comunidade, convidar pessoas e conversar com clareza; amizades e mensagens privadas complementam esse fluxo.

## Fatos e limites
Conta é necessária para criar salas e listar salas públicas. Um convidado pode entrar pelo link ou código. Salas podem ser temporárias, persistentes ou privadas. Comunidades exigem convite e têm canais de texto e salas de voz, além das salas soltas. Há chat de sala com arquivos, amizades, pedidos e DM de texto. Não há gravação; navegar para outra página desmonta a chamada. Não apresentar voz persistente entre rotas. O desktop nativo em Rust (`apps/desktop-native`) é uma interface própria que fala a mesma API.

## Compromissos confirmados pelo usuário
Renovar a identidade preservando o PNG existente da marca, cuja direção é azul-violeta. Inspirar a organização visual do Discord sem copiar sua marca ou aparência. A experiência precisa parecer profissional, intencional e acessível. Verde fica reservado à presença/estado positivo, nunca como acento estrutural. Escolha confirmada: implementação code-first diretamente no aplicativo local.

## Restrições
Preservar APIs, room tickets, permissões, dispositivos, configurações e preferências salvas. Sem bibliotecas novas de ícones; usar SVG interno. Sem novas dependências ou fontes remotas. Nenhum dado de atividade ou pessoa fictício na interface. Responsividade e teclado são requisitos da entrega.
