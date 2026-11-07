import { originOf } from './serverUrl';

/**
 * Permissoes que o Scale usa: microfone ('media' so audio), captura de tela,
 * escolha da saida de audio ('speaker-selection', setSinkId/audiooutput, so no
 * frame principal) e notificacoes (frame principal + consentimento explicito).
 */
export const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set(['media', 'display-capture', 'speaker-selection', 'notifications']);

export interface PermissionRequest {
  permission: string;
  /** URL (ou origin) de quem pede. */
  requestingUrl: string;
  /** Origin do servidor configurado; null = nenhum servidor => nega tudo. */
  allowedOrigin: string | null;
  /**
   * Para 'media': tipos pedidos ('audio' | 'video'). O Scale so usa microfone,
   * entao camera e negada. Lista vazia = pedido do getDisplayMedia (o Electron
   * o anuncia como 'media' sem tipos); a escolha real passa pelo seletor
   * proprio (setDisplayMediaRequestHandler), que tambem confere a origin.
   */
  mediaTypes?: readonly string[];
  isMainFrame?: boolean;
  notificationConsent?: boolean;
}

export function isPermissionAllowed(req: PermissionRequest): boolean {
  if (req.allowedOrigin === null) return false;
  if (!ALLOWED_PERMISSIONS.has(req.permission)) return false;
  if (originOf(req.requestingUrl) !== req.allowedOrigin) return false;
  if (req.permission === 'notifications') return req.isMainFrame === true && req.notificationConsent === true;
  if (req.permission === 'speaker-selection') return req.isMainFrame === true;
  if (req.permission === 'media') {
    const types = req.mediaTypes ?? [];
    return types.every((t) => t === 'audio');
  }
  return true;
}
