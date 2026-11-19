import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { getAllowedOrigins } from '../lib/env.js';
import { isMcpCallRateLimited } from '../lib/rateLimit.js';
import { publicBase, verifyAccessToken, type McpPrincipal } from '../lib/oauthServer.js';
import { callTool, listTools } from '../lib/mcpTools.js';

/**
 * Servidor MCP (transporte Streamable HTTP, sem estado): POST /mcp recebe uma
 * mensagem JSON-RPC e responde JSON. Sem sessao nem stream do servidor (GET e
 * DELETE = 405, permitido pela especificacao). Autenticacao: token de acesso
 * OAuth no header Authorization; sem ele, 401 com o endereco dos metadados.
 */

export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;
const SERVER_VERSION = '1.0.0';

const INSTRUCTIONS = [
  'Scale e um app de salas de voz, comunidades e chat. Voce age COMO o usuario que conectou este app:',
  'tudo que enviar aparece com o nome dele e o selo "via <nome do app>".',
  'Comece por list_communities e get_community para descobrir ids. Confirme com o usuario antes de',
  'apagar canais, categorias ou cargos. Chat de sala de voz so funciona enquanto o usuario estiver na sala.',
].join(' ');

const rpcSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.union([z.string(), z.number()]).nullable().optional(),
  method: z.string().min(1).max(100),
  params: z.record(z.unknown()).optional(),
});

type RpcId = string | number | null;
const rpcResult = (id: RpcId, result: unknown) => ({ jsonrpc: '2.0' as const, id, result });
const rpcError = (id: RpcId, code: number, message: string) => ({ jsonrpc: '2.0' as const, id, error: { code, message } });

function unauthorized(request: FastifyRequest, reply: FastifyReply, error?: 'invalid_token') {
  const meta = `${publicBase(request)}/.well-known/oauth-protected-resource`;
  const header = error
    ? `Bearer error="${error}", error_description="Token ausente, expirado ou revogado", resource_metadata="${meta}"`
    : `Bearer resource_metadata="${meta}"`;
  return reply.code(401).header('WWW-Authenticate', header).send({ error: error ?? 'unauthorized' });
}

/** Protecao contra DNS rebinding: Origin, quando vem, tem de ser do proprio Scale. */
function originAllowed(request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  return origin === publicBase(request) || getAllowedOrigins().includes(origin);
}

export async function mcpRoutes(app: FastifyInstance): Promise<void> {
  app.get('/mcp', async (_request, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'method_not_allowed' }));
  app.delete('/mcp', async (_request, reply) => reply.code(405).header('Allow', 'POST').send({ error: 'method_not_allowed' }));

  app.post('/mcp', async (request, reply) => {
    if (!originAllowed(request)) return reply.code(403).send({ error: 'forbidden_origin' });
    const authz = request.headers.authorization;
    if (!authz?.startsWith('Bearer ')) return unauthorized(request, reply);
    const principal = await verifyAccessToken(authz.slice(7).trim());
    if (!principal) return unauthorized(request, reply, 'invalid_token');

    if (Array.isArray(request.body)) return reply.code(400).send(rpcError(null, -32600, 'Lotes JSON-RPC nao sao suportados'));
    const msg = rpcSchema.safeParse(request.body);
    if (!msg.success) return reply.code(400).send(rpcError(null, -32600, 'Mensagem JSON-RPC invalida'));
    const { id, method, params } = msg.data;

    // Notificacao (sem id) e resposta do cliente: so confirmamos.
    if (id === undefined) return reply.code(202).send();

    const limit = isMcpCallRateLimited(principal.grantId);
    if (limit.limited) {
      void reply.header('Retry-After', String(limit.retryAfterSeconds));
      return reply.code(429).send(rpcError(id, -32000, `Limite de uso do app atingido; tente em ${limit.retryAfterSeconds} s`));
    }

    return reply.send(await handle(app, principal, id, method, params ?? {}));
  });
}

async function handle(app: FastifyInstance, principal: McpPrincipal, id: RpcId, method: string, params: Record<string, unknown>) {
  switch (method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'scale', title: 'Scale', version: SERVER_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: listTools(principal.scopes) });
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const args = params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments)
        ? params.arguments as Record<string, unknown> : {};
      const result = await callTool(name, args, { app, principal });
      if (!result) return rpcError(id, -32602, `Ferramenta desconhecida: ${name}`);
      return rpcResult(id, result);
    }
    default:
      return rpcError(id, -32601, `Metodo nao suportado: ${method}`);
  }
}
