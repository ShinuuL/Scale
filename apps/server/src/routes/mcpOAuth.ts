import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  MCP_SCOPES, OAUTH_CLIENT_NAME_MAX, oauthAuthorizeParamsSchema, oauthDecisionSchema,
  type ConnectedApp, type OAuthAuthorizeInfo,
} from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import { getClientIp } from '../lib/clientIp.js';
import { isOAuthRegisterRateLimited, isOAuthTokenRateLimited, isProfileUpdateRateLimited } from '../lib/rateLimit.js';
import {
  exchangeCode, isAllowedRedirectUri, issueCode, publicBase, refreshTokens, registerClient,
  revokeToken, scopesOf, upsertGrant, validateAuthorizeRequest,
} from '../lib/oauthServer.js';

/**
 * Servidor de autorizacao do MCP (apps conectados).
 *
 * Descoberta (RFC 9728 + RFC 8414) em /.well-known, registro dinamico,
 * consentimento em duas rotas usadas pela pagina estatica /oauth/authorize
 * (o cookie de sessao e SameSite=Strict: a navegacao vinda do app nao o traz,
 * mas o fetch da propria pagina traz), token e revogacao.
 */

const registerSchema = z.object({
  client_name: z.string().trim().min(1).max(200).optional(),
  redirect_uris: z.array(z.string().max(2000)).min(1).max(10),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
}).passthrough();

const tokenSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('authorization_code'), code: z.string().min(1).max(200), redirect_uri: z.string().max(2000),
    client_id: z.string().min(1).max(100), code_verifier: z.string().min(1).max(200), resource: z.string().optional(),
  }),
  z.object({
    grant_type: z.literal('refresh_token'), refresh_token: z.string().min(1).max(200),
    client_id: z.string().min(1).max(100), scope: z.string().max(500).optional(), resource: z.string().optional(),
  }),
]);

const grantParams = z.object({ id: z.string().uuid() });

