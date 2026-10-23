import { describe, it, expect } from 'vitest';
import {
  SALT_ROUNDS,
  DUMMY_PASSWORD_HASH,
  bcryptCost,
  hashPassword,
  verifyPassword,
} from '../lib/auth.js';

/**
 * Achado 1 (Etapa 5) — enumeração de contas por TIMING no login.
 *
 * O caminho "email inexistente" compara a senha contra DUMMY_PASSWORD_HASH para
 * gastar o mesmo tempo do caminho "senha errada". Se o custo do dummy divergir
 * de SALT_ROUNDS (era `$2b$10$` contra senhas reais em custo 12), os dois
 * caminhos respondem em ordens de grandeza diferentes e dá para descobrir quais
 * contas existem medindo o tempo.
 *
 * O teste assere a IGUALDADE DE CUSTO (não latência): determinístico e sem
 * dependência da máquina. A prova de tempo em execução real fica no relatório.
 */
describe('login — hash dummy com o mesmo custo do bcrypt real', () => {
  it('DUMMY_PASSWORD_HASH usa exatamente SALT_ROUNDS', () => {
    expect(bcryptCost(DUMMY_PASSWORD_HASH)).toBe(SALT_ROUNDS);
  });

  it('senhas reais também usam SALT_ROUNDS (fonte única não divergiu)', async () => {
    const hash = await hashPassword('senha-de-teste');
    expect(bcryptCost(hash)).toBe(SALT_ROUNDS);
  });

  it('DUMMY_PASSWORD_HASH é um hash bcrypt válido (compare roda e devolve false)', async () => {
    // Se o corpo do hash fosse inválido, compare lançaria em vez de devolver
    // false — o caminho "email inexistente" viraria 500.
    await expect(verifyPassword('qualquer-senha', DUMMY_PASSWORD_HASH)).resolves.toBe(false);
  });
});