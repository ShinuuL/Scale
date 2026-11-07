import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { Prisma, type User } from '@prisma/client';
import { usernameSchema } from '@scale/shared';
import { prisma } from '../lib/prisma.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  DUMMY_PASSWORD_HASH,
} from '../lib/auth.js';
import { getClientIp } from '../lib/clientIp.js';
import { meSelect, toMe } from './profile.js';
import { findUserByEmail, normalizeEmail, normalizeStoredEmail } from '../lib/userEmail.js';
import {
  isLoginRateLimited,
  isLoginEmailRateLimited,
  isRegisterRateLimited,
  isRefreshRateLimited,
  isUsernameCheckRateLimited,
  resetLoginRateLimit,
  resetLoginEmailRateLimit,
} from '../lib/rateLimit.js';

// O transform normaliza (trim + lowercase) no PARSE: todo consumidor do schema
// recebe o email canônico, impossível esquecer a normalização num caminho novo.
// `username` e opcional na API (clientes antigos e a conta criada pelo GitHub
// escolhem depois, em /friends); o formulario do site sempre envia.
const registerSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
  username: usernameSchema.optional(),
});

// `email` aceita o e-mail OU o @nome (o nome do campo ficou por compatibilidade
// com clientes antigos). Quem decide qual dos dois e `parseLoginIdentifier`.
const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1),
});

const usernameQuerySchema = z.object({ username: usernameSchema });

type LoginIdentifier = { kind: 'email'; value: string } | { kind: 'username'; value: string };

/**
 * E-mail se tiver "@" depois do primeiro caractere ("@fulano" e @nome);
 * senao @nome. Devolve null quando nao e nenhum dos dois formatos validos.
 */
function parseLoginIdentifier(raw: string): LoginIdentifier | null {
  if (raw.indexOf('@', 1) > 0) {
    const email = z.string().email().safeParse(raw);
    return email.success ? { kind: 'email', value: normalizeEmail(email.data) } : null;
  }
  const username = usernameSchema.safeParse(raw);
  return username.success ? { kind: 'username', value: username.data } : null;
}

