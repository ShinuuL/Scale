import { z } from 'zod';

/** Resposta esperada de GET <origin>/api/health. */
export const healthResponseSchema = z.object({ status: z.literal('ok') }).passthrough();

export function healthUrl(origin: string): string {
  return new URL('/api/health', origin).toString();
}

export function isHealthy(body: unknown): boolean {
  return healthResponseSchema.safeParse(body).success;
}

/** Argumento de setup:test-and-save vindo do renderer. */
export const setupSubmitSchema = z.string().max(4096);

/**
 * Escolha do seletor de tela. O id precisa existir na lista enviada ao
 * renderer (checado no main); aqui so validamos o formato.
 */
export const pickerChoiceSchema = z
  .object({
    sourceId: z.string().regex(/^(screen|window):[A-Za-z0-9:_-]{1,200}$/),
    shareAudio: z.boolean(),
  })
  .strict();
export type PickerChoice = z.infer<typeof pickerChoiceSchema>;

export type SetupResult = { ok: true } | { ok: false; error: string };

export interface PickerSource {
  id: string;
  name: string;
  kind: 'screen' | 'window';
  thumbnail: string;
}

export interface PickerInit {
  sources: PickerSource[];
  /** Plataforma suporta audio do sistema (loopback = Windows). */
  audioPlatform: boolean;
  /** Opcao habilitada: plataforma suporta E a pagina pediu audio no getDisplayMedia. */
  audioAvailable: boolean;
}
