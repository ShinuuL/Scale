/**
 * Prova de participacao na sala para os REST do chat (historico, download e
 * upload): o room ticket que o servidor emite no join-room (evento
 * `room:ticket`). Vai SEMPRE por header — nunca pela query string, que fica em
 * log de proxy, historico do navegador e Referer.
 */
export function roomTicketHeaders(ticket: string | null | undefined): Record<string, string> {
  return ticket ? { 'X-Room-Ticket': ticket } : {};
}

/**
 * Convite da URL para o GET /api/rooms/:id (detalhes de sala privada antes do
 * join). Tambem por header.
 */
export function roomInviteHeaders(inviteToken?: string): Record<string, string> {
  return inviteToken ? { 'X-Room-Invite': inviteToken } : {};
}

/**
 * Download de arquivo: um `<a href>` nao envia header, entao buscamos com
 * fetch (ticket no header), geramos um blob e disparamos o download por um link
 * temporario. Nada sensivel vai para a URL.
 */
export async function downloadRoomFile(
  fileId: string,
  filename: string,
  ticket: string | null | undefined,
): Promise<void> {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    credentials: 'include',
    headers: roomTicketHeaders(ticket),
  });
  if (!res.ok) throw new Error(`Falha no download (HTTP ${res.status}).`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
