import { test, expect, Browser, BrowserContext, Page } from '@playwright/test';
import { FRONTEND_URL } from './config';
import { registerAndCreateRoom } from './auth';

/**
 * Audit de contraste/legibilidade da sala (Fase 4).
 *
 * Mede o contraste REAL no browser, como o WCAG manda: a cor de texto efetiva
 * sobre o fundo EFETIVO, ou seja, compondo em cascata todos os `background-color`
 * com alpha dos ancestrais sobre o fundo opaco mais próximo (body = forest-950).
 *
 * A alternativa ingenua — comparar o texto com o `background-color` declarado do
 * proprio elemento — produz falso positivo em qualquer fundo translucido
 * (`bg-red-500/20`): o alpha e ignorado. Aqui o alpha e resolvido.
 *
 * Limites do WCAG 2.1 AA: 4.5:1 para texto normal, 3:1 para texto grande
 * (>= 24px, ou >= 18.66px com peso >= 700).
 */

type Finding = {
  what: string;
  text: string;
  path: string;
  color: string;
  background: string;
  fontSize: number;
  fontWeight: number;
  required: number;
  ratio: number;
  pass: boolean;
  note?: string;
};

/** Formata o ratio para o relatorio. */
function ratioValue(f: Finding): string {
  return `${f.ratio.toFixed(2)}:1`;
}

/** Formata tamanho/peso da fonte para o relatorio. */
function fontPx(f: Finding): string {
  return `${f.fontSize}px/${f.fontWeight}`;
}

async function auditPage(page: Page): Promise<{ findings: Finding[]; skipped: Finding[] }> {
  // Congela animacoes/transicoes. `.btn-primary`/`.btn-secondary`/`.btn-danger`
  // usam `transition-all duration-200`: ler a cor logo apos uma troca de variante
  // devolveria a cor ANTERIOR e o audit mediria um estado que nao existe.
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });

  return page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number };

    const parse = (color: string): Rgba | null => {
      const m = color.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((v) => parseFloat(v.trim()));
      if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };

    const over = (fg: Rgba, bg: Rgba): Rgba => ({
      r: fg.r * fg.a + bg.r * (1 - fg.a),
      g: fg.g * fg.a + bg.g * (1 - fg.a),
      b: fg.b * fg.a + bg.b * (1 - fg.a),
      a: 1,
    });

    const lum = (c: Rgba): number => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };

    const ratio = (a: Rgba, b: Rgba): number => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };

    const hex = (c: Rgba): string =>
      '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

    // Fundo do <body>: bg-forest-950 (globals.css + layout.tsx)
    const BODY: Rgba = { r: 2, g: 44, b: 34, a: 1 };

    /**
     * Fundo efetivo + se e verificavel. Elementos sobre midia (video/img) ou
     * sobre gradiente/imagem de fundo nao tem cor de fundo solida mensuravel —
     * ficam marcados como nao verificaveis em vez de virarem falso positivo.
     */
    const backgroundFor = (el: Element): { bg: Rgba; verifiable: boolean; reason?: string } => {
      const layers: Rgba[] = [];
      let opaque: Rgba | null = null;
      let verifiable = true;
      let reason: string | undefined;
      let node: Element | null = el;

      while (node) {
        const tag = node.tagName.toLowerCase();
        const st = getComputedStyle(node);

        if (tag === 'video' || tag === 'img') {
          verifiable = false;
          reason = `sobre <${tag}>`;
        }
        if (st.backgroundImage && st.backgroundImage !== 'none') {
          verifiable = false;
          reason = reason ?? 'sobre background-image/gradiente';
        }

        const bg = parse(st.backgroundColor);
        if (bg && bg.a > 0) {
          if (bg.a >= 1) {
            opaque = bg;
            break;
          }
          layers.push(bg);
        }
        node = node.parentElement;
      }

      let out = opaque ?? BODY;
      for (let i = layers.length - 1; i >= 0; i -= 1) out = over(layers[i], out);
      return { bg: out, verifiable, reason };
    };

    const describePath = (el: Element): string => {
      const bits: string[] = [];
      let node: Element | null = el;
      while (node && bits.length < 4) {
        const classes = (node.getAttribute('class') ?? '')
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 3)
          .join('.');
        bits.unshift(`${node.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`);
        node = node.parentElement;
      }
      return bits.join(' > ');
    };

    const isVisible = (el: Element): boolean => {
      let node: Element | null = el;
      while (node) {
        const st = getComputedStyle(node);
        if (st.display === 'none' || st.visibility === 'hidden') return false;
        if (parseFloat(st.opacity) === 0) return false;
        node = node.parentElement;
      }
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    /** Texto proprio do elemento (nao herdado de filhos). */
    const ownText = (el: Element): string => {
      let text = '';
      el.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
      });
      return text.replace(/\s+/g, ' ').trim();
    };

    const findings: Finding[] = [];
    const skipped: Finding[] = [];

    document.querySelectorAll('body *').forEach((el) => {
      const text = ownText(el);
      if (!text) return;
      if (!isVisible(el)) return;

      const st = getComputedStyle(el);
      const fontSize = parseFloat(st.fontSize);
      const fontWeight = parseInt(st.fontWeight, 10) || 400;
      const { bg, verifiable, reason } = backgroundFor(el);

      // Cor do texto pode ter alpha tambem: compoe sobre o fundo efetivo.
      const rawText = parse(st.color);
      if (!rawText) return;
      const textColor = rawText.a >= 1 ? rawText : over(rawText, bg);

      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
      const required = isLarge ? 3 : 4.5;
      const value = ratio(textColor, bg);

      const finding: Finding = {
        what: 'contrast',
        text: text.slice(0, 48),
        path: describePath(el),
        color: hex(textColor),
        background: hex(bg),
        fontSize,
        fontWeight,
        required,
        ratio: Math.round(ratio(textColor, bg) * 100) / 100,
        pass: ratio(textColor, bg) >= required,
      };

      // Controles desabilitados sao isentos pelo WCAG 1.4.3 (o `disabled:opacity-50`
      // reduz o contraste de proposito): reportados, mas nao reprovam.
      const control = el.closest('button, input, select, textarea') as
        | HTMLButtonElement
        | HTMLInputElement
        | HTMLSelectElement
        | HTMLTextAreaElement
        | null;
      const disabled =
        (control != null && control.disabled === true) ||
        el.closest('[aria-disabled="true"]') !== null;

      if (!verifiable || disabled) {
        const note = verifiable ? 'componente desabilitado (isento pelo WCAG 1.4.3)' : reason;
        findings.push({ ...finding, pass: true, note });
        skipped.push({ ...finding, note });
        return;
      }

      findings.push(finding);
    });

    return { findings, skipped };
  });
}

