import { describe, expect, it } from 'vitest';
import { communityNicknameSchema, displayNameOf } from './communityNickname.js';

describe('apelido por comunidade', () => {
  it('aplica trim, limita a 32 e trata vazio como limpar', () => {
    expect(communityNicknameSchema.parse({ nickname: '  Dragao  ' })).toEqual({ nickname: 'Dragao' });
    expect(communityNicknameSchema.parse({ nickname: '   ' })).toEqual({ nickname: null });
    expect(communityNicknameSchema.parse({ nickname: null })).toEqual({ nickname: null });
    expect(communityNicknameSchema.safeParse({ nickname: 'x'.repeat(33) }).success).toBe(false);
    expect(communityNicknameSchema.safeParse({}).success).toBe(false);
  });
  it('nome exibido prefere o apelido', () => {
    expect(displayNameOf({ name: 'Ana', nickname: 'Aninha' })).toBe('Aninha');
    expect(displayNameOf({ name: 'Ana', nickname: null })).toBe('Ana');
  });
});
