/**
 * Contas de login externo (GitHub, Google): resolucao no login e vinculo.
 *
 * Login (`resolveOAuthLogin`):
 *   1. id do provedor ja vinculado            -> entra nessa conta.
 *   2. sem e-mail VERIFICADO pelo provedor    -> recusa (sem_email).
 *   3. e-mail ja cadastrado                   -> VINCULA automaticamente e entra
 *      (escolha do produto). Se a conta ja tem OUTRA conta desse provedor, recusa
 *      (outra_conta). Fica registrado no log.
 *      Risco aceito: o cadastro por senha nao confirma e-mail; quem tivesse
 *      pre-cadastrado o e-mail alheio continuaria entrando com a senha.
 *   4. senao                                  -> cria a conta.
 *
 * Vinculo pela sessao (`linkOAuthAccount`, botao em Configuracoes): o usuario
 * logado prova as duas identidades, entao vale para e-mails diferentes.
 *
 * Intencao de vinculo: o callback chega por navegacao vinda do provedor e o
 * cookie de sessao (SameSite=Strict) NAO vem nela. Por isso, ao iniciar o
 * vinculo (navegacao same-site, com sessao), guardamos no servidor
 * `state -> userId` (memoria, 10 min, uso unico). Nada disso vai em cookie que
 * o cliente possa editar.
 */
import { randomBytes } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from './prisma.js';
import { hashPassword } from './auth.js';
import { findUserByEmail, normalizeEmail } from './userEmail.js';
import { isRegisterRateLimited } from './rateLimit.js';

export type OAuthProvider = 'github' | 'google';

export interface OAuthIdentity {
  provider: OAuthProvider;
  /** id estavel no provedor (GitHub: id numerico; Google: `sub`). */
  providerId: string;
  /** login do GitHub (exibicao); null no Google. */
  login: string | null;
  name: string | null;
  /** e-mail VERIFICADO pelo provedor; null se nao houver. */
  email: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export type OAuthLoginError = 'sem_email' | 'outra_conta' | 'limite';
export type OAuthLinkStatus = 'ok' | 'outra_conta' | 'ja_vinculado';

const userSelect = { id: true, email: true, name: true } as const;

/** Usuario dono do id do provedor (null se nao vinculado). Atualiza o login do GitHub. */
async function findLinkedUser(identity: OAuthIdentity): Promise<SessionUser | null> {
  if (identity.provider === 'github') {
    const linked = await prisma.githubAccount.findUnique({
      where: { githubId: identity.providerId },
      select: { id: true, login: true, user: { select: userSelect } },
    });
    if (!linked) return null;
    if (identity.login && linked.login !== identity.login) {
      await prisma.githubAccount.update({ where: { id: linked.id }, data: { login: identity.login } });
    }
    return linked.user;
  }
  const linked = await prisma.googleAccount.findUnique({
    where: { googleId: identity.providerId },
    select: { user: { select: userSelect } },
  });
  return linked?.user ?? null;
}

/** true se o usuario ja tem uma conta deste provedor vinculada (qualquer id). */
async function userHasProvider(userId: string, provider: OAuthProvider): Promise<boolean> {
  const count =
    provider === 'github'
      ? await prisma.githubAccount.count({ where: { userId } })
      : await prisma.googleAccount.count({ where: { userId } });
  return count > 0;
}

async function createLink(userId: string, identity: OAuthIdentity): Promise<void> {
  if (identity.provider === 'github') {
    await prisma.githubAccount.create({
      data: { userId, githubId: identity.providerId, login: identity.login ?? identity.providerId },
    });
  } else {
    await prisma.googleAccount.create({ data: { userId, googleId: identity.providerId } });
  }
}

export async function resolveOAuthLogin(
  identity: OAuthIdentity,
  ip: string,
  log: FastifyBaseLogger,
): Promise<{ user: SessionUser } | { error: OAuthLoginError }> {
  const linked = await findLinkedUser(identity);
  if (linked) return { user: linked };

  if (!identity.email) return { error: 'sem_email' };
  const email = normalizeEmail(identity.email);

  const existing = await findUserByEmail(email);
  if (existing) {
    if (await userHasProvider(existing.id, identity.provider)) return { error: 'outra_conta' };
    await createLink(existing.id, identity);
    log.info({ userId: existing.id, provider: identity.provider }, 'oauth: conta existente vinculada pelo e-mail verificado');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: existing.id }, select: userSelect });
    return { user };
  }

  if (isRegisterRateLimited(ip).limited) return { error: 'limite' };
  const passwordHash = await hashPassword(randomBytes(32).toString('hex'));
  const name = (identity.name ?? identity.login ?? email.split('@')[0]).slice(0, 100);
  const user = await prisma.user.create({ data: { email, passwordHash, name }, select: userSelect });
  await createLink(user.id, identity);
  log.info({ userId: user.id, provider: identity.provider }, 'oauth: conta criada');
  return { user };
}

/** Vincula a identidade ao usuario logado que iniciou o fluxo. */
export async function linkOAuthAccount(identity: OAuthIdentity, userId: string): Promise<OAuthLinkStatus> {
  const owner = await findLinkedUser(identity);
  if (owner) return owner.id === userId ? 'ok' : 'outra_conta';
  if (await userHasProvider(userId, identity.provider)) return 'ja_vinculado';
  await createLink(userId, identity);
  return 'ok';
}

// ---- intencao de vinculo (state -> userId), em memoria ----

const LINK_TTL_MS = 10 * 60_000;
const LINK_MAX = 10_000;
const linkIntents = new Map<string, { userId: string; provider: OAuthProvider; expiresAt: number }>();

export function rememberLinkIntent(state: string, userId: string, provider: OAuthProvider): void {
  const now = Date.now();
  if (linkIntents.size >= LINK_MAX) {
    for (const [k, v] of linkIntents) if (v.expiresAt <= now) linkIntents.delete(k);
    if (linkIntents.size >= LINK_MAX) {
      const oldest = linkIntents.keys().next().value;
      if (oldest !== undefined) linkIntents.delete(oldest);
    }
  }
  linkIntents.set(state, { userId, provider, expiresAt: now + LINK_TTL_MS });
}

/** Consome (uso unico) a intencao ligada ao state; null se nao houver ou expirou. */
export function takeLinkIntent(state: string, provider: OAuthProvider): string | null {
  const intent = linkIntents.get(state);
  linkIntents.delete(state);
  if (!intent || intent.provider !== provider || intent.expiresAt <= Date.now()) return null;
  return intent.userId;
}

/** Contas vinculadas do usuario (para a tela de Configuracoes). */
export async function getLinkedAccounts(
  userId: string,
): Promise<{ github: { login: string } | null; google: boolean }> {
  const [github, google] = await Promise.all([
    prisma.githubAccount.findUnique({ where: { userId }, select: { login: true } }),
    prisma.googleAccount.count({ where: { userId } }),
  ]);
  return { github: github ? { login: github.login } : null, google: google > 0 };
}
