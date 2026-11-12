import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api';

afterEach(() => vi.unstubAllGlobals());
describe('API de comunidades', () => {
  it('envia convite no corpo, sem expor código na URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ communityId: 'c1' }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.acceptCommunityInvite('abcdefghijklmnopqrstuv')).resolves.toEqual({ communityId: 'c1' });
    expect(fetchMock).toHaveBeenCalledWith('/api/invites/accept', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ code: 'abcdefghijklmnopqrstuv' }) }));
  });
  it('valida entrada antes de enviar e codifica identificadores', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.sendChannelMessage('id', '  ')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
    await api.updateChannel('id/test', ' Canal ');
    expect(fetchMock).toHaveBeenCalledWith('/api/channels/id%2Ftest', expect.objectContaining({ body: JSON.stringify({ name: 'Canal' }) }));
  });
  it('rejeita respostas de mensagens inválidas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ messages: [{}], nextCursor: null }) }));
    await expect(api.getChannelMessages('channel')).rejects.toThrow();
  });
  it.each([
    ['edição', () => api.editChannelMessage('channel', 'message', 'novo')],
    ['exclusão', () => api.deleteChannelMessage('channel', 'message')],
  ])('valida resposta da %s de mensagem', async (_label, call) => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ ok: false }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(call()).resolves.toBeUndefined();
    await expect(call()).rejects.toThrow();
  });

});
