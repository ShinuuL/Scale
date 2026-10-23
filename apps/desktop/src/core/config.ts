import { z } from 'zod';
import { serverUrlSchema } from './serverUrl';

export const MIN_WIDTH = 960;
export const MIN_HEIGHT = 600;
export const DEFAULT_WIDTH = 1280;
export const DEFAULT_HEIGHT = 800;

export const windowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(MIN_WIDTH).max(20000),
  height: z.number().int().min(MIN_HEIGHT).max(20000),
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof windowStateSchema>;

export const appConfigSchema = z
  .object({
    version: z.literal(1),
    // Revalida a origin ao ler: um config adulterado com http:// remoto,
    // credenciais ou path e descartado e o setup volta a aparecer.
    serverOrigin: serverUrlSchema,
  })
  .strict();
export type AppConfig = z.infer<typeof appConfigSchema>;

/** Le o JSON do config. Qualquer problema (JSON invalido, schema) => null. */
export function parseConfig(raw: string): AppConfig | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = appConfigSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/** Le o JSON do estado da janela (arquivo separado). Invalido => null. */
export function parseWindowState(raw: string): WindowState | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = windowStateSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export function serializeConfig(config: AppConfig): string {
  return `${JSON.stringify(appConfigSchema.parse(config), null, 2)}\n`;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * A posicao salva so e reaproveitada se ao menos 100x50 px da janela caem
 * dentro de algum monitor atual (evita janela "perdida" apos desconectar um monitor).
 */
export function isRectVisible(rect: Rect, workAreas: readonly Rect[]): boolean {
  return workAreas.some((area) => {
    const w = Math.min(rect.x + rect.width, area.x + area.width) - Math.max(rect.x, area.x);
    const h = Math.min(rect.y + rect.height, area.y + area.height) - Math.max(rect.y, area.y);
    return w >= 100 && h >= 50;
  });
}
