# Comunidades — plano em fases (inspirado em servidores do Discord)

Base atual: canais de texto/voz, cargos com cor e 4 permissoes, convites com
validade/limite, imagens no chat, mencoes, edicao/exclusao, DM entre amigos,
menu de contexto de membro, reordenar comunidades (local).

Restricoes que valem para todas as fases: UI sem emoji (icones de `Icon.tsx`),
zod nos dois lados, mesh de no maximo 8 peers, `prisma db push` do container
nao aceita `@unique` novo em tabela existente (usar tabela propria).

## Fase 1 — base do dia a dia (em implantacao)
| # | Funcao | Escopo |
|---|--------|--------|
| 1 | Presenca online/offline | Membro online = tem socket logado. Evento por comunidade; lista agrupa "Online — N" / "Offline — N". |
| 2 | Nao lidas | Ultima leitura por usuario e canal (tabela nova). Canal em negrito + contador; bolinha no bloco da comunidade; ler ao abrir o canal. |
| 3 | Icone e banner da comunidade | Upload PNG/JPEG/WebP por magic bytes (mesmo desenho do avatar), quem gerencia a comunidade. Bloco mostra a imagem; sem imagem, iniciais. |
| 4 | Categorias e ordem de canais | Categoria opcional por canal, recolhivel (estado local); reordenar canais arrastando/Alt+seta, persistido no servidor (`manageChannels`). |
| 5 | Indicadores no canal de voz | Mutado, sem audio (deafen), falando e "Ao vivo" (tela) ao lado de cada nome conectado. |

## Fase 2 — conversa
Responder mensagem (citacao), reacoes com conjunto fixo de icones, fixar
mensagem, "digitando...", busca no canal, topico do canal.

## Fase 3 — moderacao e organizacao
Permissoes por canal e canal de avisos, modo lento, castigo/banimento com
motivo, registro de auditoria, limite de pessoas por canal de voz (ex. 4/8),
canal de boas-vindas.

## Fase 4 — maiores
Eventos agendados, topicos (threads), apelido por comunidade. Palco fica fora
enquanto o mesh tiver teto de 8.
