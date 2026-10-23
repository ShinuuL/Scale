/**
 * Links de sala. O frontend e exportado como estaticos (`output: 'export'`),
 * entao a sala vive em `/room?id=<uuid>` (sem rota dinamica `/room/[id]`).
 * Links antigos `/room/<id>` continuam funcionando via redirect no Caddy.
 */

/** Caminho relativo da sala: `/room?id=<id>[&token=<convite>]`. */
export function roomPath(roomId: string, inviteToken?: string | null): string {
  const params = new URLSearchParams({ id: roomId });
  if (inviteToken) params.set('token', inviteToken);
  return `/room?${params.toString()}`;
}

/** URL absoluta (para copiar/compartilhar) no origin atual. */
export function roomUrl(roomId: string, inviteToken?: string | null): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${roomPath(roomId, inviteToken)}`;
}
