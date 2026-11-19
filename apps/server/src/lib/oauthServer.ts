import crypto from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MCP_SCOPES, type McpScope, type OAuthAuthorizeError, type OAuthAuthorizeParams } from '@scale/shared';
import { prisma } from './prisma.js';

/**
 * Servidor de autorizacao OAuth 2.1 do MCP (apps conectados).
 *
 * - Cliente publico (registro dinamico, RFC 7591), sem segredo: a prova e o
 *   PKCE S256 obrigatorio.
 * - Codigo de autorizacao: so na memoria, uso unico, 10 min (igual ao `state`
 *   do login com GitHub/Google).
 * - Tokens opacos; o banco guarda so o SHA-256. Acesso 1 h; renovacao 30 dias,
 *   rotativa (usar o token de renovacao apaga o antigo).
 * - Desconectar o app (apaga o OAuthGrant) derruba todos os tokens (cascade).
 */

export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
const MAX_CODES = 5000;

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (prefix: string): string => `${prefix}${crypto.randomBytes(32).toString('base64url')}`;

/** Origem publica do Scale: PUBLIC_URL valida ou, sem ela, o host da requisicao. */
export function publicBase(request: FastifyRequest): string {
  const configured = z.string().url().safeParse((process.env.PUBLIC_URL ?? '').trim());
  if (configured.success) return configured.data.replace(/\/+$/, '');
  return `${request.protocol}://${request.host}`;
}

/* ─── Escopos ─────────────────────────────────────────────────────────── */

export function parseScopes(raw: string | undefined | null): McpScope[] | null {
  if (!raw || !raw.trim()) return [...MCP_SCOPES];
  const parts = raw.trim().split(/\s+/);
  const known = new Set<string>(MCP_SCOPES);
  if (parts.some((p) => !known.has(p))) return null;
  return MCP_SCOPES.filter((s) => parts.includes(s));
}

export const scopesOf = (raw: string): McpScope[] => parseScopes(raw) ?? [];

/* ─── Clientes ────────────────────────────────────────────────────────── */

/**
 * URL de retorno aceita: https, ou http SO em loopback (clientes locais como o
 * Claude Code abrem uma porta no proprio computador). Sem fragmento.
 */
export function isAllowedRedirectUri(value: string): boolean {
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  return false;
}

export async function registerClient(name: string, redirectUris: string[]): Promise<{ id: string; name: string; redirectUris: string[]; createdAt: Date }> {
  const id = `scl_app_${crypto.randomBytes(16).toString('base64url')}`;
  const row = await prisma.oAuthClient.create({ data: { id, name, redirectUris: JSON.stringify(redirectUris) } });
  return { id: row.id, name: row.name, redirectUris, createdAt: row.createdAt };
}

function redirectUrisOf(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch { return []; }
}

/**
 * Confere cliente, URL de retorno (comparacao exata com a registrada; em
 * loopback a porta pode variar, RFC 8252 7.3) e escopos.
 */
export async function validateAuthorizeRequest(params: OAuthAuthorizeParams): Promise<
  { ok: true; client: { id: string; name: string }; scopes: McpScope[]; redirectUri: string } | { ok: false; error: OAuthAuthorizeError }
> {
  const client = await prisma.oAuthClient.findUnique({ where: { id: params.client_id } });
  if (!client) return { ok: false, error: 'unknown_client' };
  if (!isAllowedRedirectUri(params.redirect_uri) || !redirectUrisOf(client.redirectUris).some((r) => sameRedirect(r, params.redirect_uri))) {
    return { ok: false, error: 'invalid_redirect' };
  }
  const scopes = parseScopes(params.scope);
  if (!scopes || scopes.length === 0) return { ok: false, error: 'invalid_scope' };
  return { ok: true, client: { id: client.id, name: client.name }, scopes, redirectUri: params.redirect_uri };
}

function sameRedirect(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  try {
    const a = new URL(registered); const b = new URL(requested);
    const loopback = (u: URL) => u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]');
    return loopback(a) && loopback(b) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch { return false; }
}

/* ─── Codigo de autorizacao (memoria, uso unico) ──────────────────────── */

interface PendingCode {
  grantId: string; clientId: string; redirectUri: string; codeChallenge: string; scopes: McpScope[]; expiresAt: number;
}
const codes = new Map<string, PendingCode>();

function sweepCodes(now = Date.now()): void {
  for (const [key, value] of codes) if (value.expiresAt <= now) codes.delete(key);
}

