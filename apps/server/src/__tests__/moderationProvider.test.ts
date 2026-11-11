/**
 * Provedores de moderacao: heuristica PT-BR (termos, @mencao, repeticao,
 * caixa alta), montagem da requisicao do provedor `claude` (SDK mockado —
 * nunca chama a API real), fail-open e config de ambiente.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createMock = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: createMock };
    constructor(public opts: Record<string, unknown>) {}
  }
  return { default: Anthropic };
});

import { classifyTextHeuristic, isShouting, normalizeText } from '../lib/moderation/heuristic.js';
import {
  createClaudeProvider,
  CLAUDE_MAX_TOKENS,
  SYSTEM_PROMPT,
  VERDICT_JSON_SCHEMA,
} from '../lib/moderation/claude.js';
import {
  getModerationProvider,
  moderateImage,
  moderateText,
  resetModerationProvider,
  setModerationProviderForTests,
} from '../lib/moderation/index.js';
import { getEnv, getModerationConfig, isScreenModerationEnabled, resetEnv } from '../lib/env.js';

describe('heuristica PT-BR', () => {
  it('normaliza acentos, caixa e letras repetidas', () => {
    expect(normalizeText('  BÚRRRRO  ')).toBe('burro');
  });

  it('texto normal passa', () => {
    for (const text of ['Oi, tudo bem?', 'Vamos compartilhar a tela agora', 'Manda o link da sala']) {
      expect(classifyTextHeuristic(text)).toMatchObject({ flagged: false, category: 'none' });
    }
  });

  it('ofensa grave bloqueia (high) e o reason nao copia o texto', () => {
    const v = classifyTextHeuristic('vai se matar seu lixo');
    expect(v.flagged).toBe(true);
    expect(v.category).toBe('bullying');
    expect(v.severity).toBe('high');
    expect(v.reason).not.toContain('matar');
    expect(v.reason.length).toBeLessThanOrEqual(200);
  });

  it('insulto comum fica em medium; dirigido a @mencao sobe para high', () => {
    expect(classifyTextHeuristic('que idiota').severity).toBe('medium');
    const targeted = classifyTextHeuristic('@Bia voce e uma idiota');
    expect(targeted.severity).toBe('high');
    expect(targeted.reason).toContain('mention');
  });

  it('repeticao e caixa alta elevam a severidade', () => {
    expect(classifyTextHeuristic('burro burro burro').severity).toBe('high');
    expect(isShouting('VOCE E MUITO BURRO MESMO')).toBe(true);
    expect(classifyTextHeuristic('VOCE E MUITO BURRO MESMO').severity).toBe('high');
    expect(isShouting('ok')).toBe(false);
  });

  it('odio e sexual explicito sao high mesmo sem alvo', () => {
    expect(classifyTextHeuristic('seu macaco').category).toBe('hate');
    expect(classifyTextHeuristic('manda nude').category).toBe('sexual');
    expect(classifyTextHeuristic('vou te matar').category).toBe('violence');
    expect(classifyTextHeuristic('vou te matar').severity).toBe('high');
  });
});

describe('provedor claude (SDK mockado)', () => {
  beforeEach(() => createMock.mockReset());

  function verdictMessage(body: unknown, stop_reason = 'end_turn') {
    return { stop_reason, content: [{ type: 'text', text: JSON.stringify(body) }] };
  }

  it('monta a requisicao de texto: modelo, max_tokens 256, effort low, json_schema, sem prefill', async () => {
    createMock.mockResolvedValue(verdictMessage({ flagged: true, category: 'bullying', severity: 'high', reason: 'insulto' }));
    const provider = createClaudeProvider({ apiKey: 'sk-test', model: 'claude-opus-5-5' });
    const v = await provider.classifyText('x'.repeat(5000), { lang: 'pt' });
    expect(v).toEqual({ flagged: true, category: 'bullying', severity: 'high', reason: 'insulto' });

    expect(createMock).toHaveBeenCalledTimes(1);
    const req = createMock.mock.calls[0][0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.max_tokens).toBe(CLAUDE_MAX_TOKENS);
    expect(req.output_config).toEqual({ effort: 'low', format: { type: 'json_schema', schema: VERDICT_JSON_SCHEMA } });
    expect(req.system[0].text).toBe(SYSTEM_PROMPT);
    expect(req.tool_choice).toBeUndefined();
    expect(req.tools).toBeUndefined();
    // Sem prefill: so uma mensagem, do usuario; texto truncado a 2000.
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    expect(req.messages[0].content[0].text.length).toBeLessThanOrEqual(2000 + 60);
  });

  it('monta a requisicao de imagem com bloco base64 image/jpeg', async () => {
    createMock.mockResolvedValue(verdictMessage({ flagged: false, category: 'none', severity: 'low', reason: 'ok' }));
    const provider = createClaudeProvider({ apiKey: 'sk-test', model: 'claude-opus-5-5' });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const v = await provider.classifyImage!(jpeg);
    expect(v.category).toBe('none');
    expect(v.flagged).toBe(false);
    const content = createMock.mock.calls[0][0].messages[0].content;
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } });
    expect(content[1].type).toBe('text');
  });

  it('refusal ou JSON invalido viram provider_error (fail-open)', async () => {
    const provider = createClaudeProvider({ apiKey: 'sk-test', model: 'claude-opus-5-5' });
    createMock.mockResolvedValueOnce({ stop_reason: 'refusal', content: [] });
    expect((await provider.classifyText('a', { lang: 'pt' })).reason).toBe('provider_error');
    createMock.mockResolvedValueOnce({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'nao e json' }] });
    expect((await provider.classifyText('a', { lang: 'pt' })).reason).toBe('provider_error');
    createMock.mockResolvedValueOnce(verdictMessage({ flagged: true, category: 'invalida', severity: 'high', reason: 'x' }));
    expect((await provider.classifyText('a', { lang: 'pt' })).reason).toBe('provider_error');
  });
});

describe('moderateText / moderateImage e config', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnv();
    setModerationProviderForTests(undefined);
    resetModerationProvider();
  });

  function setEnv(vars: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    resetEnv();
    resetModerationProvider();
  }

  it('MODERATION_PROVIDER=off nunca marca', async () => {
    setEnv({ JWT_SECRET: 'test-secret-for-unit-tests', MODERATION_PROVIDER: 'off' });
    expect(getModerationProvider().name).toBe('off');
    expect((await moderateText('seu idiota')).flagged).toBe(false);
  });

  it('default = heuristic', async () => {
    setEnv({ JWT_SECRET: 'test-secret-for-unit-tests', MODERATION_PROVIDER: undefined });
    expect(getModerationProvider().name).toBe('heuristic');
    expect((await moderateText('@Ana seu idiota')).severity).toBe('high');
  });

  it('provedor que lanca = fail-open com reason provider_error, e o log nao recebe o texto', async () => {
    setEnv({ JWT_SECRET: 'test-secret-for-unit-tests' });
    setModerationProviderForTests({
      name: 'claude',
      classifyText: async () => { throw Object.assign(new Error('boom'), { status: 500 }); },
      classifyImage: async () => { throw new Error('boom'); },
    });
    const warn = vi.fn();
    const v = await moderateText('texto secreto', { warn, error: vi.fn() });
    expect(v).toMatchObject({ flagged: false, reason: 'provider_error' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('texto secreto');
  });

  it('MODERATION_SCREEN=true sem provedor claude fica false efetivo e avisa uma vez', () => {
    setEnv({ JWT_SECRET: 'test-secret-for-unit-tests', MODERATION_PROVIDER: 'heuristic', MODERATION_SCREEN: 'true' });
    const warn = vi.fn();
    expect(isScreenModerationEnabled({ warn })).toBe(false);
    expect(isScreenModerationEnabled({ warn })).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(getModerationConfig().screen).toBe(false);
  });

  it('moderateImage com tela desligada devolve none sem chamar o provedor', async () => {
    setEnv({ JWT_SECRET: 'test-secret-for-unit-tests', MODERATION_PROVIDER: 'claude', MODERATION_SCREEN: 'false', ANTHROPIC_API_KEY: 'sk-x' });
    const classifyImage = vi.fn();
    setModerationProviderForTests({ name: 'claude', classifyText: async () => { throw new Error('no'); }, classifyImage });
    expect((await moderateImage(Buffer.from([0xff, 0xd8, 0xff]))).category).toBe('none');
    expect(classifyImage).not.toHaveBeenCalled();
  });

  it('GET config DTO: sem chave nem modelo; limites e defaults das vars', () => {
    setEnv({
      JWT_SECRET: 'test-secret-for-unit-tests', MODERATION_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'sk-secret',
      MODERATION_SCREEN: 'true', MODERATION_FRAME_INTERVAL_SEC: '30', SCREEN_SHARE_MIN_AGE: '16', PRIVACY_CONTACT_EMAIL: 'dpo@exemplo.com',
    });
    const cfg = getModerationConfig();
    expect(cfg).toEqual({ provider: 'claude', screen: true, minAge: 16, consentVersion: '2026-11', frameIntervalSec: 30, privacyContactEmail: 'dpo@exemplo.com' });
    expect(JSON.stringify(cfg)).not.toContain('sk-secret');
    expect(getEnv().MODERATION_RETENTION_DAYS).toBe(90);

    setEnv({ MODERATION_FRAME_INTERVAL_SEC: '5' });
    expect(() => getEnv()).toThrow();
  });

  it('producao: claude sem ANTHROPIC_API_KEY recusa subir', () => {
    setEnv({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), MODERATION_PROVIDER: 'claude', ANTHROPIC_API_KEY: undefined });
    expect(() => getEnv()).toThrow(/ANTHROPIC_API_KEY/);
    setEnv({ ANTHROPIC_API_KEY: 'sk-ok' });
    expect(() => getEnv()).not.toThrow();
  });
});
