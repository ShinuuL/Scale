import type { ModerationOverrides } from '@scale/shared';

/** Aviso deixado na home quando alguem sem permissao abre /admin/moderation. */
export const ADMIN_ONLY_FLASH = 'A administração é restrita aos administradores deste servidor.';

/** Campos com override (banco > .env). `apiKey` e tratado a parte. */
export type OverrideField = keyof ModerationOverrides;

export const FIELD_LABELS: Record<OverrideField | 'apiKey', string> = {
  provider: 'Provedor',
  model: 'Modelo',
  screenEnabled: 'Análise de tela',
  frameIntervalSec: 'Intervalo das amostras',
  retentionDays: 'Retenção dos eventos',
  minAge: 'Idade mínima',
  privacyContactEmail: 'Contato do encarregado',
  apiKey: 'Chave de API',
};

export const PROVIDER_LABELS: Record<'off' | 'heuristic' | 'claude', string> = {
  off: 'Desligado',
  heuristic: 'Heurística local',
  claude: 'Claude API',
};

/** Valor de um campo em texto para o usuario (status "Usando .env" e auditoria). */
export function formatFieldValue(field: string, value: unknown): string {
  if (field === 'apiKey') {
    if (value === 'set') return 'definida';
    if (value === 'cleared') return 'removida';
    return value == null ? 'sem chave' : String(value);
  }
  if (value === null || value === undefined) return '.env';
  if (field === 'provider' && typeof value === 'string' && value in PROVIDER_LABELS) {
    return PROVIDER_LABELS[value as keyof typeof PROVIDER_LABELS];
  }
  if (typeof value === 'boolean') return value ? 'ligada' : 'desligada';
  if (field === 'frameIntervalSec') return `${String(value)} s`;
  if (field === 'retentionDays') return `${String(value)} dias`;
  if (field === 'minAge') return `${String(value)} anos`;
  if (value === '') return 'vazio';
  return String(value);
}

export function fieldLabel(field: string): string {
  return field in FIELD_LABELS ? FIELD_LABELS[field as keyof typeof FIELD_LABELS] : field;
}