export function issueCode(input: Omit<PendingCode, 'expiresAt'>): string {
  sweepCodes();
  if (codes.size >= MAX_CODES) {
    const oldest = codes.keys().next().value;
    if (oldest !== undefined) codes.delete(oldest);
  }
  const code = crypto.randomBytes(32).toString('base64url');
  codes.set(sha256(code), { ...input, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

/** Concede (ou amplia) a autorizacao do usuario ao app. */
export async function upsertGrant(userId: string, clientId: string, scopes: McpScope[]): Promise<{ id: string; scopes: McpScope[] }> {
  const existing = await prisma.oAuthGrant.findUnique({ where: { userId_clientId: { userId, clientId } } });
  const merged = MCP_SCOPES.filter((s) => scopes.includes(s) || (existing ? scopesOf(existing.scopes).includes(s) : false));
  const row = existing
    ? await prisma.oAuthGrant.update({ where: { id: existing.id }, data: { scopes: merged.join(' ') } })
    : await prisma.oAuthGrant.create({ data: { userId, clientId, scopes: merged.join(' ') } });
  return { id: row.id, scopes: merged };
}

/* ─── Tokens ──────────────────────────────────────────────────────────── */

export interface TokenResponse {
  access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string;
}

async function issueTokens(grantId: string, scopes: McpScope[]): Promise<TokenResponse> {
  const access = randomToken('scl_at_');
  const refresh = randomToken('scl_rt_');
  const now = Date.now();
  await prisma.oAuthToken.createMany({
    data: [
      { tokenHash: sha256(access), grantId, kind: 'access', expiresAt: new Date(now + ACCESS_TOKEN_TTL_MS) },
      { tokenHash: sha256(refresh), grantId, kind: 'refresh', expiresAt: new Date(now + REFRESH_TOKEN_TTL_MS) },
    ],
  });
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_MS / 1000, refresh_token: refresh, scope: scopes.join(' ') };
}

export type TokenError = 'invalid_grant' | 'invalid_client' | 'invalid_scope';

function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed); const b = Buffer.from(challenge);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string }): Promise<TokenResponse | { error: TokenError }> {
  const key = sha256(input.code);
  const pending = codes.get(key);
  codes.delete(key); // uso unico, mesmo se a troca falhar
  if (!pending || pending.expiresAt <= Date.now()) return { error: 'invalid_grant' };
  if (pending.clientId !== input.clientId) return { error: 'invalid_client' };
  if (pending.redirectUri !== input.redirectUri || !verifyPkce(input.codeVerifier, pending.codeChallenge)) return { error: 'invalid_grant' };
  const grant = await prisma.oAuthGrant.findUnique({ where: { id: pending.grantId } });
  if (!grant) return { error: 'invalid_grant' };
  return issueTokens(grant.id, pending.scopes.filter((s) => scopesOf(grant.scopes).includes(s)));
}

export async function refreshTokens(input: { refreshToken: string; clientId: string; scope?: string }): Promise<TokenResponse | { error: TokenError }> {
  const row = await prisma.oAuthToken.findUnique({ where: { tokenHash: sha256(input.refreshToken) }, include: { grant: true } });
  if (!row || row.kind !== 'refresh') return { error: 'invalid_grant' };
  // Rotacao: o token usado morre agora, valido ou nao.
  await prisma.oAuthToken.delete({ where: { tokenHash: row.tokenHash } }).catch(() => undefined);
  if (row.expiresAt.getTime() <= Date.now()) return { error: 'invalid_grant' };
  if (row.grant.clientId !== input.clientId) return { error: 'invalid_client' };
  const granted = scopesOf(row.grant.scopes);
  const asked = input.scope ? parseScopes(input.scope) : granted;
  if (!asked || asked.some((s) => !granted.includes(s))) return { error: 'invalid_scope' };
  return issueTokens(row.grantId, asked);
}

export async function revokeToken(token: string): Promise<void> {
  await prisma.oAuthToken.deleteMany({ where: { tokenHash: sha256(token) } });
}

export interface McpPrincipal {
  grantId: string; userId: string; userName: string; clientId: string; appName: string; scopes: McpScope[];
}

/** Token de acesso valido -> quem e o usuario, qual app e o que pode. */
export async function verifyAccessToken(token: string): Promise<McpPrincipal | null> {
  if (!token.startsWith('scl_at_')) return null;
  const row = await prisma.oAuthToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { grant: { include: { client: true, user: { select: { id: true, name: true } } } } },
  });
  if (!row || row.kind !== 'access' || row.expiresAt.getTime() <= Date.now()) return null;
  const { grant } = row;
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    void prisma.oAuthGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return {
    grantId: grant.id, userId: grant.user.id, userName: grant.user.name,
    clientId: grant.clientId, appName: grant.client.name, scopes: scopesOf(grant.scopes),
  };
}

/** Expurgo de tokens vencidos (a varredura roda pelo server.ts). */
export async function sweepExpiredOAuthTokens(): Promise<number> {
  sweepCodes();
  const { count } = await prisma.oAuthToken.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}

/** So para testes. */
export function _resetOAuthCodes(): void {
  codes.clear();
}
