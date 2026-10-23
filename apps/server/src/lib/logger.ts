import type { FastifyServerOptions } from 'fastify';

/** Parametros de query que nunca podem aparecer em log. */
const SENSITIVE_QUERY_KEYS = new Set(['password', 'invitetoken', 'token']);

/**
 * Remove da URL os parametros sensiveis (password, inviteToken, token) antes de
 * ela entrar no log. A rota continua recebendo a URL original.
 */
export function redactUrl(url: string): string {
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return url;
  const path = url.slice(0, qIndex);
  const query = url.slice(qIndex + 1);
  const parts = query.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    let key = rawKey;
    try {
      key = decodeURIComponent(rawKey);
    } catch {
      // chave mal-codificada: compara a forma crua
    }
    return SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? `${rawKey}=[REDACTED]` : pair;
  });
  return `${path}?${parts.join('&')}`;
}

interface SerializableRequest {
  method: string;
  url: string;
  host?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

/**
 * Opcoes do logger do Fastify: o serializer de `req` troca a URL pela versao
 * redigida e headers com credencial sao censurados caso algum log os inclua.
 */
export function buildLoggerOptions(level: string): FastifyServerOptions['logger'] {
  return {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-room-password"]',
        'req.headers["x-room-invite"]',
        'res.headers["set-cookie"]',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req(request: SerializableRequest) {
        return {
          method: request.method,
          url: redactUrl(request.url),
          host: request.host ?? request.hostname,
          remoteAddress: request.ip,
          remotePort: request.socket?.remotePort,
        };
      },
    },
  };
}
