import type { ChannelKind, CommunityLayout } from '@scale/shared';

/**
 * Agrupamento e reordenacao da lista de canais (logica pura, testada a parte).
 * Ordem na tela: canais SEM categoria nos grupos de texto e voz (como antes),
 * depois cada categoria pela posicao. O servidor guarda uma posicao global por
 * canal; a lista enviada segue exatamente essa ordem.
 */
export interface LayoutChannel {
  id: string;
  name: string;
  kind: ChannelKind;
  position: number;
  /** Ausente ou null = sem categoria. */
  categoryId?: string | null;
}
export interface LayoutCategory {
  id: string;
  name: string;
  position: number;
}
export type ChannelSection<C extends LayoutChannel> =
  | { type: 'kind'; key: string; kind: ChannelKind; channels: C[] }
  | { type: 'category'; key: string; category: LayoutCategory; channels: C[] };

const byPosition = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

export function buildSections<C extends LayoutChannel>(channels: C[], categories: LayoutCategory[]): ChannelSection<C>[] {
  const sorted = [...channels].sort(byPosition);
  const known = new Set(categories.map((c) => c.id));
  const loose = sorted.filter((c) => c.categoryId == null || !known.has(c.categoryId));
  return [
    ...(['TEXT', 'VOICE'] as const).map((kind) => ({
      type: 'kind' as const, key: `kind:${kind}`, kind, channels: loose.filter((c) => c.kind === kind),
    })),
    ...[...categories].sort(byPosition).map((category) => ({
      type: 'category' as const, key: `category:${category.id}`, category, channels: sorted.filter((c) => c.categoryId === category.id),
    })),
  ];
}

/** Layout completo para PUT /layout, a partir das secoes na ordem da tela. */
export function toLayout<C extends LayoutChannel>(sections: ChannelSection<C>[]): CommunityLayout {
  return {
    categories: sections.flatMap((s) => (s.type === 'category' ? [s.category.id] : [])),
    channels: sections.flatMap((s) => s.channels.map((c) => ({ id: c.id, categoryId: s.type === 'category' ? s.category.id : null }))),
  };
}

/** Secao (e indice) onde esta o canal. */
function locate<C extends LayoutChannel>(sections: ChannelSection<C>[], id: string) {
  for (const [si, section] of sections.entries()) {
    const index = section.channels.findIndex((c) => c.id === id);
    if (index >= 0) return { si, index };
  }
  return null;
}

/** Secao de destino ao soltar sem categoria: o grupo do tipo do canal. */
function targetSectionIndex<C extends LayoutChannel>(sections: ChannelSection<C>[], si: number, channel: C): number {
  const section = sections[si];
  if (section?.type === 'kind' && section.kind !== channel.kind) return sections.findIndex((s) => s.type === 'kind' && s.kind === channel.kind);
  return si;
}

function withChannels<C extends LayoutChannel>(sections: ChannelSection<C>[], si: number, channels: C[]): ChannelSection<C>[] {
  return sections.map((s, i) => (i === si ? { ...s, channels } : s));
}

/**
 * Arrastar `id` sobre `targetId`: o canal assume a categoria do alvo e fica
 * no lugar dele. Sem categoria, cai no grupo do proprio tipo. null = nada muda.
 */
export function dropOnChannel<C extends LayoutChannel>(sections: ChannelSection<C>[], id: string, targetId: string): CommunityLayout | null {
  if (id === targetId) return null;
  const from = locate(sections, id); const to = locate(sections, targetId);
  if (!from || !to) return null;
  const channel = sections[from.si]!.channels[from.index]!;
  const toSi = targetSectionIndex(sections, to.si, channel);
  let next = withChannels(sections, from.si, sections[from.si]!.channels.filter((c) => c.id !== id));
  const list = [...next[toSi]!.channels];
  const targetIndex = toSi === to.si ? list.findIndex((c) => c.id === targetId) : list.length;
  // Descendo na mesma secao: fica DEPOIS do alvo (como no rail de comunidades).
  const insertAt = from.si === toSi && from.index <= targetIndex ? targetIndex + 1 : Math.max(0, targetIndex);
  list.splice(insertAt, 0, channel);
  next = withChannels(next, toSi, list);
  return toLayout(next);
}

