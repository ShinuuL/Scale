/**
 * Login com GitHub (OAuth App, fluxo authorization code).
 *
 * Configuracao opcional: sem GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET/PUBLIC_URL o
 * recurso fica desligado (o botao some do frontend e as rotas respondem 404).
 *
 * Escopos: `read:user user:email` — so leitura do perfil e dos e-mails. O
 * access token e usado apenas dentro do callback e descartado (nunca gravado,
 * nunca logado).
 */
import { z } from 'zod';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_SCOPES = 'read:user user:email';
const GITHUB_TIMEOUT_MS = 10_000;

/** Caminho do callback; a URL completa (PUBLIC_URL + isto) e a cadastrada no OAuth App. */
export const GITHUB_CALLBACK_PATH = '/api/auth/github/callback';

const githubEnvSchema = z.object({
  GITHUB_CLIENT_ID: z.string().trim().default(''),
  GITHUB_CLIENT_SECRET: z.string().trim().default(''),
  // Origem publica do app (ex.: https://scale.nexushosts.tech:8443), sem barra
  // final. Monta o redirect_uri, que o GitHub exige identico ao cadastrado.
  PUBLIC_URL: z.string().trim().default(''),
});

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

/**
 * Le a configuracao a cada chamada (barato; os testes trocam o ambiente sem
 * reiniciar). Devolve null quando o recurso esta desligado ou incompleto.
 */
export function getGithubConfig(): GithubConfig | null {
  const env = githubEnvSchema.parse(process.env);
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !env.PUBLIC_URL) return null;
  const base = z.string().url().safeParse(env.PUBLIC_URL);
  if (!base.success) {
    throw new Error(`PUBLIC_URL invalida: "${env.PUBLIC_URL}" (ex.: https://scale.exemplo.com)`);
  }
  return {
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    callbackUrl: `${base.data.replace(/\/+$/, '')}${GITHUB_CALLBACK_PATH}`,
  };
}

export function buildGithubAuthorizeUrl(config: GithubConfig, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.callbackUrl);
  url.searchParams.set('scope', GITHUB_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

/** Erro de comunicacao com o GitHub (rede, status inesperado, resposta fora do schema). */
export class GithubApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GithubApiError';
  }
}

const tokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1), token_type: z.string() }),
  z.object({ error: z.string(), error_description: z.string().optional() }),
]);

const githubUserSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(39),
  name: z.string().nullable().optional(),
});

const githubEmailsSchema = z.array(
  z.object({
    email: z.string().email(),
    primary: z.boolean(),
    verified: z.boolean(),
  }),
);

export interface GithubIdentity {
  githubId: string;
  login: string;
  name: string | null;
  /** E-mail PRIMARIO e VERIFICADO no GitHub; null se nao houver. */
  email: string | null;
}

async function githubFetch(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS) });
  } catch (err) {
    throw new GithubApiError(`falha de rede com o GitHub: ${(err as Error).name}`);
  }
  if (!res.ok) throw new GithubApiError(`GitHub respondeu ${res.status} em ${new URL(url).pathname}`);
  try {
    return await res.json();
  } catch {
    throw new GithubApiError('resposta do GitHub nao e JSON');
  }
}

/** Troca o `code` do callback por um access token. Devolve null se o code for recusado. */
export async function exchangeGithubCode(config: GithubConfig, code: string): Promise<string | null> {
  const body = await githubFetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.callbackUrl,
    }),
  });
  const parsed = tokenResponseSchema.safeParse(body);
  if (!parsed.success) throw new GithubApiError('resposta de token fora do formato');
  return 'access_token' in parsed.data ? parsed.data.access_token : null;
}

/** Le perfil e e-mail primario verificado com o access token. */
export async function fetchGithubIdentity(accessToken: string): Promise<GithubIdentity> {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': 'scale-app',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const [userBody, emailsBody] = await Promise.all([
    githubFetch(`${GITHUB_API_URL}/user`, { headers }),
    githubFetch(`${GITHUB_API_URL}/user/emails`, { headers }),
  ]);
  const user = githubUserSchema.safeParse(userBody);
  const emails = githubEmailsSchema.safeParse(emailsBody);
  if (!user.success || !emails.success) throw new GithubApiError('perfil do GitHub fora do formato');

  const primary = emails.data.find((e) => e.primary && e.verified);
  return {
    githubId: String(user.data.id),
    login: user.data.login,
    name: user.data.name?.trim() || null,
    email: primary ? primary.email : null,
  };
}
