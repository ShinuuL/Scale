import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';

/**
 * Um handler IPC so atende o webContents esperado E o frame principal
 * carregado do arquivo local esperado (nunca a pagina remota do servidor).
 */
export function isTrustedSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  expected: WebContents | null | undefined,
  expectedFileUrl: string,
): boolean {
  if (!expected || expected.isDestroyed()) return false;
  if (event.sender.id !== expected.id) return false;
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return false;
  return frame.url === expectedFileUrl;
}
