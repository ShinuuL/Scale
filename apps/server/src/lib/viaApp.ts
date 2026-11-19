import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';

/**
 * Contexto "via app conectado" (servidor MCP). A ferramenta MCP executa a rota
 * REST de sempre por `app.inject` DENTRO de `runAsApp`; quem grava mensagem ou
 * auditoria le `currentViaApp()` e marca a linha com o nome do app. Fora desse
 * contexto (requisicao normal do navegador) o valor e sempre null, entao
 * nenhum cliente externo consegue forjar a marca.
 */
const storage = new AsyncLocalStorage<{ appName: string }>();

export function runAsApp<T>(appName: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ appName }, fn);
}

export function currentViaApp(): string | null {
  return storage.getStore()?.appName ?? null;
}

/*
 * O `app.inject` do Fastify nao preserva o contexto assincrono ate o handler.
 * Por isso a ferramenta MCP tambem manda um nonce de uso unico no header
 * VIA_APP_HEADER; o hook `onRequest` (plugins/auth.ts) troca o nonce pelo nome
 * do app e reabre o contexto com `enterWith`. O nonce so existe na memoria do
 * processo (32 bytes aleatorios, 60 s): um cliente externo nao tem como forjar.
 */
export const VIA_APP_HEADER = 'x-scale-via-app';
const NONCE_TTL_MS = 60_000;
const nonces = new Map<string, { appName: string; expiresAt: number }>();

export function issueViaAppNonce(appName: string): string {
  const now = Date.now();
  for (const [key, value] of nonces) if (value.expiresAt <= now) nonces.delete(key);
  const nonce = randomBytes(32).toString('base64url');
  nonces.set(nonce, { appName, expiresAt: now + NONCE_TTL_MS });
  return nonce;
}

/** Consome o nonce (uso unico) e marca o restante da requisicao como "via app". */
export function enterViaAppFromNonce(nonce: string | string[] | undefined): void {
  if (typeof nonce !== 'string') return;
  const entry = nonces.get(nonce);
  nonces.delete(nonce);
  if (!entry || entry.expiresAt <= Date.now()) return;
  storage.enterWith({ appName: entry.appName });
}