type Peer = { context: BrowserContext; page: Page; withMic: boolean };

async function openPeer(
  browser: Browser,
  { withMic, blockMedia = false }: { withMic: boolean; blockMedia?: boolean },
): Promise<Peer> {
  const context = await browser.newContext({
    baseURL: FRONTEND_URL,
    ...(withMic ? { permissions: ['microphone'] } : {}),
  });

  if (blockMedia) {
    // Determinismo: sem isso o Chromium pode conceder o microfone de qualquer
    // forma (fake device) e o peer acabaria COM faixa de audio, mascarando o
    // caso testado (tile sem audio -> selo "Mudo").
    await context.addInitScript(() => {
      if (navigator.mediaDevices) {
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          configurable: true,
          value: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')),
        });
      }
    });
  }

  const page = await context.newPage();
  return { context, page, withMic };
}

async function createRoom(page: Page): Promise<string> {
  // Criar sala agora exige login: registra o usuário (cookie HttpOnly no
  // context do `page`) antes do POST /api/rooms.
  return registerAndCreateRoom(page, {
    name: `E2E a11y ${Date.now()}`,
    isPersistent: true,
  });
}

async function joinRoom(page: Page, roomId: string): Promise<void> {
  await page.goto(`/room?id=${roomId}`);
  await expect(page.getByText('Conectado')).toBeVisible({ timeout: 20_000 });
}

function participantItems(page: Page) {
  return page.locator('[aria-label="Participantes"] li');
}

/**
 * Roda o audit, imprime a tabela inteira (evidencia) e falha se algum texto
 * ficar abaixo do minimo do WCAG AA.
 */
async function expectNoContrastFailures(page: Page, where: string): Promise<Finding[]> {
  const { findings, skipped } = await auditPage(page);

  // eslint-disable-next-line no-console
  console.log(
    `\n=== contraste ${where}: ${findings.length} nos de texto, ${skipped.length} isentos ===`,
  );
  for (const f of findings) {
    // eslint-disable-next-line no-console
    console.log(
      `${f.pass ? 'ok  ' : 'FALHA'} ${ratioValue(f).padStart(8)} (min ${f.required.toFixed(1)}) ${fontPx(f)} ` +
        `"${f.text}" ${f.color} sobre ${f.background}` +
        `${f.note ? ` [${f.note}]` : ''} — ${f.path}`,
    );
  }

  const failures = findings.filter((f) => !f.pass);
  expect(
    failures.map(
      (f) =>
        `${ratioValue(f)} (min ${f.required.toFixed(1)}) "${f.text}" ${f.color} sobre ${f.background} — ${f.path}`,
    ),
    `texto abaixo do contraste minimo WCAG AA (4.5:1 normal, 3:1 grande) em ${where}`,
  ).toEqual([]);

  return findings;
}