async function findUserByLogin(id: LoginIdentifier): Promise<User | null> {
  if (id.kind === 'email') return findUserByEmail(id.value);
  const handle = await prisma.username.findUnique({
    where: { name: id.value },
    select: { user: true },
  });
  return handle?.user ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Mensagem unica para "email nao existe" e "senha errada": nao vaza se a conta
 * existe (enumeracao de usuarios). O mesmo vale para o tempo de resposta — ver
 * DUMMY_PASSWORD_HASH em lib/auth.ts (custo derivado de SALT_ROUNDS).
 */
const INVALID_CREDENTIALS = 'Invalid credentials';

/** 401 padrao de credencial invalida. */
function invalidCredentials(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({ error: INVALID_CREDENTIALS });
}

/** 429 com Retry-After (segundos) — padrao dos baldes de auth. */
function tooMany(reply: FastifyReply, message: string, retryAfterSeconds: number): FastifyReply {
  return reply
    .code(429)
    .header('Retry-After', String(Math.max(1, retryAfterSeconds)))
    .send({ error: message });
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /api/auth/register
  fastify.post('/api/auth/register', async (request, reply) => {
    // Balde ANTES de qualquer trabalho (bcrypt/DB): o endpoint cria uma linha
    // no SQLite por chamada, entao o flood e barato para o atacante e caro para
    // nos. IP local (dev/E2E) nao e contado.
    const ip = getClientIp(request);
    const ipLimit = isRegisterRateLimited(ip);
    if (ipLimit.limited) {
      return tooMany(
        reply,
        'Too many accounts created from this IP. Try again later.',
        ipLimit.retryAfterSeconds,
      );
    }

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    // `email` já vem normalizado pelo schema (trim + lowercase): a checagem de
    // duplicidade e a gravação usam a mesma forma canônica do login.
    const { email, password, name, username } = parsed.data;

    // findUserByEmail também enxerga linhas legadas (email com maiúsculas) —
    // sem isso o cadastro criaria um irmão case-variant do mesmo email.
    const existing = await findUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered', field: 'email' });
    }
    if (username && (await prisma.username.findUnique({ where: { name: username } }))) {
      return reply.code(409).send({ error: 'Username already taken', field: 'username' });
    }

    const passwordHash = await hashPassword(password);
    let user;
    try {
      // Conta e @nome na mesma escrita: nunca sobra conta sem o nome escolhido.
      user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          name,
          ...(username ? { username: { create: { name: username } } } : {}),
        },
        select: { id: true, email: true, name: true, createdAt: true },
      });
    } catch (err) {
      // Corrida: outro cadastro levou o email ou o @nome entre a checagem e aqui.
      if (isUniqueViolation(err)) {
        const target = String((err as Prisma.PrismaClientKnownRequestError).meta?.target ?? '');
        return target.includes('email')
          ? reply.code(409).send({ error: 'Email already registered', field: 'email' })
          : reply.code(409).send({ error: 'Username already taken', field: 'username' });
      }
      throw err;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    reply.setCookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    // O JWT vai SO no cookie HttpOnly: no corpo ele ficaria ao alcance de JS
    // (XSS) e de logs/ferramentas que registram respostas.
    return reply.code(201).send({ user });
  });

  // POST /api/auth/login
  fastify.post('/api/auth/login', async (request, reply) => {
    const ip = getClientIp(request);

    // Dois baldes antes do bcrypt/DB: por IP (flood de um host) e por email
    // (credential stuffing distribuido na mesma conta). O de IP e checado antes
    // do parse para nao pagar nem o zod no flood de corpo invalido.
    const ipLimit = isLoginRateLimited(ip);

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      // Corpo invalido nao tem email para chavear; ainda assim respeita o balde
      // de IP (um flood de lixo tambem e abuso).
      if (ipLimit.limited) {
        return tooMany(
          reply,
          'Too many login attempts. Try again later.',
          ipLimit.retryAfterSeconds,
        );
      }
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const identifier = parseLoginIdentifier(parsed.data.email);
    // Balde por conta: chave "u:<nome>" para @nome, o email puro para email (o
    // "@" no meio impede colisao entre os dois formatos). Texto que nao e
    // nenhum dos dois cai no balde do texto cru e responde 401 como os outros.
    const accountKey = identifier
      ? identifier.kind === 'email'
        ? identifier.value
        : `u:${identifier.value}`
      : `raw:${parsed.data.email.toLowerCase()}`;
    const emailLimit = isLoginEmailRateLimited(accountKey);
    if (ipLimit.limited || emailLimit.limited) {
      const retryAfterSeconds = Math.max(
        ipLimit.retryAfterSeconds,
        emailLimit.retryAfterSeconds,
      );
      return tooMany(reply, 'Too many login attempts. Try again later.', retryAfterSeconds);
    }

    const { password } = parsed.data;

    // findUserByEmail cobre a forma canonica E as linhas legadas gravadas com
    // maiusculas (o SQLite compara BINARY, entao findUnique nao bastaria).
    // Mesma resposta (e mesmo tempo) para email ou @nome inexistente.
    const user = identifier ? await findUserByLogin(identifier) : null;
    if (!user) {
      // Gasta o mesmo tempo do caminho com bcrypt para nao vazar a existencia
      // da conta pelo timing da resposta.
      await verifyPassword(password, DUMMY_PASSWORD_HASH);
      return invalidCredentials(reply);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return invalidCredentials(reply);
    }

    // Login OK: migra o email legado para a forma canonica (no-op se ja e).
    await normalizeStoredEmail(user);
    // Login OK libera os baldes: um usuario legitimo que errou a senha algumas
    // vezes nao fica preso, e o atacante nao ganha nada (quando acerta a senha
    // ele ja tem a conta).
    resetLoginRateLimit(ip);
    resetLoginEmailRateLimit(accountKey);

    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    reply.setCookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
    });
  });

  // GET /api/auth/username-available?username=fulano — o cadastro mostra na
  // hora se o @nome esta livre. Nao vaza nada novo: o @nome ja e publico (e
  // por ele que se manda pedido de amizade).
  fastify.get('/api/auth/username-available', async (request, reply) => {
    const limit = isUsernameCheckRateLimited(getClientIp(request));
    if (limit.limited) {
      return tooMany(reply, 'Too many checks. Try again later.', limit.retryAfterSeconds);
    }
    const parsed = usernameQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'Validation failed',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const taken = await prisma.username.findUnique({ where: { name: parsed.data.username } });
    return reply.send({ username: parsed.data.username, available: !taken });
  });

  // GET /api/auth/me (requires auth)
  fastify.get('/api/auth/me', {
    preHandler: [fastify.authenticate as never],
  }, async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, select: meSelect });

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return reply.send({ user: toMe(user) });
  });

  // POST /api/auth/refresh
  fastify.post('/api/auth/refresh', {
    preHandler: [fastify.authenticate as never],
  }, async (request, reply) => {
    // Assina um JWT novo (CPU) por chamada: balde moderado por IP antes de tudo.
    const refreshLimit = isRefreshRateLimited(getClientIp(request));
    if (refreshLimit.limited) {
      return tooMany(
        reply,
        'Too many refresh attempts. Try again later.',
        refreshLimit.retryAfterSeconds,
      );
    }

    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      name: user.name,
    });

    reply.setCookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });

    return reply.send({ success: true });
  });
}