/** Soltar no titulo da categoria (ou do grupo): vai para o fim dela. */
export function dropOnSection<C extends LayoutChannel>(sections: ChannelSection<C>[], id: string, sectionKey: string): CommunityLayout | null {
  const from = locate(sections, id);
  const si = sections.findIndex((s) => s.key === sectionKey);
  if (!from || si < 0) return null;
  const channel = sections[from.si]!.channels[from.index]!;
  const toSi = targetSectionIndex(sections, si, channel);
  if (toSi === from.si && from.index === sections[toSi]!.channels.length - 1) return null;
  let next = withChannels(sections, from.si, sections[from.si]!.channels.filter((c) => c.id !== id));
  next = withChannels(next, toSi, [...next[toSi]!.channels, channel]);
  return toLayout(next);
}

/** Alt+Seta: troca com o vizinho dentro da mesma secao. null = na borda. */
export function moveChannel<C extends LayoutChannel>(sections: ChannelSection<C>[], id: string, delta: -1 | 1): CommunityLayout | null {
  const from = locate(sections, id);
  if (!from) return null;
  const list = [...sections[from.si]!.channels];
  const target = from.index + delta;
  if (target < 0 || target >= list.length) return null;
  const [channel] = list.splice(from.index, 1);
  list.splice(target, 0, channel!);
  return toLayout(withChannels(sections, from.si, list));
}

/** Alt+Seta no titulo da categoria: move a categoria inteira. */
export function moveCategory<C extends LayoutChannel>(sections: ChannelSection<C>[], categoryId: string, delta: -1 | 1): CommunityLayout | null {
  const cats = sections.filter((s) => s.type === 'category');
  const index = cats.findIndex((s) => s.type === 'category' && s.category.id === categoryId);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= cats.length) return null;
  const reordered = [...cats];
  const [moved] = reordered.splice(index, 1);
  reordered.splice(target, 0, moved!);
  return toLayout([...sections.filter((s) => s.type === 'kind'), ...reordered]);
}

/** Muda so a categoria de um canal (Configuracoes): vai para o fim do destino. */
export function setChannelCategory<C extends LayoutChannel>(sections: ChannelSection<C>[], id: string, categoryId: string | null): CommunityLayout | null {
  const from = locate(sections, id);
  if (!from) return null;
  const channel = sections[from.si]!.channels[from.index]!;
  const key = categoryId === null ? `kind:${channel.kind}` : `category:${categoryId}`;
  if (sections[from.si]!.key === key) return null;
  return dropOnSection(sections, id, key);
}

/** Aplica o layout localmente (atualizacao otimista antes da resposta). */
export function applyLayout<C extends LayoutChannel, K extends LayoutCategory>(channels: C[], categories: K[], layout: CommunityLayout): { channels: C[]; categories: K[] } {
  const channelOrder = new Map(layout.channels.map((c, position) => [c.id, { position, categoryId: c.categoryId }]));
  const categoryOrder = new Map(layout.categories.map((id, position) => [id, position]));
  return {
    channels: channels.map((c) => { const o = channelOrder.get(c.id); return o ? { ...c, ...o } : c; }).sort(byPosition),
    categories: categories.map((c) => ({ ...c, position: categoryOrder.get(c.id) ?? c.position })).sort(byPosition),
  };
}

const COLLAPSED_KEY = 'scale:collapsed-categories';

/** Categorias recolhidas (so neste navegador). */
export function readCollapsed(): string[] {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function writeCollapsed(ids: string[]): void {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(ids));
  } catch {
    // Sem storage: vale ate recarregar.
  }
}
