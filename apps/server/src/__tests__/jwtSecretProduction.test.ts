import { afterEach, describe, expect, it } from 'vitest';
import { getEnv, resetEnv } from '../lib/env.js';

const SECRET_DE_TESTE = 'test-secret-for-unit-tests';
const PLACEHOLDER_DO_ENV_EXAMPLE = 'change-me-in-production';

function configurar(nodeEnv: string, jwtSecret: string): void {
  process.env.NODE_ENV = nodeEnv;
  process.env.JWT_SECRET = jwtSecret;
  resetEnv();
}

describe('JWT_SECRET em producao', () => {
  afterEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = SECRET_DE_TESTE;
    resetEnv();
  });

  it('recusa o valor de exemplo do .env.example', () => {
    configurar('production', PLACEHOLDER_DO_ENV_EXAMPLE);
    expect(() => getEnv()).toThrow(/JWT_SECRET/);
  });

  it('recusa segredo com menos de 32 caracteres', () => {
    configurar('production', 'x'.repeat(31));
    expect(() => getEnv()).toThrow(/JWT_SECRET/);
  });

  it('nao conta espacos nas pontas para o minimo', () => {
    configurar('production', ` ${'x'.repeat(30)} `);
    expect(() => getEnv()).toThrow(/JWT_SECRET/);
  });

  it('aceita segredo com 32 caracteres ou mais', () => {
    configurar('production', 'x'.repeat(32));
    expect(getEnv().JWT_SECRET).toBe('x'.repeat(32));
  });

  it('nao vaza o valor do segredo na mensagem de erro', () => {
    configurar('production', 'segredo-curto-de-teste');
    expect(() => getEnv()).toThrow(/^(?![\s\S]*segredo-curto-de-teste)/);
  });

  it.each(['development', 'test'])('nao exige o minimo em %s', (nodeEnv) => {
    configurar(nodeEnv, PLACEHOLDER_DO_ENV_EXAMPLE);
    expect(getEnv().JWT_SECRET).toBe(PLACEHOLDER_DO_ENV_EXAMPLE);
  });
});
