import type { User } from '@prisma/client';
import { prisma } from './prisma.js';

/**
 * Email canônico do usuário — fonte ÚNICA para registro, login e checagem de
 * duplicidade.
 *
 * Por que existe: no SQLite a coluna `email` é `TEXT UNIQUE` com comparação
 * BINARY (case-sensitive). Se o registro gravar `"User@Example.com"` e o login
 * procurar `"user@example.com"`, `findUnique` não acha a linha e a conta NUNCA
 * loga — regressão reproduzida em dev. Normalizando (trim + lowercase) em todos
 * os caminhos de escrita/leitura, existe apenas uma forma canônica no banco.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Busca o usuário pelo email normalizado, com fallback para linhas legadas.
 *
 * Dados gravados antes desta correção podem ter maiúsculas (ex.: o usuário de
 * probe `CriticProbe@Example.com` no SQLite de dev). Como a comparação do SQLite
 * é BINARY, um `findUnique` com o valor normalizado não encontraria essas linhas;
 * a consulta `lower(email)` cobre os dois formatos sem exigir migration.
 *
 * A partir daqui nenhuma linha nova é gravada fora da forma canônica
 * (`normalizeStoredEmail` também converte o legado no primeiro login válido).
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = normalizeEmail(email);

  const canonical = await prisma.user.findUnique({ where: { email: normalized } });
  if (canonical) return canonical;

  // Legado: apenas o id, para refazer a leitura tipada pelo Prisma (evita
  // converter na mão os tipos de data que o driver devolve no raw).
  const legacy = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "User" WHERE lower(email) = ${normalized} LIMIT 1
  `;
  if (legacy.length === 0) return null;

  return prisma.user.findUnique({ where: { id: legacy[0].id } });
}

/**
 * Reescreve uma linha legada (email com maiúsculas) na forma canônica.
 *
 * Chamado após um login válido: é o caminho natural para "migrar" o dado sem um
 * script à parte, e é seguro porque o email só muda de caixa. Colisão com uma
 * linha já canônica (mesmo email em dois registros) não derruba o login — nesse
 * caso o legado permanece e `findUserByEmail` continua encontrando a conta.
 */
export async function normalizeStoredEmail(user: Pick<User, 'id' | 'email'>): Promise<void> {
  const normalized = normalizeEmail(user.email);
  if (normalized === user.email) return;

  try {
    await prisma.user.update({ where: { id: user.id }, data: { email: normalized } });
  } catch {
    // Colisão de unicidade: o dado legado fica como está (a leitura cobre).
  }
}