/** Mede um texto especifico depois de deixar o estado pronto. */
async function contrastOf(page: Page, text: string): Promise<Finding> {
  const { findings } = await auditPage(page);
  const found = findings.find((f) => f.text === text);
  expect(finding_text(findingOr(findingOf(findings, text), text)), 'no de texto medido').toBeTruthy();
  return found!;
}

/**
 * Nenhum TEXTO pode estar cortado verticalmente. Para cada container que
 * recorta (`overflow-y: hidden|clip`), mede a caixa de cada no de texto (via
 * Range) e acusa quando ele ultrapassa o container.
 *
 * Medir `scrollHeight` do container nao serve: o glow decorativo (`h-[400px]`
 * absoluto dentro de uma `section` de ~300px) infla o scrollHeight sem cortar
 * texto nenhum. So nos de texto importam.
 */
async function expectNoClippedText(page: Page, where: string): Promise<void> {
  const clipped = await page.evaluate(() => {
    type Box = { top: number; bottom: number; left: number; right: number };

    const boxOf = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    };

    /** Primeiro ancestral (ou o proprio) que recorta/rola conteudo. */
    const scrollParent = (start: Element | null): Element | null => {
      let node: Element | null = start;
      while (node) {
        const oy = getComputedStyle(node).overflowY;
        if (oy !== 'visible') return node;
        node = node.parentElement;
      }
      return null;
    };

    const out: string[] = [];
    const all = Array.from(document.querySelectorAll('*'));

    for (const container of all) {
      const oy = getComputedStyle(container).overflowY;
      if (oy !== 'hidden' && oy !== 'clip') continue;

      const box = boxOf(container);
      if (box.bottom - box.top <= 0) continue;

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        const text = (node.nodeValue ?? '').trim();
        const parent = node.parentElement;
        // Texto oculto de proposito (so leitor de tela / link de pular) nao conta.
        const visuallyHidden = parent?.closest('.sr-only, .skip-link') !== null;
        if (text.length > 0 && parent && !visuallyHidden && scrollParent(parent) === container) {
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          if (r.height > 0 && (r.bottom > box.bottom + 1 || r.top < box.top - 1)) {
            const cls = String(container.getAttribute('class') ?? '').slice(0, 55);
            out.push(
              `${container.tagName.toLowerCase()}.${cls} (${Math.round(box.bottom - box.top)}px) corta "${text.slice(0, 40)}"`,
            );
            break;
          }
        }
        node = walker.nextNode();
      }
    }

    return out;
  });

  // eslint-disable-next-line no-console
  console.log(`\n=== corte vertical ${where}: ${clipped.length} elemento(s) cortado(s) ===`);
  expect(clipped, `texto cortado verticalmente em ${where}`).toEqual([]);
}

/**
 * Contraste de componente nao textual (WCAG 1.4.11, minimo 3:1): cor do
 * elemento (currentColor do icone) contra o primeiro fundo opaco acima dele.
 */
async function iconContrast(locator: import('@playwright/test').Locator): Promise<number> {
  return locator.evaluate((el) => {
    const parse = (c: string) => (c.match(/[\d.]+/g) ?? []).map(Number);
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let bgEl: Element | null = el;
    let bg = 'rgb(0, 0, 0)';
    while (bgEl) {
      const c = getComputedStyle(bgEl).backgroundColor;
      const parts = parse(c);
      if (parts.length >= 3 && (parts.length === 3 || parts[3] > 0.9)) {
        bg = c;
        break;
      }
      bgEl = bgEl.parentElement;
    }
    const fg = lum(parse(getComputedStyle(el).color));
    const back = lum(parse(bg));
    const [hi, lo] = fg > back ? [fg, back] : [back, fg];
    return (hi + 0.05) / (lo + 0.05);
  });
}

