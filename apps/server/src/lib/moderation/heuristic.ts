import type { ModerationCategory, ModerationSeverity } from '@scale/shared';
import { NONE_VERDICT, type ModerationProvider, type ModerationVerdict } from './types.js';

/**
 * Provedor heuristico (default): lista PT-BR de termos de ofensa, bullying,
 * odio, sexual e violencia + sinais de contexto. Nada sai do servidor.
 *
 * Severidade base por termo (1 = low, 2 = medium, 3 = high); os sinais sobem
 * um nivel: insulto DIRIGIDO a uma @mencao, repeticao do termo ou grito em
 * caixa alta. `reason` e curto e nunca copia o texto analisado.
 */
interface Term {
  /** Raiz normalizada (sem acento, minuscula); casa como palavra inteira. */
  re: RegExp;
  category: Exclude<ModerationCategory, 'none'>;
  level: 1 | 2 | 3;
}

function word(pattern: string): RegExp {
  return new RegExp(`(?<![a-z0-9])(?:${pattern})(?![a-z0-9])`, 'i');
}

const TERMS: Term[] = [
  // bullying / insulto pessoal
  { re: word('idiota|imbecil|burr[oa]|otari[oa]|babac[ao]|trouxa|ridicul[oa]|lix[oa]|inutil|patetic[oa]'), category: 'bullying', level: 2 },
  { re: word('retardad[oa]|mongol(?:oide)?|debil mental|aleijad[oa]'), category: 'bullying', level: 3 },
  { re: word('fei[oa]|gord[oa]|baleia|nojent[oa]|fedid[oa]|verme|escori[ao]'), category: 'bullying', level: 2 },
  { re: word('se mata|vai se matar|te mata|ninguem te quer|ninguem gosta de voce|some daqui'), category: 'bullying', level: 3 },
  { re: word('vagabund[oa]|vadi[ao]|piranha|arrombad[oa]|desgracad[oa]|fdp|filh[oa] da puta|vai se foder|vsf|vai tomar no cu|vtnc|cuzao|cuzona|merda|bosta|porra|caralho'), category: 'bullying', level: 2 },
  // odio (grupo)
  { re: word('macac[oa]|crioul[oa]|preto sujo|preta suja|negro sujo|negra suja'), category: 'hate', level: 3 },
  { re: word('viad[oa]|viadinho|bicha|sapatao|traveco|boiola|baitola'), category: 'hate', level: 3 },
  { re: word('judeu safado|nazista|heil hitler|supremacia branca|raca inferior|sub-?raca|sub humano'), category: 'hate', level: 3 },
  { re: word('nordestin[oa] burr[oa]|paraiba burr[oa]|baiano preguicoso|xingling'), category: 'hate', level: 3 },
  // sexual
  { re: word('estupr[oa]r?|estupro|pedofil[oa]|pedofilia|nudes?|manda nude|pornografia|sexo com'), category: 'sexual', level: 3 },
  { re: word('buceta|xoxota|xereca|rola|pau duro|chupa|gozad[oa]|siririca|punheta'), category: 'sexual', level: 2 },
  // violencia / ameaca
  { re: word('vou te matar|te mato|vou te bater|te quebro|vou te quebrar|te arrebento|vou te arrebentar|quebrar sua cara|te pego na saida|te esfaqueio|te dou um tiro|vou te estuprar'), category: 'violence', level: 3 },
  { re: word('matar|espancar|esfaquear|atirar em|bomba|massacre|chacina'), category: 'violence', level: 1 },
];

/** Minusculas, sem acentos, letras repetidas 3+ viram 2 (burrrro -> burro). */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/([a-z])\1{2,}/g, '$1$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const SEVERITIES: ModerationSeverity[] = ['low', 'medium', 'high'];

function toSeverity(level: number): ModerationSeverity {
  return SEVERITIES[Math.max(1, Math.min(3, level)) - 1];
}

const MENTION_RE = /@[\w][\w .-]{0,49}/;

/** Grito: >= 12 letras e >= 70% maiusculas no texto ORIGINAL. */
export function isShouting(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return upper / letters.length >= 0.7;
}

export function classifyTextHeuristic(text: string): ModerationVerdict {
  const normalized = normalizeText(text);
  if (!normalized) return NONE_VERDICT;

  let best: { term: Term; hits: number } | null = null;
  for (const term of TERMS) {
    const global = new RegExp(term.re.source, 'gi');
    const hits = normalized.match(global)?.length ?? 0;
    if (hits === 0) continue;
    if (!best || term.level > best.term.level || (term.level === best.term.level && hits > best.hits)) {
      best = { term, hits };
    }
  }
  if (!best) return NONE_VERDICT;

  const signals: string[] = [];
  let level: number = best.term.level;
  if (MENTION_RE.test(text)) {
    level += 1;
    signals.push('mention');
  }
  if (best.hits >= 3) {
    level += 1;
    signals.push('repeat');
  }
  if (isShouting(text)) {
    level += 1;
    signals.push('caps');
  }

  const severity = toSeverity(level);
  return {
    flagged: true,
    category: best.term.category,
    severity,
    reason: ['term', ...signals].join('+'),
  };
}

export const heuristicProvider: ModerationProvider = {
  name: 'heuristic',
  async classifyText(text) {
    return classifyTextHeuristic(text);
  },
};
