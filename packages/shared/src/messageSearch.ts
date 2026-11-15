import { z } from 'zod';

/** Busca de mensagens nas comunidades (Fase 2). */
export const MESSAGE_SEARCH_MIN = 2;
export const MESSAGE_SEARCH_MAX = 100;
export const MESSAGE_SEARCH_PAGE = 25;

export const messageSearchQuerySchema = z.object({
  q: z.string().trim().min(MESSAGE_SEARCH_MIN).max(MESSAGE_SEARCH_MAX),
  channelId: z.string().uuid().optional(),
  authorId: z.string().min(1).max(64).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().uuid().optional(),
}).refine((v) => !v.from || !v.to || Date.parse(v.from) <= Date.parse(v.to), { message: 'from > to', path: ['from'] });
export type MessageSearchQuery = z.infer<typeof messageSearchQuerySchema>;

export interface MessageSearchHit {
  id: string;
  channelId: string;
  channelName: string;
  author: { id: string | null; name: string; username: string | null };
  content: string;
  createdAt: string;
}
export interface MessageSearchResponse { results: MessageSearchHit[]; nextCursor: string | null }

/**
 * Normaliza para comparar sem caixa e sem acento: NFD, remove marcas
 * combinantes e passa para minusculas. Cada caractere de origem vira 1+ unidades;
 * `map[i]` aponta o indice no texto original de cada unidade normalizada.
 */
export function normalizeForSearch(text: string): { value: string; map: number[] } {
  let value = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < base.length; k++) { value += base[k]; map.push(i); }
    i += ch.length;
  }
  return { value, map };
}

export function matchesSearch(text: string, query: string): boolean {
  const q = normalizeForSearch(query.trim()).value;
  return q.length > 0 && normalizeForSearch(text).value.includes(q);
}

/** Divide o texto em trechos com/sem destaque (sem HTML: o consumidor renderiza como texto). */
export function splitHighlight(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const q = normalizeForSearch(query.trim()).value;
  if (!q) return [{ text, hit: false }];
  const { value, map } = normalizeForSearch(text);
  const parts: Array<{ text: string; hit: boolean }> = [];
  let last = 0;
  let from = 0;
  for (;;) {
    const at = value.indexOf(q, from);
    if (at < 0) break;
    const start = map[at] ?? text.length;
    const endUnit = at + q.length;
    const end = endUnit < map.length ? (map[endUnit] ?? text.length) : text.length;
    if (start > last) parts.push({ text: text.slice(last, start), hit: false });
    if (end > start) parts.push({ text: text.slice(start, end), hit: true });
    last = Math.max(last, end);
    from = endUnit;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return parts.length ? parts : [{ text, hit: false }];
}
