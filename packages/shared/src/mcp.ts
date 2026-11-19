import { z } from 'zod';

/* ─── Servidor MCP: apps conectados por OAuth 2.1 (PKCE) ─────────────── */

/**
 * Escopos do servidor MCP. O app nunca tem mais poder que o usuario: cada
 * escopo so libera ferramentas, e a ferramenta passa pelas mesmas regras da
 * rota de sempre (permissoes de canal, cargo, castigo, modo lento).
 */
export const MCP_SCOPES = ['channels', 'community.manage', 'room.chat'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];
export const mcpScopeSchema = z.enum(MCP_SCOPES);

/** Texto da tela de consentimento e de "Apps conectados". */
export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
  channels: 'Ler e enviar mensagens nos canais de texto das suas comunidades',
  'community.manage': 'Configurar comunidades onde você tem permissão (canais, categorias, cargos, boas-vindas)',
  'room.chat': 'Ler e enviar no chat das salas de voz em que você está',
};

/** Nome do app: declarado pelo proprio cliente no registro, nunca verificado. */
export const OAUTH_CLIENT_NAME_MAX = 60;

/** Parametros do pedido de autorizacao (query de /oauth/authorize). */
export const oauthAuthorizeParamsSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1).max(100),
  redirect_uri: z.string().min(1).max(2000),
  code_challenge: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  code_challenge_method: z.literal('S256'),
  state: z.string().max(1000).optional(),
  scope: z.string().max(500).optional(),
  resource: z.string().max(2000).optional(),
});
export type OAuthAuthorizeParams = z.infer<typeof oauthAuthorizeParamsSchema>;

export const oauthDecisionSchema = oauthAuthorizeParamsSchema.extend({ approve: z.boolean() });

/** Erros do pedido mostrados na tela (sem botao Autorizar). */
export type OAuthAuthorizeError = 'invalid_request' | 'unknown_client' | 'invalid_redirect' | 'invalid_scope';

/** GET /api/oauth/authorize/info */
export interface OAuthAuthorizeInfo {
  client: { name: string; redirectHost: string };
  scopes: McpScope[];
  /** Escopos ainda nao concedidos (app ja autorizado pedindo mais). */
  newScopes: McpScope[];
  alreadyConnected: boolean;
  user: { name: string; email: string };
}

/** GET /api/me/apps */
export interface ConnectedApp {
  id: string;
  name: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
}
