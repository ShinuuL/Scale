import { describe, expect, it } from 'vitest';
import { channelMessagesReducer, type ChannelMessagesState } from '../useChannelMessages';

const initial: ChannelMessagesState = { channelId: 'a', cursor: null, loading: false, error: '', messages: [
  { id: '1', channelId: 'a', author: { id: 'u', name: 'Ana', username: null }, content: 'um', createdAt: '2026-01-01T00:00:00Z', editedAt: null, deletedAt: null },
  { id: '2', channelId: 'a', author: { id: 'u', name: 'Ana', username: null }, content: 'dois', createdAt: '2026-01-01T00:00:00Z', editedAt: null, deletedAt: null },
] };

describe('reducer de mensagens do canal', () => {
  it('edita e apaga somente a mensagem indicada', () => {
    const edited = channelMessagesReducer(initial, { type: 'edit', event: { channelId: 'a', messageId: '2', content: 'alterada', editedAt: 'agora' } });
    expect(edited.messages.map(message => message.content)).toEqual(['um', 'alterada']);
    const deleted = channelMessagesReducer(edited, { type: 'delete', event: { channelId: 'a', messageId: '1', deletedAt: 'agora' } });
    expect(deleted.messages.map(message => message.deletedAt)).toEqual(['agora', null]);
  });
  it('ignora eventos de outro canal', () => {
    expect(channelMessagesReducer(initial, { type: 'edit', event: { channelId: 'b', messageId: '1', content: 'x', editedAt: 'agora' } })).toBe(initial);
    expect(channelMessagesReducer(initial, { type: 'delete', event: { channelId: 'b', messageId: '1', deletedAt: 'agora' } })).toBe(initial);
    expect(channelMessagesReducer(initial, { type: 'message', message: { ...initial.messages[0], channelId: 'b' } })).toBe(initial);
  });
});
