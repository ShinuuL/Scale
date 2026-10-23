import type { PickerInit, PickerSource } from '../../core/ipcSchemas';
import type { PickerBridge } from '../../types/bridge';

declare global {
  interface Window {
    scalePicker: PickerBridge;
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Icones no padrao do projeto: viewBox 24, stroke currentColor, 1.75. */
const ICON_PATHS: Record<PickerSource['kind'], string[]> = {
  screen: ['M3 5h18v11H3z', 'M8 20h8', 'M12 16v4'],
  window: ['M3 5h18v14H3z', 'M3 9h18', 'M6.5 7h.01', 'M9 7h.01'],
};

function icon(kind: PickerSource['kind'], size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of ICON_PATHS[kind]) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`elemento #${id} ausente`);
  return node as T;
}

const screensList = el<HTMLDivElement>('screens');
const windowsList = el<HTMLDivElement>('windows');
const empty = el<HTMLParagraphElement>('empty');
const shareBtn = el<HTMLButtonElement>('share');
const cancelBtn = el<HTMLButtonElement>('cancel');
const audioWrap = el<HTMLLabelElement>('audio-wrap');
const audioBox = el<HTMLInputElement>('audio');
const audioNote = el<HTMLSpanElement>('audio-note');

let items: HTMLButtonElement[] = [];
let selectedId: string | null = null;

function select(button: HTMLButtonElement, focus: boolean): void {
  for (const it of items) {
    const on = it === button;
    it.setAttribute('aria-selected', String(on));
    it.tabIndex = on ? 0 : -1;
  }
  selectedId = button.dataset.id ?? null;
  shareBtn.disabled = selectedId === null;
  if (focus) button.focus();
}

function share(): void {
  if (!selectedId) return;
  window.scalePicker.choose(selectedId, audioBox.checked && !audioBox.disabled);
}

function buildItem(source: PickerSource): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'item';
  button.setAttribute('role', 'option');
  button.setAttribute('aria-selected', 'false');
  button.tabIndex = -1;
  button.dataset.id = source.id;

  const thumb = document.createElement('div');
  thumb.className = 'thumb';
  if (source.thumbnail.startsWith('data:image/')) {
    const img = document.createElement('img');
    img.src = source.thumbnail;
    img.alt = '';
    thumb.appendChild(img);
  } else {
    thumb.appendChild(icon(source.kind, 32));
  }

  const label = document.createElement('div');
  label.className = 'label';
  label.appendChild(icon(source.kind, 16));
  const name = document.createElement('span');
  name.textContent = source.name || (source.kind === 'screen' ? 'Tela' : 'Janela sem título');
  name.title = name.textContent;
  label.appendChild(name);

  button.append(thumb, label);
  button.addEventListener('click', () => select(button, false));
  button.addEventListener('dblclick', () => {
    select(button, false);
    share();
  });
  return button;
}

function render(init: PickerInit): void {
  const screens = init.sources.filter((s) => s.kind === 'screen');
  const windows = init.sources.filter((s) => s.kind === 'window');
  screensList.replaceChildren(...screens.map(buildItem));
  windowsList.replaceChildren(...windows.map(buildItem));
  screensList.closest('section')?.toggleAttribute('hidden', screens.length === 0);
  windowsList.closest('section')?.toggleAttribute('hidden', windows.length === 0);
  empty.hidden = init.sources.length > 0;
  items = Array.from(document.querySelectorAll<HTMLButtonElement>('.item'));

  audioWrap.hidden = !init.audioPlatform;
  audioBox.checked = false;
  audioBox.disabled = !init.audioAvailable;
  audioNote.textContent = init.audioPlatform && !init.audioAvailable ? '(esta chamada não solicitou áudio)' : '';

  const first = items[0];
  if (first) select(first, true);
  else cancelBtn.focus();
}

function columns(): number {
  const first = items[0];
  if (!first) return 1;
  const top = first.offsetTop;
  let n = 0;
  for (const it of items) {
    if (it.offsetTop !== top || it.parentElement !== first.parentElement) break;
    n += 1;
  }
  return Math.max(1, n);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    window.scalePicker.cancel();
    return;
  }
  const current = items.findIndex((it) => it.dataset.id === selectedId);
  const onItem = document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('item');
  if (e.key === 'Enter' && onItem) {
    e.preventDefault();
    share();
    return;
  }
  if (!onItem || current < 0) return;
  const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns(), ArrowUp: -columns() };
  const delta = step[e.key];
  if (delta === undefined) return;
  e.preventDefault();
  const next = items[Math.min(items.length - 1, Math.max(0, current + delta))];
  if (next) select(next, true);
});

shareBtn.addEventListener('click', share);
cancelBtn.addEventListener('click', () => window.scalePicker.cancel());

void window.scalePicker.init().then((init) => {
  if (init) render(init);
});
