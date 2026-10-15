import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { FRONTEND_URL } from './config';

/**
 * Suite E2E do chat da sala (Fase 2).
 *
 * Exercita o caminho REAL de um browser: cria a sala pela API (passando pelo
 * proxy /api do Next), entra na sala, abre o painel e troca mensagens entre
 * DOIS contextos isolados (peers distintos) — sem mock de socket e sem atalho
 * pelo backend.
 *
 * Seletores vêm da UI, não de suposição:
 *   ChatPanel        -> [data-testid="chat-panel"], [aria-label="Mensagem"],
 *                       botões "Anexar"/"Enviar"/"Fechar chat",
 *                       [data-testid="file-chip"],
 *                       [role="listbox"][aria-label="Participantes para mencionar"]
 *   ChatMessageItem  -> [data-testid="chat-message"], [data-testid="message-content"],
 *                       botões Editar/Salvar/Cancelar/Deletar, selos "(editado)"
 *                       e "[apagada]", menção destacada em span.bg-amber-200
 *   ParticipantList  -> [aria-label="Lista de participantes"] li  -> "Nome (Você)"
 *   room/[id]/page   -> "Conectado" (indicador único de socket.connected)
 */

/** Zip mínimo e VÁLIDO (End Of Central Directory) — magic bytes PK\x05\x06. */
const EMPTY_ZIP = Buffer.from('504b0506' + '00'.repeat(18), 'hex');

type Peer = { context: BrowserContext; page: Page };

/** Cria sala pela API, no mesmo proxy /api que o browser usa. */
async function createRoom(page: Page, opts: { isPersistent: boolean }): Promise<string> {
  const res = await page.request.post('/api/rooms', {
    data: { name: `E2E chat ${Date.now()}`, isPersistent: opts.isPersistent },
  });
  expect(res.ok(), `POST /api/rooms -> ${res.status()} ${await res.text()}`).toBeTruthy();
  const body = (await res.json()) as { room: { id: string } };
  return body.room.id;
}

/** Abre um contexto isolado (cookies/storage próprios) com baseURL e microfone. */
async function openPeer(browser: Browser): Promise<Peer> {
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  return { context, page };
}

/** Espera o socket conectar (indicador único em room/[id]/page.tsx:370). */
async function waitConnected(page: Page): Promise<void> {
  await expect(page.getByText('Conectado')).toBeVisible({ timeout: 20_000 });
}

/** Entra na sala e abre o painel de chat pelo controle da propria sala. */
async function joinAndOpenChat(page: Page, roomId: string): Promise<void> {
  await page.goto(`/room/${roomId}`);
  await waitConnected(page);
  await page.getByRole('button', { name: 'Abrir chat' }).click();
  await expect(page.getByTestId('chat-panel')).toBeVisible();
}

/**
 * Nome de exibicao local, lido da lista de participantes.
 * O `<li>` renderiza o avatar (1 caractere) antes do span "Nome (Você)".
 */
async function localName(page: Page): Promise<string> {
  const li = page
    .locator('[aria-label="Lista de participantes"] li', { hasText: '(Você)' })
    .first();
  await expect(li).toBeVisible();
  const raw = (await li.innerText()).replace(/\s+/g, ' ').trim();
  const match = raw.match(/^(?:\S\s+)?(.+?)\s*\(Você\)/);
  const name = (match?.[1] ?? '').trim();
  expect(name.length, `nome local nao extraido de "${raw}"`).toBeGreaterThan(0);
  return name;
}

function participants(page: Page) {
  return page.locator('[aria-label="Lista de participantes"] li');
}

async function sendMessage(page: Page, text: string): Promise<void> {
  await page.getByLabel('Mensagem').fill(text);
  await page.getByRole('button', { name: 'Enviar' }).click();
}

function messageWith(page: Page, text: string) {
  return page.locator('[data-testid="chat-message"]', { hasText: text });
}

