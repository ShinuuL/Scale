/**
 * Login com Google (OAuth 2.0 / OpenID Connect, fluxo authorization code).
 *
 * Configuracao opcional: sem GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/PUBLIC_URL o
 * recurso fica desligado (o botao some do frontend e as rotas mandam para
 * /login?google=desligado).
 *
 * Escopos: `openid email profile`. A identidade vem do endpoint userinfo com o
 * access token (canal TLS direto com o Google, servidor a servidor), que e
 * descartado no fim do callback: nunca gravado, nunca logado.
 */
import { z } from 'zod';

const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const GOOGLE_SCOPES = 'openid email profile';
const GOOGLE_TIMEOUT_MS = 10_000;

/** Caminho do callback; a URL completa (PUBLIC_URL + isto) e a cadastrada no Google Cloud. */
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

const googleEnvSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().trim().default(''),
  GOOGLE_CLIENT_SECRET: z.string().trim().default(''),
  PUBLIC_URL: z.string().trim().default(''),
});

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

/** Le a configuracao a cada chamada. Devolve null quando desligado ou incompleto. */
export function getGoogleConfig(): GoogleConfig | null {
  const env = googleEnvSchema.parse(process.env);
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.PUBLIC_URL) return null;
  const base = z.string().url().safeParse(env.PUBLIC_URL);
  if (!base.success) {
    throw new Error(`PUBLIC_URL invalida: "${env.PUBLIC_URL}" (ex.: https://scale.exemplo.com)`);
  }
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackUrl: `${base.data.replace(/\/+$/, '')}${GOOGLE_CALLBACK_PATH}`,
  };
}

export function buildGoogleAuthorizeUrl(config: GoogleConfig, state: string): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SCOPES);
  url.searchParams.set('state', state);
  // Deixa escolher a conta (quem tem varias contas Google no navegador).
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

/** Erro de comunicacao com o Google (rede, status inesperado, resposta fora do schema). */
export class GoogleApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleApiError';
  }
}

const tokenResponseSchema = z.object({ access_token: z.string().min(1) });

const userinfoSchema = z.object({
  sub: z.string().min(1).max(255),
  email: z.string().email().optional(),
  email_verified: z.boolean().optional(),
  name: z.string().optional(),
});

export interface GoogleIdentity {
  googleId: string;
  name: string | null;
  /** E-mail VERIFICADO pelo Google; null se nao houver. */
  email: string | null;
}

async function googleFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) });
  } catch (err) {
    throw new GoogleApiError(`falha de rede com o Google: ${(err as Error).name}`);
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new GoogleApiError('resposta do Google nao e JSON');
  }
}

/** Troca o `code` do callback por um access token. Devolve null se o code for recusado. */
export async function exchangeGoogleCode(config: GoogleConfig, code: string): Promise<string | null> {
  const res = await googleFetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: config.callbackUrl,
    }).toString(),
  });
  // 400 = invalid_grant (code expirado, reusado ou forjado): recusa, nao falha de API.
  if (res.status === 400) return null;
  if (!res.ok) throw new GoogleApiError(`Google respondeu ${res.status} no token`);
  const parsed = tokenResponseSchema.safeParse(await readJson(res));
  if (!parsed.success) throw new GoogleApiError('resposta de token fora do formato');
  return parsed.data.access_token;
}

/** Le a identidade (sub, e-mail verificado, nome) com o access token. */
export async function fetchGoogleIdentity(accessToken: string): Promise<GoogleIdentity> {
  const res = await googleFetch(GOOGLE_USERINFO_URL, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new GoogleApiError(`Google respondeu ${res.status} no userinfo`);
  const info = userinfoSchema.safeParse(await readJson(res));
  if (!info.success) throw new GoogleApiError('perfil do Google fora do formato');
  const { sub, email, email_verified: verified, name } = info.data;
  return {
    googleId: sub,
    name: name?.trim() || null,
    email: email && verified === true ? email : null,
  };
}
