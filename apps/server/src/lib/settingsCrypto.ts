import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { getEnv } from './env.js';

/**
 * Cifra de segredos guardados no banco (ex.: chave de API da moderacao).
 *
 * AES-256-GCM com chave DERIVADA do JWT_SECRET por HMAC-SHA256 com rotulo
 * proprio ('scale:settings-key:v1') — mesmo padrao do room ticket
 * (lib/roomTicket.ts): a chave de cifra nao e o segredo de sessao e vice-versa.
 * Formato gravado: `v1.<iv b64>.<tag b64>.<ct b64>`.
 *
 * Trocar o JWT_SECRET invalida o que foi cifrado (decryptSecret devolve null e
 * o admin precisa gravar a chave de novo). O valor em claro nunca e logado.
 */
const VERSION = 'v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function settingsKey(): Buffer {
  return createHmac('sha256', getEnv().JWT_SECRET).update('scale:settings-key:v1').digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', settingsKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

/**
 * Decifra; formato invalido, versao desconhecida ou tag errada (segredo
 * trocado / linha adulterada) = null + warn. Nunca lanca, nunca loga o valor.
 */
export function decryptSecret(stored: string, log?: { warn: (msg: string) => void }): string | null {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    log?.warn('settingsCrypto: formato invalido do segredo cifrado (ignorado)');
    return null;
  }
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      log?.warn('settingsCrypto: formato invalido do segredo cifrado (ignorado)');
      return null;
    }
    const decipher = createDecipheriv('aes-256-gcm', settingsKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    log?.warn('settingsCrypto: nao foi possivel decifrar o segredo (tag invalida ou segredo trocado)');
    return null;
  }
}
