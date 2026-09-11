import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act, fireEvent, screen } from '@testing-library/react';
import type { Socket } from 'socket.io-client';
import { chatMessageClientSchema, chatEditClientSchema, fileClientSchema } from '@/lib/validation';
import { useChat, type ChatMessage, type ChatApi } from '@/hooks/useChat';
import { ChatMessageItem } from '@/components/ChatMessageItem';
import { ChatPanel } from '@/components/ChatPanel';

// ─── Mocks globais ─────────────────────────────────────────────
beforeEach(() => {
  globalThis.Audio = vi
    .fn()
    .mockImplementation(
      () =>
        ({
          volume: 0,
          play: vi.fn().mockResolvedValue(undefined),
        }) as unknown as typeof Audio,
    ) as unknown as typeof Audio;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROOM_ID = '550e8400-e29b-41d4-a716-446655440000';

function baseMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    roomId: ROOM_ID,
    content: 'ola',
    authorId: null,
    guestName: 'Alice',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function createMockSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    on: vi.fn((event: string, cb: (payload: unknown) => void) => {
      handlers.set(event, cb);
      return socket;
    }),
    off: vi.fn(),
    emit: vi.fn(),
  } as unknown as Socket;
  const emitSocket = (event: string, payload: unknown) => {
    const handler = handlers.get(event);
    if (handler) act(() => handler(payload));
  };
  return { socket, handlers, emitSocket };
}

function createChatMock(overrides: Partial<ChatApi> = {}): ChatApi {
  return {
    messages: [],
    hasMore: false,
    nextCursor: null,
    unread: 0,
    isLoadingHistory: false,
    sendMessage: vi.fn(),
    editMessage: vi.fn(),
    deleteMessage: vi.fn(),
    loadMore: vi.fn().mockResolvedValue(undefined),
    uploadFiles: vi.fn().mockResolvedValue(undefined),
    markRead: vi.fn(),
    setOpen: vi.fn(),
    setMessages: vi.fn(),
    ...overrides,
  };
}

describe('validation cliente (Task 9)', () => {
  it('rejeita vazio/trim e >500', () => {
    expect(chatMessageClientSchema.safeParse('   ').success).toBe(false);
    expect(chatMessageClientSchema.safeParse('').success).toBe(false);
    expect(chatMessageClientSchema.safeParse('a'.repeat(501)).success).toBe(false);
    expect(chatMessageClientSchema.safeParse('a'.repeat(500)).success).toBe(true);
  });

  it('chatEditClientSchema segue as mesmas regras 1..500', () => {
    expect(chatEditClientSchema.safeParse('   ').success).toBe(false);
    expect(chatEditClientSchema.safeParse('novo texto').success).toBe(true);
  });

  it('fileClientSchema rejeita >15MB e mime fora da allowlist', () => {
    const big = new File([new ArrayBuffer(15_000_001)], 'big.zip', { type: 'application/zip' });
    expect(fileClientSchema.safeParse({ file: big }).success).toBe(false);

    const exe = new File([new ArrayBuffer(10)], 'malware.exe', { type: 'application/x-msdownload' });
    expect(fileClientSchema.safeParse({ file: exe }).success).toBe(false);

    const ok = new File([new ArrayBuffer(10)], 'doc.pdf', { type: 'application/pdf' });
    expect(fileClientSchema.safeParse({ file: ok }).success).toBe(true);
  });
});

