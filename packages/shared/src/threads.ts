import { z } from 'zod';
import { CHAT_MESSAGE_MAX } from './limits.js';

/* ─── Fase 4: topicos (threads) de canal de texto ───────────────────── */
export const CHANNEL_THREAD_NAME_MAX = 80;
export const channelThreadNameSchema = z.string().trim().min(1).max(CHANNEL_THREAD_NAME_MAX);
/** Abrir topico a partir de uma mensagem do canal. */
export const channelThreadCreateSchema = z.object({ name: channelThreadNameSchema });
/** Arquivar/desarquivar (quem gerencia mensagens). */
export const channelThreadArchiveSchema = z.object({ archived: z.boolean() });
/** Mensagem no topico: so texto, sem resposta (citacao). */
export const channelThreadMessageSendSchema = z.object({ content: z.string().trim().min(1).max(CHAT_MESSAGE_MAX) }).strict();

/** Resumo do topico (na mensagem de origem e no cabecalho do painel). */
export const channelThreadSummarySchema = z.object({
  id: z.string(),
  channelId: z.string(),
  rootMessageId: z.string(),
  name: z.string(),
  replyCount: z.number().int().min(0),
  lastReplyAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdById: z.string(),
});
/** `channel:thread`: topico criado, com resposta nova, arquivado ou desarquivado. */
export const channelThreadEventSchema = z.object({ channelId: z.string(), thread: channelThreadSummarySchema });

export type ChannelThreadSummary = z.infer<typeof channelThreadSummarySchema>;
export type ChannelThreadEvent = z.infer<typeof channelThreadEventSchema>;

/** Texto do rodape da mensagem de origem: "N respostas". */
export const formatThreadReplies = (count: number): string => (count === 1 ? '1 resposta' : `${count} respostas`);
