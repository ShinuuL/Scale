/** Tela de consentimento de app conectado (MCP), com a query do pedido. */
const CONSENT_RE = /^\/oauth\/authorize\?[^\\#\s]*$/;

/** Destinos internos permitidos após autenticação. */
export function authNext(value: string | null): string {
  if (value === '/invite' || value === '/communities') return value;
  // So o caminho exato, mesmo origin; a query e revalidada pelo servidor.
  if (value && CONSENT_RE.test(value)) return value;
  return '/';
}

/**
 * Login com GitHub/Google volta para "/" (o callback nao conhece o `next`).
 * Antes de sair, a tela de login guarda aqui o pedido de consentimento; a
 * home o recupera em ate 10 min e volta para ele.
 */
const CONSENT_RETURN_KEY = 'scale:oauth-consent-return';
const CONSENT_RETURN_TTL_MS = 10 * 60 * 1000;

export function rememberConsentReturn(next: string | null): void {
  if (!next || !CONSENT_RE.test(next)) return;
  try { sessionStorage.setItem(CONSENT_RETURN_KEY, JSON.stringify({ next, at: Date.now() })); } catch { /* sem storage: so perde o retorno */ }
}

export function takeConsentReturn(): string | null {
  try {
    const raw = sessionStorage.getItem(CONSENT_RETURN_KEY);
    sessionStorage.removeItem(CONSENT_RETURN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { next?: unknown; at?: unknown };
    if (typeof parsed.next !== 'string' || typeof parsed.at !== 'number') return null;
    const age = Date.now() - parsed.at;
    return age >= 0 && age < CONSENT_RETURN_TTL_MS && CONSENT_RE.test(parsed.next) ? parsed.next : null;
  } catch { return null; }
}
