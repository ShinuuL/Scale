import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import {
  hashPassword,
  verifyPassword,
  signToken,
  DUMMY_PASSWORD_HASH,
} from '../lib/auth.js';
import { getClientIp } from '../lib/clientIp.js';
import { findUserByEmail, normalizeEmail, normalizeStoredEmail } from '../lib/userEmail.js';
import {
  isLoginRateLimited,
  isLoginEmailRateLimited,
  isRegisterRateLimited,
  isRefreshRateLimited,
  resetLoginRateLimit,
  resetLoginEmailRateLimit,
} from '../lib/rateLimit.js';

// O transform normaliza (trim + lowercase) no PARSE: todo consumidor do schema
// recebe o email canônico, impossível esquecer a normalização num caminho novo.
const registerSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email().transform(normalizeEmail),
  password: z.string().min(1),
});

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
    const { email, password, name } = parsed.data;

    // findUserByEmail também enxerga linhas legadas (email com maiúsculas) —
    // sem isso o cadastro criaria um irmão case-variant do mesmo email.
    const existing = await findUserByEmail(email);
    if (existing) {
      return reply.code(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
      select: { id: true, email: true, name: true, createdAt: true },
    });

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

    const email = parsed.data.email; // já normalizado pelo schema
    const emailLimit = isLoginEmailRateLimited(email);
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
    const user = await findUserByEmail(email);
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
    resetLoginEmailRateLimit(email);

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

  // GET /api/auth/me (requires auth)
  fastify.get('/api/auth/me', {
    preHandler: [fastify.authenticate as never],
  }, async (request, reply) => {
    const userId = request.userId;
    if (!userId) {
      return reply.code(401).send({ error: 'Not authenticated' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true, avatarUpdatedAt: true },
    });

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    return reply.send({ user });
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
