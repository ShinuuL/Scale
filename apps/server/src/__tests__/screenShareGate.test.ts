/**
 * Gate de partilha de tela (logica pura): convidado, idade, consentimento
 * (versao atual) e liberado. birthDate nunca aparece no DTO.
 */
import { describe, it, expect } from 'vitest';
import { SCREEN_SHARE_CONSENT_VERSION } from '@scale/shared';
import { ageInYears, computeScreenShareGate } from '../lib/screenShareGate.js';

const NOW = new Date('2026-11-11T12:00:00Z');
const opts = { minAge: 18, now: NOW };
const adult = new Date('2000-05-01T00:00:00Z');
const minor = new Date('2010-05-01T00:00:00Z');

describe('computeScreenShareGate', () => {
  it('convidado (null) nunca compartilha', () => {
    expect(computeScreenShareGate(null, opts)).toEqual({
      ageVerified: false, isAdult: false, consentVersion: null, allowed: false, reason: 'guest',
    });
  });

  it('sem idade -> reason age', () => {
    const gate = computeScreenShareGate(
      { birthDate: null, ageVerifiedAt: null, screenShareConsentAt: NOW, screenShareConsentVersion: SCREEN_SHARE_CONSENT_VERSION },
      opts,
    );
    expect(gate).toMatchObject({ ageVerified: false, isAdult: false, allowed: false, reason: 'age' });
  });

  it('menor de idade -> isAdult false, reason age', () => {
    const gate = computeScreenShareGate(
      { birthDate: minor, ageVerifiedAt: NOW, screenShareConsentAt: null, screenShareConsentVersion: null },
      opts,
    );
    expect(gate).toMatchObject({ ageVerified: true, isAdult: false, allowed: false, reason: 'age' });
    expect(gate).not.toHaveProperty('birthDate');
  });

  it('adulto sem termo ou com versao antiga -> reason consent', () => {
    expect(
      computeScreenShareGate({ birthDate: adult, ageVerifiedAt: NOW, screenShareConsentAt: null, screenShareConsentVersion: null }, opts),
    ).toMatchObject({ isAdult: true, consentVersion: null, allowed: false, reason: 'consent' });
    expect(
      computeScreenShareGate({ birthDate: adult, ageVerifiedAt: NOW, screenShareConsentAt: NOW, screenShareConsentVersion: '2020-01' }, opts),
    ).toMatchObject({ isAdult: true, consentVersion: '2020-01', allowed: false, reason: 'consent' });
  });

  it('adulto com termo atual -> liberado', () => {
    expect(
      computeScreenShareGate(
        { birthDate: adult, ageVerifiedAt: NOW, screenShareConsentAt: NOW, screenShareConsentVersion: SCREEN_SHARE_CONSENT_VERSION },
        opts,
      ),
    ).toEqual({ ageVerified: true, isAdult: true, consentVersion: SCREEN_SHARE_CONSENT_VERSION, allowed: true, reason: 'ok' });
  });

  it('respeita SCREEN_SHARE_MIN_AGE e o aniversario exato', () => {
    const birthday18 = new Date('2008-11-11T00:00:00Z');
    const tomorrow18 = new Date('2008-11-12T00:00:00Z');
    expect(ageInYears(birthday18, NOW)).toBe(18);
    expect(ageInYears(tomorrow18, NOW)).toBe(17);
    const base = { ageVerifiedAt: NOW, screenShareConsentAt: NOW, screenShareConsentVersion: SCREEN_SHARE_CONSENT_VERSION };
    expect(computeScreenShareGate({ ...base, birthDate: birthday18 }, opts).allowed).toBe(true);
    expect(computeScreenShareGate({ ...base, birthDate: tomorrow18 }, opts).allowed).toBe(false);
    expect(computeScreenShareGate({ ...base, birthDate: tomorrow18 }, { minAge: 16, now: NOW }).allowed).toBe(true);
  });
});
