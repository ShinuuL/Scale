import { z } from 'zod';

/**
 * Hosts aceitos em http:// (apenas desenvolvimento local). Qualquer outro host
 * exige https:// — getUserMedia e o cookie de sessao precisam de contexto seguro.
 */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);

export const MAX_SERVER_URL_LENGTH = 2048;

export type ServerUrlResult = { ok: true; origin: string } | { ok: false; error: string };

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/**
 * Schema zod do endereco do servidor. Aceita somente uma origin
 * (esquema + host + porta); o resultado e a origin normalizada.
 */
export const serverUrlSchema = z
  .string({ required_error: 'Informe o endereço do servidor.', invalid_type_error: 'Endereço inválido.' })
  .trim()
  .min(1, 'Informe o endereço do servidor.')
  .max(MAX_SERVER_URL_LENGTH, 'Endereço longo demais.')
  .transform((value, ctx): string => {
    const url = tryParseUrl(value);
    if (!url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Endereço inválido. Exemplo: https://scale.exemplo.com.br' });
      return z.NEVER;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use um endereço https://.' });
      return z.NEVER;
    }
    if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'O servidor precisa usar https://. http:// só é aceito para localhost.',
      });
      return z.NEVER;
    }
    if (url.username !== '' || url.password !== '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Não inclua usuário ou senha no endereço.' });
      return z.NEVER;
    }
    // new URL normaliza "https://host" para pathname "/"; qualquer outro path e recusado.
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '' || /[?#]/.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Informe apenas o endereço base, sem caminho ou parâmetros (ex.: https://scale.exemplo.com.br).',
      });
      return z.NEVER;
    }
    return url.origin;
  });

export function parseServerUrl(input: unknown): ServerUrlResult {
  const parsed = serverUrlSchema.safeParse(input);
  if (parsed.success) return { ok: true, origin: parsed.data };
  return { ok: false, error: parsed.error.issues[0]?.message ?? 'Endereço inválido.' };
}

/** Origin de uma URL qualquer, ou null se nao for parseavel / for opaca. */
export function originOf(value: string): string | null {
  const url = tryParseUrl(value);
  if (!url || url.origin === 'null') return null;
  return url.origin;
}
