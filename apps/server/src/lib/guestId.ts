import { createHmac, randomUUID } from 'node:crypto';
import fastifyCookie from '@fastify/cookie';
import { z } from 'zod';
import { getEnv } from './env.js';

/**
 * Identidade de CONVIDADO emitida pelo servidor.
 *
 * O `guestName` e so nome de exibicao (forjavel: dois convidados podem ter o
 * mesmo nome). A autoria de mensagem/arquivo de convidado e o `guestId`: UUID v4
 * gerado AQUI, guardado num cookie HttpOnly + SameSite=Strict (+ Secure em
 * producao), assinado com HMAC (GUEST_COOKIE_SECRET). Cookie sem assinatura
 * valida e ignorado (vira um convidado novo, sem autoria sobre nada antigo).
 *
 * Emissao: SO no handshake do Socket.io (`initial_headers` do engine, ver
 * socket/handler.ts) — o socket nasce com o guestId e o Set-Cookie vai na mesma
 * resposta, sem o cliente chamar nada. Emissor unico de proposito: emitir
 * tambem no REST faria requests simultaneos do primeiro acesso gerarem
 * guestIds diferentes. O REST usa o guestId do room ticket (lib/roomTicket.ts).
 */
export const GUEST_COOKIE_NAME = 'scale_guest';
/** 180 dias. */
export const GUEST_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export const GUEST_COOKIE_SECRET_MIN_LENGTH = 32;

const guestIdSchema = z.string().uuid();

/**
 * Segredo do cookie. Em producao GUEST_COOKIE_SECRET e obrigatorio (>= 32
 * caracteres) e a ausencia derruba o start (server.ts chama isto no boot). Fora
 * de producao, sem a env, deriva um segredo do JWT_SECRET (dev/teste).
 */
export function getGuestCookieSecret(): string {
  const env = getEnv();
  const raw = (process.env.GUEST_COOKIE_SECRET ?? '').trim();
  if (raw.length >= GUEST_COOKIE_SECRET_MIN_LENGTH) return raw;
  if (env.NODE_ENV === 'production') {
    throw new Error(
      `GUEST_COOKIE_SECRET ausente ou curto (minimo ${GUEST_COOKIE_SECRET_MIN_LENGTH} caracteres) — obrigatorio em producao`,
    );
  }
  return createHmac('sha256', env.JWT_SECRET).update('scale:guest-cookie:dev').digest('hex');
}

export function newGuestId(): string {
  return randomUUID();
}

export function signGuestId(guestId: string): string {
  return fastifyCookie.sign(guestId, getGuestCookieSecret());
}

/** Valor assinado do cookie -> guestId, ou null (ausente/adulterado/invalido). */
export function verifyGuestCookie(value: string | undefined): string | null {
  if (!value) return null;
  const result = fastifyCookie.unsign(value, getGuestCookieSecret());
  if (!result.valid || result.value === null) return null;
  const parsed = guestIdSchema.safeParse(result.value);
  return parsed.success ? parsed.data : null;
}

/** Header Set-Cookie completo do guestId (usado pelo handshake do socket). */
export function serializeGuestCookie(guestId: string): string {
  const parts = [
    `${GUEST_COOKIE_NAME}=${encodeURIComponent(signGuestId(guestId))}`,
    'Path=/',
    `Max-Age=${GUEST_COOKIE_MAX_AGE_SECONDS}`,
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (getEnv().NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}
