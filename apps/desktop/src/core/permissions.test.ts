import { describe, expect, it } from 'vitest';
import { isPermissionAllowed } from './permissions';

const ORIGIN = 'https://scale.exemplo.com.br';
const PAGE = 'https://scale.exemplo.com.br/room?id=1';

describe('isPermissionAllowed', () => {
  it('permite microfone para a origin configurada', () => {
    expect(
      isPermissionAllowed({ permission: 'media', requestingUrl: PAGE, allowedOrigin: ORIGIN, mediaTypes: ['audio'] }),
    ).toBe(true);
  });

  it('permite captura de tela para a origin configurada', () => {
    expect(isPermissionAllowed({ permission: 'display-capture', requestingUrl: PAGE, allowedOrigin: ORIGIN })).toBe(
      true,
    );
  });

  it('permite escolher a saida de audio so na origin configurada', () => {
    expect(isPermissionAllowed({ permission: 'speaker-selection', requestingUrl: PAGE, allowedOrigin: ORIGIN })).toBe(
      true,
    );
    expect(
      isPermissionAllowed({ permission: 'speaker-selection', requestingUrl: 'https://example.com/', allowedOrigin: ORIGIN }),
    ).toBe(false);
    expect(isPermissionAllowed({ permission: 'speaker-selection', requestingUrl: PAGE, allowedOrigin: null })).toBe(false);
  });

  it('nega camera', () => {
    expect(
      isPermissionAllowed({ permission: 'media', requestingUrl: PAGE, allowedOrigin: ORIGIN, mediaTypes: ['video'] }),
    ).toBe(false);
    expect(
      isPermissionAllowed({
        permission: 'media',
        requestingUrl: PAGE,
        allowedOrigin: ORIGIN,
        mediaTypes: ['audio', 'video'],
      }),
    ).toBe(false);
  });

  it('media sem tipos (getDisplayMedia) segue para o seletor so na origin certa', () => {
    expect(isPermissionAllowed({ permission: 'media', requestingUrl: PAGE, allowedOrigin: ORIGIN, mediaTypes: [] })).toBe(
      true,
    );
    expect(
      isPermissionAllowed({ permission: 'media', requestingUrl: 'https://example.com/', allowedOrigin: ORIGIN, mediaTypes: [] }),
    ).toBe(false);
  });

  it('check handler: tipo unknown nao e liberado', () => {
    expect(
      isPermissionAllowed({ permission: 'media', requestingUrl: PAGE, allowedOrigin: ORIGIN, mediaTypes: ['unknown'] }),
    ).toBe(false);
  });

  it.each(['geolocation', 'notifications', 'clipboard-read', 'midi', 'openExternal', 'fullscreen', 'hid', 'serial'])(
    'nega %s mesmo na origin certa',
    (permission) => {
      expect(isPermissionAllowed({ permission, requestingUrl: PAGE, allowedOrigin: ORIGIN, mediaTypes: ['audio'] })).toBe(
        false,
      );
    },
  );

  it.each([
    'https://example.com/',
    'https://scale.exemplo.com.br.evil.com/',
    'http://scale.exemplo.com.br/',
    'file:///C:/app/setup/index.html',
    '',
  ])('nega origin errada: %s', (requestingUrl) => {
    expect(
      isPermissionAllowed({ permission: 'media', requestingUrl, allowedOrigin: ORIGIN, mediaTypes: ['audio'] }),
    ).toBe(false);
    expect(isPermissionAllowed({ permission: 'display-capture', requestingUrl, allowedOrigin: ORIGIN })).toBe(false);
  });

  it('nega tudo sem servidor configurado', () => {
    expect(
      isPermissionAllowed({ permission: 'media', requestingUrl: PAGE, allowedOrigin: null, mediaTypes: ['audio'] }),
    ).toBe(false);
  });
});
