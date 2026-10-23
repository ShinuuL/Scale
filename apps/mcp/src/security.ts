import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Tamanho minimo do MCP_TOKEN (o start aborta abaixo disso). */
export const MCP_TOKEN_MIN_LENGTH = 32;

/**
 * Valida o MCP_TOKEN no start: ausente ou curto aborta o processo (fail-closed).
 * Devolve o token aparado. A mensagem nunca inclui o valor recebido.
 */
export function requireMcpToken(raw: string | undefined): string {
  const token = (raw ?? '').trim();
  if (token.length < MCP_TOKEN_MIN_LENGTH) {
    throw new Error(
      `MCP_TOKEN ausente ou curto (minimo ${MCP_TOKEN_MIN_LENGTH} caracteres). ` +
        'Gere um com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  return token;
}

/** Comparacao em tempo constante (SHA-256 iguala os tamanhos). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** `Authorization: Bearer <token>` confere com o MCP_TOKEN? */
export function isAuthorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  return safeEqual(header.slice(7).trim(), token);
}

/** Parametro :id das rotas de sala: sempre UUID. */
export const roomIdParamsSchema = z.object({ id: z.string().uuid() });

/** Corpo do kick: socketId do Socket.io (base64url curto). */
export const kickBodySchema = z.object({
  socketId: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
});

/** Identificador nao reversivel para log (nunca logar o socketId cru). */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
