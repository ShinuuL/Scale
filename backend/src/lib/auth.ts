import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getEnv } from './env.js';

export interface JwtPayload {
  userId: string;
  email: string;
  name: string;
}

/**
 * Custo do bcrypt — fonte ÚNICA. Usado por hashPassword e por
 * DUMMY_PASSWORD_HASH: os dois caminhos do login (senha real vs. senha contra o
 * dummy) precisam custar o mesmo tempo, senão a resposta vaza se a conta existe.
 */
export const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = '7d';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Custo efetivo de um hash bcrypt (`$2b$NN$...`). Existe para o teste de
 * regressão comparar o custo do dummy com SALT_ROUNDS sem medir latência (que
 * varia com a máquina e seria flaky).
 */
export function bcryptCost(hash: string): number {
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
  if (!match) {
    throw new Error('Hash bcrypt inválido');
  }
  return Number(match[1]);
}

/**
 * Corpo de um hash bcrypt válido: salt de 22 + digest de 31 caracteres (mesmo
 * formato de um hash real). Só o CORPO é literal; o custo vem de SALT_ROUNDS.
 */
const DUMMY_HASH_BODY = 'CwTycUXWue0Thq9StjUM0uJ8m7XpQH5vMFbYbYQ4u7eO0yGfVv2Uu';

/**
 * Hash bcrypt "dummy" usado quando o email NÃO existe (routes/auth.ts): comparar
 * a senha enviada contra ele gasta o mesmo tempo de um verify real e fecha a
 * enumeração de contas por timing.
 *
 * O custo é DERIVADO de SALT_ROUNDS (fonte única). Um dígito fixo aqui (ex.:
 * `$2b$10$`) fazia este caminho responder ~100 ms mais rápido que o caminho com
 * senha real — medido: email inexistente vs. senha errada —, o que permitia
 * descobrir quais contas existem pelo tempo da resposta.
 */
export const DUMMY_PASSWORD_HASH = `$2b$${String(SALT_ROUNDS).padStart(2, '0')}$${DUMMY_HASH_BODY}`;

export function signToken(payload: JwtPayload): string {
  const env = getEnv();
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): JwtPayload {
  const env = getEnv();
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}
