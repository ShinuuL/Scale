import { createHmac } from 'node:crypto';
import { getEnv } from './env.js';

/**
 * Servidores ICE (STUN + TURN) entregues ao navegador.
 *
 * TURN com credencial TEMPORARIA (REST API do coturn, `use-auth-secret`):
 *   username   = "<expira-em-unix>:<rotulo>"
 *   credential = base64(HMAC-SHA1(TURN_SECRET, username))
 * O coturn recalcula o HMAC com o mesmo segredo e recusa o username depois da
 * expiracao — nada de senha fixa vazando para todo mundo, e nao existe tabela
 * de usuarios no coturn. Quem recebe: todo participante que ENTROU numa sala
 * (logado ou convidado), via `room:ice-servers` no join-room. Convidado sem
 * TURN = chamada que nao conecta atras de CGNAT/4G/rede de empresa.
 *
 * Fallback legado: sem TURN_SECRET, usa TURN_USERNAME/TURN_CREDENTIAL fixos
 * (provedor externo que entrega credencial estatica).
 */

export const STUN_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

/** Validade padrao da credencial: 24 h (cobre uma chamada longa sem renovar). */
export const DEFAULT_TURN_TTL_SECONDS = 24 * 60 * 60;

export interface IceServersResponse {
  iceServers: RTCIceServer[];
  turnEnabled: boolean;
  /** Quando a credencial TURN expira (unix, segundos). Ausente sem TURN. */
  expiresAt?: number;
}

function parseUrls(csv: string | undefined): string[] {
  return (csv ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

function ttlSeconds(): number {
  const raw = Number(process.env.TURN_TTL_SECONDS);
  // Entre 5 min e 7 dias; fora disso (ou vazio) usa o padrao.
  return Number.isFinite(raw) && raw >= 300 && raw <= 7 * 24 * 60 * 60
    ? Math.floor(raw)
    : DEFAULT_TURN_TTL_SECONDS;
}

/** Credencial no formato da REST API do coturn (exportada para teste). */
export function signTurnCredential(
  secret: string,
  label: string,
  expiresAt: number,
): { username: string; credential: string } {
  // ':' e o separador do coturn: o rotulo nao pode conte-lo.
  const safeLabel = label.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || 'scale';
  const username = `${expiresAt}:${safeLabel}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

/**
 * Monta a resposta de ICE servers. `label` identifica a sessao nos logs do
 * coturn (use um id opaco — ex.: socket.id —, nunca email/nome).
 */
export function buildIceServers(label: string, now: number = Date.now()): IceServersResponse {
  const env = getEnv();
  if (!env.ENABLE_TURN) {
    return { iceServers: STUN_SERVERS, turnEnabled: false };
  }

  const urls = parseUrls(process.env.TURN_URL);
  if (urls.length === 0) {
    return { iceServers: STUN_SERVERS, turnEnabled: false };
  }

  const secret = process.env.TURN_SECRET?.trim();
  if (secret) {
    const expiresAt = Math.floor(now / 1000) + ttlSeconds();
    const { username, credential } = signTurnCredential(secret, label, expiresAt);
    return {
      iceServers: [...STUN_SERVERS, { urls, username, credential }],
      turnEnabled: true,
      expiresAt,
    };
  }

  const username = process.env.TURN_USERNAME?.trim();
  const credential = process.env.TURN_CREDENTIAL?.trim();
  if (username && credential) {
    return {
      iceServers: [...STUN_SERVERS, { urls, username, credential }],
      turnEnabled: true,
    };
  }

  return { iceServers: STUN_SERVERS, turnEnabled: false };
}

/** true quando ENABLE_TURN=true mas falta URL ou credencial (para log de aviso). */
export function isTurnMisconfigured(): boolean {
  if (!getEnv().ENABLE_TURN) return false;
  const hasUrl = parseUrls(process.env.TURN_URL).length > 0;
  const hasSecret = Boolean(process.env.TURN_SECRET?.trim());
  const hasStatic = Boolean(process.env.TURN_USERNAME?.trim() && process.env.TURN_CREDENTIAL?.trim());
  return !hasUrl || (!hasSecret && !hasStatic);
}