describe('useChat (Task 9/10)', () => {
  it('sendMessage valida 1..500 antes de emitir e corta mentions', () => {
    const { socket, emitSocket } = createMockSocket();
    const { result } = renderHook(() => useChat(ROOM_ID, socket));

    act(() => result.current.sendMessage('   ', []));
    act(() => result.current.sendMessage('a'.repeat(501), []));
    expect(socket.emit).not.toHaveBeenCalled();

    act(() => result.current.sendMessage('  ola @Bob  ', ['Bob', 'Alice', 'x', 'y', 'z', 'w', 'v', 'u', 't']));
    expect(socket.emit).toHaveBeenCalledWith(
      'chat:message',
      { roomId: ROOM_ID, content: 'ola @Bob', mentions: ['Bob', 'Alice', 'x', 'y', 'z', 'w', 'v', 'u'] },
      expect.any(Function),
    );

    // echo do servidor atualiza a lista
    emitSocket('chat:message', baseMessage({ id: 'echo-1', content: 'ola @Bob', guestName: 'Eu' }));
    expect(result.current.messages.map((m) => m.id)).toEqual(['echo-1']);
  });

  it('chat:message com painel fechado incrementa unread; markRead e setOpen(true) zeram', () => {
    const { socket, emitSocket } = createMockSocket();
    const { result } = renderHook(() => useChat(ROOM_ID, socket));

    emitSocket('chat:message', baseMessage({ id: 'm1' }));
    emitSocket('chat:message', baseMessage({ id: 'm2' }));
    expect(result.current.unread).toBe(2);

    act(() => result.current.markRead());
    expect(result.current.unread).toBe(0);

    emitSocket('chat:message', baseMessage({ id: 'm3' }));
    expect(result.current.unread).toBe(1);

    act(() => result.current.setOpen(true));
    expect(result.current.unread).toBe(0);

    emitSocket('chat:message', baseMessage({ id: 'm4' }));
    expect(result.current.unread).toBe(0);
  });

  it('editMessage valida, deleteMessage emite, edit/delete listeners atualizam estado', () => {
    const { socket, emitSocket } = createMockSocket();
    const { result } = renderHook(() => useChat(ROOM_ID, socket));

    emitSocket('chat:message', baseMessage({ id: 'm1', content: 'original', files: [{ id: 'f1', filename: 'a.txt', mime: 'text/plain', size: 10 }] }));

    act(() => result.current.editMessage('m1', '   '));
    expect(socket.emit).not.toHaveBeenCalledWith('chat:edit', expect.anything());

    act(() => result.current.editMessage('m1', 'editado'));
    expect(socket.emit).toHaveBeenCalledWith('chat:edit', { roomId: ROOM_ID, messageId: 'm1', content: 'editado' });

    emitSocket('chat:edit', { messageId: 'm1', content: 'editado', prevContent: 'original', editedAt: '2026-09-11T12:00:00.000Z' });
    expect(result.current.messages[0].content).toBe('editado');
    expect(result.current.messages[0].prevContent).toBe('original');

    act(() => result.current.deleteMessage('m1'));
    expect(socket.emit).toHaveBeenCalledWith('chat:delete', { roomId: ROOM_ID, messageId: 'm1' });

    emitSocket('chat:delete', { messageId: 'm1', deletedAt: '2026-09-11T12:05:00.000Z' });
    expect(result.current.messages[0].content).toBe('[mensagem apagada]');
    expect(result.current.messages[0].files).toEqual([]);
  });

  it('chat:mention toca Audio em /sounds/mention.mp3 com volume 0.6', () => {
    const { socket, emitSocket } = createMockSocket();
    renderHook(() => useChat(ROOM_ID, socket));

    emitSocket('chat:mention', { messageId: 'm1', roomId: ROOM_ID });

    const MockAudio = globalThis.Audio as unknown as ReturnType<typeof vi.fn>;
    expect(MockAudio).toHaveBeenCalledWith('/sounds/mention.mp3');
    const instance = MockAudio.mock.results[0].value as { volume: number; play: () => Promise<void> };
    expect(instance.volume).toBe(0.6);
    expect(instance.play).toHaveBeenCalled();
  });

  it('chat:system adiciona mensagem de sistema com flag system', () => {
    const { socket, emitSocket } = createMockSocket();
    const { result } = renderHook(() => useChat(ROOM_ID, socket));

    emitSocket('chat:system', { roomId: ROOM_ID, text: 'Alice entrou', kind: 'join' });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].content).toBe('Alice entrou');
    expect(result.current.messages[0].system).toBe(true);
    expect(result.current.unread).toBe(0);
  });

  it('loadMore busca paginação e faz prepend sem duplicar guard', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          messages: [
            baseMessage({ id: 'old-1', content: 'antiga 1' }),
            baseMessage({ id: 'old-2', content: 'antiga 2' }),
          ],
          nextCursor: 'cur-2',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ messages: [baseMessage({ id: 'old-0', content: 'mais antiga' })], nextCursor: null }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { socket } = createMockSocket();
    const { result } = renderHook(() => useChat(ROOM_ID, socket));

    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/rooms/${ROOM_ID}/messages?limit=50`,
      { credentials: 'include' },
    );
    expect(result.current.messages.map((m) => m.id)).toEqual(['old-1', 'old-2']);
    expect(result.current.nextCursor).toBe('cur-2');
    expect(result.current.hasMore).toBe(true);

    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('cursor=cur-2'),
      expect.anything(),
    );
    expect(result.current.messages.map((m) => m.id)).toEqual(['old-0', 'old-1', 'old-2']);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.hasMore).toBe(false);

    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledTimes(2); // guard: hasMore false
  });

  it('uploadFiles envia FormData com content e até 5 arquivos', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [], messageId: 'm-up' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { socket } = createMockSocket();
    const { result } = renderHook(() => useChat(ROOM_ID, socket));

    const files = [new File(['a'], 'a.txt', { type: 'text/plain' }), new File(['b'], 'b.txt', { type: 'text/plain' })];
    await act(() => result.current.uploadFiles(files, 'legenda'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/rooms/${ROOM_ID}/files`);
    expect(init.method).toBe('POST');
    const body = init.body as FormData;
    expect(body.get('content')).toBe('legenda');
    expect(body.getAll('files')).toHaveLength(2);
  });

  it('loadMore anexa password na query quando fornecida (sala protegida)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [baseMessage({ id: 'old-1', content: 'antiga' })], nextCursor: null }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const { socket } = createMockSocket();
    const { result } = renderHook(() => useChat(ROOM_ID, socket, undefined, 'segredo123'));

    await act(() => result.current.loadMore());
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/rooms/${ROOM_ID}/messages?limit=50&password=segredo123`,
      { credentials: 'include' },
    );
  });

  it('uploadFiles inclui campo password no FormData quando fornecida', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ files: [], messageId: 'm-pass' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { socket } = createMockSocket();
    const { result } = renderHook(() => useChat(ROOM_ID, socket, undefined, 'segredo123'));

    await act(() =>
      result.current.uploadFiles([new File(['a'], 'a.txt', { type: 'text/plain' })], 'leg'),
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;
    expect(body.get('password')).toBe('segredo123');
  });
});

describe('ChatMessageItem (Task 10)', () => {
  const itemProps = {
    isOwn: false,
    isOwner: false,
    currentPeers: ['Bob'],
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  };

  it('linkify transforma https:// em anchor com rel noopener', () => {
    const { container } = render(
      <ChatMessageItem message={baseMessage({ content: 'veja https://ex.com/abc' })} {...itemProps} />,
    );
    const link = container.querySelector('a[href="https://ex.com/abc"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener');
  });

  it('mentionHighlight só peers atuais com bg-amber-200', () => {
    const { container } = render(
      <ChatMessageItem
        message={baseMessage({ content: 'oi @Bob @Carlos' })}
        {...itemProps}
        currentPeers={['Bob']}
      />,
    );
    expect(container.textContent).toContain('@Bob');
    expect(container.textContent).toContain('@Carlos');
    expect(container.querySelectorAll('.bg-amber-200')).toHaveLength(1);
  });

  it('escapa HTML injetado antes do dangerouslySetInnerHTML', () => {
    const { container } = render(
      <ChatMessageItem message={baseMessage({ content: '<img src=x onerror=alert(1)>' })} {...itemProps} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('botões Editar só isOwn dentro de 15min; Deletar se isOwn ou isOwner', () => {
    const { container, rerender } = render(
      <ChatMessageItem message={baseMessage({ content: 'msg' })} {...itemProps} isOwn />
    );
    expect(container.textContent).toContain('Editar');
    expect(container.textContent).toContain('Deletar');

    // fora da janela de 15min → sem Editar, mas Deletar continua
    rerender(
      <ChatMessageItem
        message={baseMessage({ content: 'msg', createdAt: new Date(Date.now() - 16 * 60 * 1000).toISOString() })}
        {...itemProps}
        isOwn
      />
    );
    expect(container.textContent).not.toContain('Editar');
    expect(container.textContent).toContain('Deletar');

    // não autor e não dono → sem ações
    rerender(<ChatMessageItem message={baseMessage({ content: 'msg' })} {...itemProps} />);
    expect(container.textContent).not.toContain('Editar');
    expect(container.textContent).not.toContain('Deletar');

    // dono mesmo sem ser autor → Deletar
    rerender(<ChatMessageItem message={baseMessage({ content: 'msg' })} {...itemProps} isOwner />);
    expect(container.textContent).not.toContain('Editar');
    expect(container.textContent).toContain('Deletar');
  });

  it('deleted mostra placeholder [mensagem apagada] e esconde ações', () => {
    const { container } = render(
      <ChatMessageItem
        message={baseMessage({ id: 'del', content: 'x', deletedAt: new Date().toISOString() })}
        {...itemProps}
        isOwn
      />
    );
    expect(container.textContent).toContain('[mensagem apagada]');
    expect(container.textContent).not.toContain('Editar');
    expect(container.textContent).not.toContain('Deletar');
  });

  it('inline edit: Salvar chama onEdit e Cancelar fecha sem chamar', () => {
    const onEdit = vi.fn();
    const { container, getByText } = render(
      <ChatMessageItem
        message={baseMessage({ content: 'original' })}
        {...itemProps}
        isOwn
        onEdit={onEdit}
      />
    );

    fireEvent.click(getByText('Editar'));
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();

    fireEvent.change(textarea as HTMLTextAreaElement, { target: { value: 'novo texto' } });
    fireEvent.click(getByText('Salvar'));
    expect(onEdit).toHaveBeenCalledWith('msg-1', 'novo texto');

    // Cancelar
    fireEvent.click(getByText('Editar'));
    fireEvent.click(getByText('Cancelar'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('renderiza links de arquivos em /api/files/:fileId', () => {
    const { container } = render(
      <ChatMessageItem
        message={baseMessage({
          content: 'com arquivo',
          files: [{ id: 'f-1', filename: 'doc.pdf', mime: 'application/pdf', size: 2048 }],
        })}
        {...itemProps}
      />
    );
    const link = container.querySelector('a[href="/api/files/f-1"]');
    expect(link).toBeTruthy();
    expect(link?.textContent).toContain('doc.pdf');
  });

  it('renderiza link de arquivo com password na query (sala protegida por senha)', () => {
    const { container } = render(
      <ChatMessageItem
        message={baseMessage({
          content: 'arquivo protegido',
          files: [{ id: 'f-pw', filename: 'secret.pdf', mime: 'application/pdf', size: 4096 }],
        })}
        {...itemProps}
        password="segredo123"
      />
    );
    const link = container.querySelector('a[href*="password=segredo123"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/api/files/f-pw?password=segredo123');
  });
});

describe('ChatPanel (Task 10)', () => {
  function renderChatPanel(overrides: { chat?: Partial<ChatApi>; open?: boolean; currentPeers?: string[] } = {}) {
    const chat = createChatMock(overrides.chat);
    const onClose = vi.fn();
    const utils = render(
      <ChatPanel
        roomId={ROOM_ID}
        socket={null}
        chat={chat}
        currentPeers={overrides.currentPeers ?? ['Alice', 'Bob']}
        open={overrides.open ?? true}
        onClose={onClose}
        isOwner={false}
        currentUserId={null}
        guestName="Me"
      />
    );
    return { chat, onClose, ...utils };
  }

  function typeMessage(rawText: string) {
    fireEvent.change(screen.getByPlaceholderText('Escreva uma mensagem...'), {
      target: { value: rawText },
    });
  }

  it('renderiza role=log, badge unread e mensagens', () => {
    const { chat } = renderChatPanel({
      chat: {
        messages: [baseMessage({ id: 'm1', content: 'oi' }), baseMessage({ id: 'm2', content: 'tudo bem?' })],
        unread: 3,
      },
    });

    expect(screen.getByRole('log')).toBeTruthy();
    expect(screen.getByText('oi')).toBeTruthy();
    expect(screen.getByText('tudo bem?')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy(); // badge unread no header
    expect(chat.setOpen).toHaveBeenCalledWith(true);
  });

  it('Enter envia e Shift+Enter quebra linha sem enviar', () => {
    const { chat } = renderChatPanel();
    const textarea = screen.getByPlaceholderText('Escreva uma mensagem...');

    typeMessage('ola mundo');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(chat.sendMessage).not.toHaveBeenCalled();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(chat.sendMessage).toHaveBeenCalledWith('ola mundo', []);
    expect((textarea as HTMLTextAreaElement).value).toBe('');
  });

  it('não envia mensagem vazia ou >500', () => {
    const { chat } = renderChatPanel();
    const textarea = screen.getByPlaceholderText('Escreva uma mensagem...');

    typeMessage('   ');
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(chat.sendMessage).not.toHaveBeenCalled();

    typeMessage('a'.repeat(501));
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(chat.sendMessage).not.toHaveBeenCalled();

    typeMessage('a'.repeat(500));
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(chat.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('contador 500 fica vermelho quando excede 500', () => {
    renderChatPanel();

    typeMessage('a'.repeat(501));
    const counter = screen.getByTestId('char-counter');
    expect(counter).toHaveTextContent('501/500');
    expect(counter.className).toContain('text-red-400');

    typeMessage('abc');
    expect(screen.getByTestId('char-counter').className).not.toContain('text-red-400');
  });

  it('autocomplete @ filtra roomPeers case-insensitive e ArrowDown+Enter seleciona', () => {
    const { chat } = renderChatPanel({ currentPeers: ['Alice', 'Bia', 'alberto'] });
    const textarea = screen.getByPlaceholderText('Escreva uma mensagem...');

    typeMessage('oi @al');
    const listbox = screen.getByRole('listbox');
    expect(listbox).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Alice', 'alberto']);

    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect((textarea as HTMLTextAreaElement).value).toBe('oi @Alice ');

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(chat.sendMessage).toHaveBeenCalledWith('oi @Alice ', ['Alice']);
  });

  it('fecha listbox com Escape e não seleciona', () => {
    const { chat } = renderChatPanel();
    const textarea = screen.getByPlaceholderText('Escreva uma mensagem...');

    typeMessage('@Bo');
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(chat.sendMessage).toHaveBeenCalledWith('@Bo', []);
  });

  it('preview chips com filename/size e remover', () => {
    const { chat } = renderChatPanel();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['%PDF-'], 'doc.pdf', { type: 'application/pdf' });
    const zip = new File(['PK'], 'dados.zip', { type: 'application/zip' });

    fireEvent.change(fileInput, { target: { files: [pdf, zip] } });
    expect(screen.getByText('doc.pdf')).toBeTruthy();
    expect(screen.getByText('dados.zip')).toBeTruthy();

    // remove doc.pdf
    const removeButtons = screen.getAllByRole('button', { name: /remover arquivo/i });
    fireEvent.click(removeButtons[0]);
    expect(screen.queryByText('doc.pdf')).toBeNull();
    expect(screen.getByText('dados.zip')).toBeTruthy();

    // envia: uploadFiles recebe o restante
    typeMessage('com arquivos');
    fireEvent.keyDown(screen.getByPlaceholderText('Escreva uma mensagem...'), { key: 'Enter' });
    expect(chat.uploadFiles).toHaveBeenCalledWith([expect.objectContaining({ name: 'dados.zip' })], 'com arquivos');
    expect(chat.sendMessage).not.toHaveBeenCalled();
  });

  it('rejeita arquivo >15MB ou mime fora da allowlist nos chips', () => {
    renderChatPanel();
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = new File([new ArrayBuffer(15_000_001)], 'big.zip', { type: 'application/zip' });
    const exe = new File(['MZ'], 'malware.exe', { type: 'application/x-msdownload' });
    const ok = new File(['ok'], 'ok.txt', { type: 'text/plain' });

    fireEvent.change(fileInput, { target: { files: [big, exe, ok] } });
    expect(screen.queryByText('big.zip')).toBeNull();
    expect(screen.queryByText('malware.exe')).toBeNull();
    expect(screen.getByText('ok.txt')).toBeTruthy();
  });

  it('botão Carregar mais chama loadMore quando hasMore', () => {
    const { chat } = renderChatPanel({ chat: { hasMore: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mais' }));
    expect(chat.loadMore).toHaveBeenCalled();

    chat.loadMore.mockClear();
    const { chat: chatNoMore } = renderChatPanel({ chat: { hasMore: false } });
    expect(chatNoMore.loadMore).not.toHaveBeenCalled();
  });

  it('botão Fechar chama onClose', () => {
    const { onClose } = renderChatPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar chat' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('mobile renderiza drawer com role=dialog', () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true, writable: true });
    renderChatPanel();
    const drawer = screen.getByRole('dialog', { name: 'Chat' });
    expect(drawer).toBeTruthy();
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    delete (window as { innerWidth?: number }).innerWidth;
  });
});