test.describe('contraste e legibilidade da sala', () => {
  let peers: Peer[] = [];

  test.afterEach(async () => {
    await Promise.all(peers.map((p) => p.context.close().catch(() => undefined)));
    peers = [];
  });

  async function peer(
    browser: Browser,
    opts: { withMic?: boolean; blockMedia?: boolean } = {},
  ): Promise<Peer> {
    const p = await openPeer(browser, { withMic: opts.withMic ?? true, blockMedia: opts.blockMedia });
    peers.push(p);
    return p;
  }

  test('todo o texto da sala (2 peers, chat aberto) passa o WCAG AA', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page);
    await joinRoom(a.page, roomId);

    const b = await peer(browser);
    await joinRoom(b.page, roomId);

    // espera a malha convergir: 2 participantes na lista
    await expect(participantItems(a.page)).toHaveCount(2, { timeout: 20_000 });

    // abre o painel do chat: botoes Anexar/Enviar e contador entram no audit
    await a.page.getByRole('button', { name: 'Abrir chat' }).click();
    await expect(a.page.getByTestId('chat-panel')).toBeVisible();

    const findings = await expectNoContrastFailures(a.page, 'da sala (2 peers)');

    // cobre o botao primario compartilhado (.btn-primary), que so aparece quando
    // algum controle esta ativo: o toggle de chat aberto usa variant="primary".
    const primary = findings.filter((f) => f.path.includes('.btn-primary'));
    expect(
      primary.length,
      'nenhum elemento .btn-primary foi auditado — o fix do btn-primary ficaria sem cobertura',
    ).toBeGreaterThan(0);

    await expectNoClippedText(a.page, 'na sala');

    // Regressão: o grid de 2 participantes tinha `mx-auto` sem `w-full` e, num
    // flex-column, isso cancela o stretch → tiles colapsavam para 2px.
    const tile = await a.page.locator('[role="group"]').first().boundingBox();
    expect(tile, 'tile de vídeo medido').toBeTruthy();
    expect(tile!.width, 'largura do tile de vídeo').toBeGreaterThan(150);
    expect(tile!.height, 'altura do tile de vídeo').toBeGreaterThan(100);
  });

  test('"Enviar" permanece legivel no hover (nao clareia o fundo)', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page);
    await joinRoom(a.page, roomId);

    // texto habilita o botao (disabled e isento pelo WCAG)
    await a.page.getByRole('button', { name: 'Abrir chat' }).click();
    await expect(a.page.getByTestId('chat-panel')).toBeVisible();

    await a.page.getByLabel('Mensagem').fill('oi');
    const send = a.page.getByRole('button', { name: 'Enviar' });
    await expect(send).toBeEnabled();

    await send.hover();
    // Botao so-icone: vale o contraste de componente nao textual (WCAG 1.4.11,
    // minimo 3:1) entre o icone (currentColor) e o fundo do botao no hover.
    await a.page.waitForTimeout(250);
    const ratio = await iconContrast(send);
    // eslint-disable-next-line no-console
    console.log(`
=== "Enviar" no hover === ${ratio.toFixed(2)}:1 (min 3.0, icone)`);
    expect(ratio, `"Enviar" no hover: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });

  test('o icone de microfone desligado do peer sem audio tambem passa', async ({ browser }) => {
    const a = await peer(browser);
    const roomId = await createRoom(a.page);
    await joinRoom(a.page, roomId);

    // B entra SEM midia: getUserMedia e rejeitado, o stream de B nao tem faixa de
    // audio e o tile de B em A mostra o icone de microfone desligado.
    const b = await peer(browser, { withMic: false, blockMedia: true });
    await joinRoom(b.page, roomId);

    await expect(participantItems(a.page)).toHaveCount(2, { timeout: 20_000 });

    // O redesign trocou o selo de texto pelo icone de microfone cortado.
    const icon = a.page.getByRole('img', { name: 'Microfone desligado' }).first();
    await expect(icon).toBeVisible({ timeout: 20_000 });
    const ratio = await iconContrast(icon);
    // eslint-disable-next-line no-console
    console.log(`
=== icone microfone desligado === ${ratio.toFixed(2)}:1 (min 3.0)`);
    expect(ratio, `icone "Microfone desligado": ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
  });
});

test.describe('contraste das paginas publicas', () => {
  // Cada pagina e auditada no estado em que ela carrega. Cobre o restante do
  // tema (mesmas classes `text-slate-500`/`btn-primary` usadas na sala).
  const pages = ['/', '/login', '/register', '/metrics', '/tutorial', '/docs'];

  for (const path of pages) {
    test(`"${path}" passa o WCAG AA`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status(), `GET ${path}`).toBeLessThan(400);

      await expectNoContrastFailures(page, `de "${path}"`);
      await expectNoClippedText(page, `em "${path}"`);
    });
  }
});