const oauthError = (reply: FastifyReply, status: number, error: string, description?: string) =>
  reply.code(status).send(description ? { error, error_description: description } : { error });

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local.slice(0, 2)}***@${domain}`;
}

export async function mcpOAuthRoutes(app: FastifyInstance): Promise<void> {
  const auth = { preHandler: [app.authenticate as never] };

  // O endpoint de token recebe application/x-www-form-urlencoded (RFC 6749).
  // Parser so neste contexto (plugin encapsulado), sem dependencia nova.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 16 * 1024 }, (_req, body, done) => {
    try { done(null, Object.fromEntries(new URLSearchParams(String(body)))); } catch (err) { done(err as Error, undefined); }
  });

  /* ─── Descoberta ─────────────────────────────────────────────────── */

  const protectedResource = (request: FastifyRequest) => {
    const base = publicBase(request);
    return {
      resource: `${base}/mcp`,
      authorization_servers: [base],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'Scale',
    };
  };
  app.get('/.well-known/oauth-protected-resource', async (request) => protectedResource(request));
  app.get('/.well-known/oauth-protected-resource/mcp', async (request) => protectedResource(request));

  app.get('/.well-known/oauth-authorization-server', async (request) => {
    const base = publicBase(request);
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [...MCP_SCOPES],
    };
  });

  /* ─── Registro dinamico (RFC 7591) ───────────────────────────────── */

  app.post('/api/oauth/register', async (request, reply) => {
    const limit = isOAuthRegisterRateLimited(getClientIp(request));
    if (limit.limited) return reply.code(429).header('Retry-After', String(limit.retryAfterSeconds)).send({ error: 'slow_down' });
    const body = registerSchema.safeParse(request.body);
    if (!body.success) return oauthError(reply, 400, 'invalid_client_metadata');
    if (!body.data.redirect_uris.every(isAllowedRedirectUri)) {
      return oauthError(reply, 400, 'invalid_redirect_uri', 'Use https, ou http apenas em localhost/127.0.0.1.');
    }
    if (body.data.token_endpoint_auth_method && body.data.token_endpoint_auth_method !== 'none') {
      return oauthError(reply, 400, 'invalid_client_metadata', 'Somente clientes publicos (token_endpoint_auth_method none).');
    }
    const name = (body.data.client_name ?? 'App sem nome').slice(0, OAUTH_CLIENT_NAME_MAX);
    const client = await registerClient(name, [...new Set(body.data.redirect_uris)]);
    request.log.info({ clientId: client.id }, 'oauth client registered');
    return reply.code(201).send({
      client_id: client.id,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.name,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  /* ─── Consentimento (pagina /oauth/authorize) ────────────────────── */

  app.get('/api/oauth/authorize/info', auth, async (request, reply) => {
    const params = oauthAuthorizeParamsSchema.safeParse(request.query);
    if (!params.success) return reply.code(400).send({ error: 'invalid_request' });
    const checked = await validateAuthorizeRequest(params.data);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    const userId = request.userId!;
    const [user, grant] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
      prisma.oAuthGrant.findUnique({ where: { userId_clientId: { userId, clientId: checked.client.id } } }),
    ]);
    if (!user) return reply.code(401).send({ error: 'Authentication required' });
    const granted = grant ? scopesOf(grant.scopes) : [];
    const info: OAuthAuthorizeInfo = {
      client: { name: checked.client.name, redirectHost: new URL(checked.redirectUri).host },
      scopes: checked.scopes,
      newScopes: checked.scopes.filter((s) => !granted.includes(s)),
      alreadyConnected: grant != null,
      user: { name: user.name, email: maskEmail(user.email) },
    };
    return reply.send(info);
  });

  app.post('/api/oauth/authorize/decision', auth, async (request, reply) => {
    const body = oauthDecisionSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const checked = await validateAuthorizeRequest(body.data);
    if (!checked.ok) return reply.code(400).send({ error: checked.error });
    const target = new URL(checked.redirectUri);
    if (body.data.state !== undefined) target.searchParams.set('state', body.data.state);
    target.searchParams.set('iss', publicBase(request));
    if (!body.data.approve) {
      target.searchParams.set('error', 'access_denied');
      return reply.send({ redirectTo: target.toString() });
    }
    const userId = request.userId!;
    const grant = await upsertGrant(userId, checked.client.id, checked.scopes);
    const code = issueCode({
      grantId: grant.id, clientId: checked.client.id, redirectUri: checked.redirectUri,
      codeChallenge: body.data.code_challenge, scopes: checked.scopes,
    });
    target.searchParams.set('code', code);
    request.log.info({ clientId: checked.client.id, grantId: grant.id }, 'oauth app authorized');
    return reply.send({ redirectTo: target.toString() });
  });

  /* ─── Token e revogacao ──────────────────────────────────────────── */

  app.post('/api/oauth/token', async (request, reply) => {
    void reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache');
    const limit = isOAuthTokenRateLimited(getClientIp(request));
    if (limit.limited) return reply.code(429).header('Retry-After', String(limit.retryAfterSeconds)).send({ error: 'slow_down' });
    const body = tokenSchema.safeParse(request.body);
    if (!body.success) return oauthError(reply, 400, 'invalid_request');
    const result = body.data.grant_type === 'authorization_code'
      ? await exchangeCode({ code: body.data.code, clientId: body.data.client_id, redirectUri: body.data.redirect_uri, codeVerifier: body.data.code_verifier })
      : await refreshTokens({ refreshToken: body.data.refresh_token, clientId: body.data.client_id, scope: body.data.scope });
    if ('error' in result) return oauthError(reply, result.error === 'invalid_client' ? 401 : 400, result.error);
    return reply.send(result);
  });

  app.post('/api/oauth/revoke', async (request, reply) => {
    const body = z.object({ token: z.string().min(1).max(200) }).passthrough().safeParse(request.body);
    // RFC 7009: token desconhecido tambem responde 200.
    if (body.success) await revokeToken(body.data.token);
    return reply.code(200).send({});
  });

  /* ─── Apps conectados (Configuracoes) ────────────────────────────── */

  app.get('/api/me/apps', auth, async (request) => {
    const rows = await prisma.oAuthGrant.findMany({
      where: { userId: request.userId! }, include: { client: { select: { name: true } } }, orderBy: { createdAt: 'desc' },
    });
    const apps: ConnectedApp[] = rows.map((r) => ({
      id: r.id, name: r.client.name, scopes: scopesOf(r.scopes),
      createdAt: r.createdAt.toISOString(), lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    }));
    return { apps };
  });

  app.delete('/api/me/apps/:id', auth, async (request, reply) => {
    const p = grantParams.safeParse(request.params);
    if (!p.success) return reply.code(400).send({ error: 'Invalid request' });
    const userId = request.userId!;
    const limit = isProfileUpdateRateLimited(userId);
    if (limit.limited) return reply.code(429).header('Retry-After', String(limit.retryAfterSeconds)).send({ error: 'Too many requests' });
    const { count } = await prisma.oAuthGrant.deleteMany({ where: { id: p.data.id, userId } });
    if (!count) return reply.code(404).send({ error: 'Not found' });
    request.log.info({ grantId: p.data.id }, 'oauth app disconnected');
    return reply.code(204).send();
  });
}