test.describe('chat da sala', () => {
  let peers: Peer[] = [];

  test.afterEach(async () => {
    await Promise.all(peers.map((p) => p.context.close().catch(() => undefined)));
    peers = [];
  });

  async function peer(browser: Browser): Promise<Peer> {
    const p = await openPeer(browser);
    peers.push(p);
    return p;
  }

  test('mensagem de A chega em B em tempo real, com o autor correto', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: true });
    await joinAndOpenChat(a.page, roomId);
    const nameA = await localName(a.page);

    const b = await peer(browser);
    await joinAndOpenChat(b.page, roomId);
    // malha formada: cada peer enxerga os 2 participantes
    await expect(participants(b.page)).toHaveCount(2, { timeout: 20_000 });

    const text = `oi-${Date.now()}`;
    await sendMessage(a.page, text);

    const received = messageWith(b.page, text);
    await expect(received).toBeVisible({ timeout: 10_000 });
    await expect(received).toContainText(nameA);
    await expect(received).not.toContainText('Anon');
  });

  test('sala persistente entrega o historico para quem entra depois', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: true });
    await joinAndOpenChat(a.page, roomId);

    const text = `historico-${Date.now()}`;
    await sendMessage(a.page, text);
    // A so ve depois que o backend persistiu e ecoou (chat:message)
    await expect(messageWith(a.page, text)).toBeVisible();

    // B entra DEPOIS — o historico tem que vir do banco, nao do socket
    const b = await peer(browser);
    await joinAndOpenChat(b.page, roomId);
    await expect(messageWith(b.page, text)).toBeVisible({ timeout: 10_000 });
  });

  test('o painel lembra aberto/fechado POR SALA (localStorage)', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: true });

    await a.page.goto(`/room/${roomId}`);
    await waitConnected(a.page);
    // estado inicial: sem nada salvo, o chat comeca fechado
    await expect(a.page.getByTestId('chat-panel')).toBeHidden();

    await a.page.getByRole('button', { name: 'Abrir chat' }).click();
    await expect(a.page.getByTestId('chat-panel')).toBeVisible();
    await a.page.reload();
    await waitConnected(a.page);
    await expect(a.page.getByTestId('chat-panel')).toBeVisible();

    // fecha pelo ✕ do painel e confirma que permanece fechado apos reload
    await a.page
      .getByTestId('chat-panel')
      .getByRole('button', { name: 'Fechar chat' })
      .click();
    await expect(a.page.getByTestId('chat-panel')).toBeHidden();
    await a.page.reload();
    await waitConnected(a.page);
    await expect(a.page.getByTestId('chat-panel')).toBeHidden();
  });

  test('@ abre o autocomplete e o nome fica destacado na mensagem recebida', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: true });
    await joinAndOpenChat(a.page, roomId);

    const b = await peer(browser);
    await joinAndOpenChat(b.page, roomId);
    await expect(participants(b.page)).toHaveCount(2, { timeout: 20_000 });
    const nameB = await localName(b.page);

    // "@" sozinho nao abre o autocomplete (MENTION_TRAILING_RE exige 1+ caractere)
    const input = a.page.getByLabel('Mensagem');
    await input.fill(`@${nameB.slice(0, 1)}`);
    const listbox = a.page.getByRole('listbox', { name: 'Participantes para mencionar' });
    await expect(listbox).toBeVisible();
    await listbox.getByRole('option', { name: nameB, exact: true }).click();
    // selectOption troca o token por "@Nome " (com espaco)
    await expect(input).toHaveValue(new RegExp(`@${nameB}\\s*$`));

    await input.press('End');
    await input.pressSequentially(' vem ca');
    await a.page.getByRole('button', { name: 'Enviar' }).click();

    const received = messageWith(b.page, 'vem ca');
    await expect(received).toBeVisible({ timeout: 10_000 });
    await expect(received.locator('span.bg-amber-200')).toHaveText(`@${nameB}`);
  });

  test('autor edita e exclui a propria mensagem', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: true });
    await joinAndOpenChat(a.page, roomId);

    const original = `original-${Date.now()}`;
    await sendMessage(a.page, original);

    // unico peer na sala -> unica mensagem de chat
    const message = a.page.getByTestId('chat-message').first();
    await expect(message).toContainText(original);

    // Editar (acoes aparecem no hover)
    const edited = `editada-${Date.now()}`;
    await message.hover();
    await message.getByRole('button', { name: 'Editar' }).click();
    await a.page.getByLabel('Editar mensagem').fill(edited);
    await message.getByRole('button', { name: 'Salvar' }).click();
    await expect(message).toContainText(edited);
    await expect(message).toContainText('editado');

    // Excluir
    await message.hover();
    await message.getByRole('button', { name: 'Deletar' }).click();
    await expect(message).toContainText('[mensagem apagada]');
    await expect(message).toContainText('[apagada]');
    // acoes somem depois de apagada
    await message.hover();
    await expect(message.getByRole('button', { name: 'Editar' })).toBeHidden();
    await expect(message.getByRole('button', { name: 'Deletar' })).toBeHidden();
  });

  test('upload de .zip vira link baixavel para o outro peer', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: true });
    await joinAndOpenChat(a.page, roomId);
    const nameA = await localName(a.page);

    const b = await peer(browser);
    await joinAndOpenChat(b.page, roomId);
    await expect(participants(b.page)).toHaveCount(2, { timeout: 20_000 });

    const fileName = `pacote-${Date.now()}.zip`;
    await a.page.locator('input[type="file"]').setInputFiles({
      name: fileName,
      mimeType: 'application/zip',
      buffer: EMPTY_ZIP,
    });
    await expect(a.page.getByTestId('file-chip')).toContainText(fileName);
    await a.page.getByRole('button', { name: 'Enviar' }).click();

    const received = messageWith(b.page, fileName);
    await expect(received).toBeVisible({ timeout: 15_000 });

    const link = received.getByRole('link', { name: fileName });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    expect(href, 'link de download sem href').toBeTruthy();

    // download real, pelo mesmo caminho que o browser usaria
    const res = await b.page.request.get(href!);
    expect(res.status(), `GET ${href} -> ${res.status()}`).toBe(200);
    expect(res.headers()['content-disposition']).toContain(fileName);

    // autor do arquivo tem que ser o nome do uploader
    await expect(received).toContainText(nameA);
    await expect(received).not.toContainText('Anon');
  });

  test('backend rejeita .exe (allowlist de MIME)', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: true });

    const res = await a.page.request.post(`/api/rooms/${roomId}/files`, {
      multipart: {
        content: 'tentativa',
        file: {
          name: 'malicioso.exe',
          mimeType: 'application/x-msdownload',
          buffer: Buffer.from('MZ\x90\x00\x03', 'binary'),
        },
      },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Tipo não permitido' });
  });

  test('backend rejeita arquivo com magic bytes divergente do mime declarado', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: true });

    // Declara image/png mas envia bytes de ZIP -> detectMagicBytes devolve
    // application/zip != image/png
    const res = await a.page.request.post(`/api/rooms/${roomId}/files`, {
      multipart: {
        file: {
          name: 'disfarcado.png',
          mimeType: 'image/png',
          buffer: EMPTY_ZIP,
        },
      },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({
      error: 'Magic bytes mismatch',
      detected: 'application/zip',
      declared: 'image/png',
    });
  });

  test('sala temporaria nao aceita arquivos', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page, { isPersistent: false });

    const res = await a.page.request.post(`/api/rooms/${roomId}/files`, {
      multipart: {
        file: {
          name: 'temporaria.zip',
          mimeType: 'application/zip',
          buffer: EMPTY_ZIP,
        },
      },
    });
    expect(res.status()).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Temporary rooms do not support files' });
  });

  test('sala privada nega upload de nao-membro (403)', async ({ browser }) => {
    const a = await peer(browser);
    const res = await a.page.request.post('/api/rooms', {
      data: { name: `E2E privada ${Date.now()}`, isPersistent: true, isPrivate: true },
    });
    expect(res.ok()).toBeTruthy();
    const { room } = (await res.json()) as { room: { id: string } };

    // visitante anonimo, sem inviteToken/password
    const upload = await a.page.request.post(`/api/rooms/${room.id}/files`, {
      multipart: {
        file: {
          name: 'invasao.zip',
          mimeType: 'application/zip',
          buffer: EMPTY_ZIP,
        },
      },
    });
    expect(upload.status()).toBe(403);
    expect(await upload.json()).toMatchObject({ error: 'Not a room member' });
  });

  test('reconexao: peer que cai volta para a sala e a malha se restabelece', async ({ browser }) => {
    const a = await peer(browser);
    // Proxy transparente do WebSocket de A, para derrubar a conexao na hora.
    // `context.setOffline(true)` NAO serve aqui: com a rede emudecida o cliente
    // so declara a conexao morta depois de pingInterval + pingTimeout
    // (25000 + 60000 no backend, handler.ts:72-73) — medido na pratica: 85s.
    // Fechar o WebSocket routeado derruba na hora e de forma deterministica.
    let socketDeA: { close: () => Promise<void> } | null = null;
    await a.page.routeWebSocket(/socket\.io/, (ws) => {
      socketDeA = ws;
      ws.connectToServer(); // mensagens seguem sendo encaminhadas normalmente
    });

    const roomId = await createRoom(a.page, { isPersistent: true });
    await joinAndOpenChat(a.page, roomId);

    const b = await peer(browser);
    await joinAndOpenChat(b.page, roomId);
    await expect(participants(b.page)).toHaveCount(2, { timeout: 20_000 });

    // Derruba o socket de A: o servidor perde o peer (handler.ts:628 ->
    // handleLeaveRoom -> room:peer-left) e o cliente entra em reconexao.
    expect(socketDeA, 'websocket de A nao foi roteado').not.toBeNull();
    await socketDeA!.close();
    await expect(a.page.getByText('Desconectado', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(participants(b.page)).toHaveCount(1, { timeout: 15_000 });

    // O cliente reconecta com OUTRO socketId: o servidor nao tem mais este peer
    // na sala. So o re-join (room/[id]/page.tsx, listener de socket.onReconnect)
    // o traz de volta — sem ele, o toHaveCount(2) abaixo estoura.
    await expect(a.page.getByText('Conectado', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(participants(b.page)).toHaveCount(2, { timeout: 20_000 });

    // Prova funcional: o backend recusa chat:message de socket fora da sala
    // ("Not in room", handler.ts:426) — a mensagem so chega se o re-join
    // realmente aconteceu no servidor.
    const text = `pos-reconnect-${Date.now()}`;
    await sendMessage(a.page, text);
    await expect(messageWith(b.page, text)).toBeVisible({ timeout: 15_000 });
  });
});
