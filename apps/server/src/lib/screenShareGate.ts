import { SCREEN_SHARE_CONSENT_VERSION, type ScreenShareGate } from '@scale/shared';
import { getEnv } from './env.js';

/**
 * Gate de partilha de tela (spec secao 5). Logica PURA: recebe as colunas do
 * usuario e devolve o DTO `screenShare` — sem birthDate (so o booleano).
 *
 * Liberado = logado + idade >= SCREEN_SHARE_MIN_AGE (de birthDate) + termo
 * aceito na versao ATUAL (SCREEN_SHARE_CONSENT_VERSION). Mudar o termo muda a
 * versao e o consentimento antigo deixa de valer.
 */
export interface ScreenShareGateSource {
  birthDate: Date | null;
  ageVerifiedAt: Date | null;
  screenShareConsentAt: Date | null;
  screenShareConsentVersion: string | null;
}

/** Colunas que o gate precisa (para compor `select`s do Prisma). */
export const screenShareGateSelect = {
  birthDate: true,
  ageVerifiedAt: true,
  screenShareConsentAt: true,
  screenShareConsentVersion: true,
} as const;

export const GUEST_SCREEN_SHARE_GATE: ScreenShareGate = {
  ageVerified: false,
  isAdult: false,
  consentVersion: null,
  allowed: false,
  reason: 'guest',
};

/** Idade completa em anos em `now` (UTC, so a data). */
export function ageInYears(birthDate: Date, now: Date = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birthDate.getUTCMonth() ||
    (now.getUTCMonth() === birthDate.getUTCMonth() && now.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function computeScreenShareGate(
  user: ScreenShareGateSource | null | undefined,
  opts: { minAge?: number; now?: Date } = {},
): ScreenShareGate {
  if (!user) return GUEST_SCREEN_SHARE_GATE;
  const minAge = opts.minAge ?? getEnv().SCREEN_SHARE_MIN_AGE;
  const ageVerified = user.birthDate !== null && user.ageVerifiedAt !== null;
  const isAdult = ageVerified && ageInYears(user.birthDate as Date, opts.now) >= minAge;
  const consentVersion =
    user.screenShareConsentAt && user.screenShareConsentVersion ? user.screenShareConsentVersion : null;
  const consentOk = consentVersion === SCREEN_SHARE_CONSENT_VERSION;

  if (!isAdult) return { ageVerified, isAdult, consentVersion, allowed: false, reason: 'age' };
  if (!consentOk) return { ageVerified, isAdult, consentVersion, allowed: false, reason: 'consent' };
  return { ageVerified, isAdult, consentVersion, allowed: true, reason: 'ok' };
}
