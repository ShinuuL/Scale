/**
 * Aviso de uma pagina para a proxima (ex.: "Sala apagada" depois de sair da
 * sala para a home com navegacao completa). Vive em sessionStorage e e lido
 * uma unica vez. Storage indisponivel (aba privada, bloqueio) = sem aviso.
 */
const FLASH_KEY = 'scale.flash';

export type FlashVariant = 'success' | 'error' | 'info';

export interface Flash {
  message: string;
  variant: FlashVariant;
}

export function setFlash(message: string, variant: FlashVariant = 'info'): void {
  try {
    window.sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, variant }));
  } catch {
    /* storage bloqueado: segue sem aviso */
  }
}

export function takeFlash(): Flash | null {
  try {
    const raw = window.sessionStorage.getItem(FLASH_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(FLASH_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Flash).message === 'string' &&
      ['success', 'error', 'info'].includes((parsed as Flash).variant)
    ) {
      return parsed as Flash;
    }
    return null;
  } catch {
    return null;
  }
}
