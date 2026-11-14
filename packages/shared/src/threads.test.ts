import { describe, expect, it } from 'vitest';
import { channelThreadCreateSchema, channelThreadMessageSendSchema, formatThreadReplies } from './threads.js';

describe('topicos', () => {
  it('nome 1..80 com trim', () => {
    expect(channelThreadCreateSchema.safeParse({ name: '  a  ' }).data?.name).toBe('a');
    expect(channelThreadCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(channelThreadCreateSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
  });
  it('mensagem do topico nao aceita resposta', () => {
    expect(channelThreadMessageSendSchema.safeParse({ content: 'oi' }).success).toBe(true);
    expect(channelThreadMessageSendSchema.safeParse({ content: 'oi', replyToId: crypto.randomUUID() }).success).toBe(false);
  });
  it('formata contagem', () => {
    expect(formatThreadReplies(0)).toBe('0 respostas');
    expect(formatThreadReplies(1)).toBe('1 resposta');
    expect(formatThreadReplies(7)).toBe('7 respostas');
  });
});
