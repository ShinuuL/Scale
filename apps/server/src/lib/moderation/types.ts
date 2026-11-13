import type { ModerationVerdict } from '@scale/shared';

export type { ModerationVerdict };

/** Veredito neutro (nada encontrado). */
export const NONE_VERDICT: ModerationVerdict = {
  flagged: false,
  category: 'none',
  severity: 'low',
  reason: 'none',
};

/** Provedor falhou (timeout, rede, resposta invalida): fail-open. */
export const PROVIDER_ERROR_VERDICT: ModerationVerdict = {
  flagged: false,
  category: 'none',
  severity: 'low',
  reason: 'provider_error',
};

export interface ModerationProvider {
  readonly name: 'off' | 'heuristic' | 'claude';
  classifyText(text: string, ctx: { lang: 'pt' }): Promise<ModerationVerdict>;
  /** So provedores com visao (`claude`). O frame nunca e gravado nem logado. */
  classifyImage?(jpeg: Buffer): Promise<ModerationVerdict>;
}
