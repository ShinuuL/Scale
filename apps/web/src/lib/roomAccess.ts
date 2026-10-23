/**
 * Credenciais de sala protegida para os GET do chat (historico e download).
 *
 * Vao SEMPRE por header — nunca pela query string, que fica em log de proxy,
 * historico do navegador e Referer. A senha e percent-encoded: headers HTTP sao
 * Latin-1 e o servidor decodifica (apps/server/src/lib/roomAccess.ts).
 */
export function roomAccessHeaders(inviteToken?: string, password?: string): Record<string, string> {
  const headers: Record<string, string> = {};
  if (inviteToken) headers['X-Room-Invite'] = inviteToken;
  if (password) headers['X-Room-Password'] = encodeURIComponent(password);
  return headers;
}

/**
 * Download de arquivo de sala protegida: um `<a href>` nao envia header, entao
 * buscamos com fetch (credencial no header), geramos um blob e disparamos o
 * download por um link temporario. Nada sensivel vai para a URL.
 */
export async function downloadRoomFile(
  fileId: string,
  filename: string,
  inviteToken?: string,
  password?: string,
): Promise<void> {
  const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, {
    credentials: 'include',
    headers: roomAccessHeaders(inviteToken, password),
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
