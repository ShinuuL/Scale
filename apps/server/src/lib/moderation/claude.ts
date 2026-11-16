import Anthropic from '@anthropic-ai/sdk';
import { moderationVerdictSchema } from '@scale/shared';
import { NONE_VERDICT, PROVIDER_ERROR_VERDICT, type ModerationProvider, type ModerationVerdict } from './types.js';

/**
 * Provedor `claude` (SDK oficial). O que sai do servidor e SO a mensagem (ate
 * 2000 chars) ou o JPEG da amostra de tela — sem nome, e-mail, id ou
 * historico. A chave nunca e logada; o frame nunca e gravado nem logado.
 *
 * Regras (spec secao 3): structured output com o JSON schema do veredito,
 * max_tokens 256, effort low, timeout 8 s, 1 retry. Sem prefill e sem
 * tool_choice forcado. `stop_reason === 'refusal'` = provider_error (fail-open).
 */
export const CLAUDE_TIMEOUT_MS = 8_000;
export const CLAUDE_MAX_RETRIES = 1;
export const CLAUDE_MAX_TOKENS = 256;
export const TEXT_MAX_CHARS = 2000;

/** JSON schema do ModerationVerdict (mesmo shape do zod em @scale/shared). */
export const VERDICT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['flagged', 'category', 'severity', 'reason'],
  properties: {
    flagged: { type: 'boolean' },
    category: { type: 'string', enum: ['bullying', 'hate', 'sexual', 'violence', 'none'] },
    severity: { type: 'string', enum: ['low', 'medium', 'high'] },
    reason: { type: 'string', maxLength: 200 },
  },
} as const;

/** Prompt fixo (cacheavel): categorias e escala, em PT-BR. */
export const SYSTEM_PROMPT = `Voce e o assistente de moderacao de um aplicativo brasileiro de chamadas de voz com chat e partilha de tela. Classifique o conteudo recebido (uma mensagem de chat ou uma amostra da tela compartilhada) e responda SOMENTE com o JSON pedido.

Categorias:
- "bullying": insulto, humilhacao, assedio ou intimidacao dirigidos a uma pessoa.
- "hate": ataque ou desumanizacao por raca, etnia, religiao, genero, orientacao sexual, deficiencia ou origem.
- "sexual": conteudo sexual explicito, nudez, assedio sexual ou qualquer sexualizacao de menores.
- "violence": ameaca, incitacao ou apologia a violencia, automutilacao ou suicidio.
- "none": nada disso.

Severidade:
- "low": leve, ambiguo, provavelmente brincadeira entre conhecidos; nenhuma acao.
- "medium": ofensivo ou impropio; o autor recebe um aviso.
- "high": grave, dirigido a alguem ou claramente proibido; o conteudo e bloqueado (ou a partilha de tela e interrompida).

Regras:
- flagged = true somente quando a categoria nao for "none".
- "reason" tem no maximo 200 caracteres, em portugues, e NUNCA repete nem cita o conteudo analisado.
- Palavroes isolados sem alvo sao no maximo "low". Ironia e citacao de terceiros contam menos que ataque direto.
- Em caso de duvida, prefira severidade menor.`;

function extractVerdict(message: Anthropic.Message): ModerationVerdict {
  if (message.stop_reason === 'refusal') return PROVIDER_ERROR_VERDICT;
  const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text;
  if (!text) return PROVIDER_ERROR_VERDICT;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return PROVIDER_ERROR_VERDICT;
  }
  const parsed = moderationVerdictSchema.safeParse(raw);
  if (!parsed.success) return PROVIDER_ERROR_VERDICT;
  const verdict = parsed.data;
  // Coerencia: sem categoria nao ha flag.
  if (verdict.category === 'none') return { ...NONE_VERDICT, reason: verdict.reason || 'none' };
  return { ...verdict, flagged: true };
}

export interface ClaudeProviderOptions {
  apiKey: string;
  model: string;
  /** Injecao para testes (client mockado). */
  client?: Anthropic;
}

export function createClaudeProvider(opts: ClaudeProviderOptions): ModerationProvider {
  const client =
    opts.client ??
    new Anthropic({ apiKey: opts.apiKey, timeout: CLAUDE_TIMEOUT_MS, maxRetries: CLAUDE_MAX_RETRIES });

  const base = {
    model: opts.model,
    max_tokens: CLAUDE_MAX_TOKENS,
    system: [{ type: 'text' as const, text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' as const } }],
    output_config: { effort: 'low' as const, format: { type: 'json_schema' as const, schema: VERDICT_JSON_SCHEMA } },
  };

  return {
    name: 'claude',
    async classifyText(text) {
      const content = text.slice(0, TEXT_MAX_CHARS);
      const message = await client.messages.create({
        ...base,
        messages: [{ role: 'user', content: [{ type: 'text', text: `Classifique esta mensagem de chat:\n\n${content}` }] }],
      });
      return extractVerdict(message);
    },
    async classifyImage(jpeg) {
      const message = await client.messages.create({
        ...base,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
              { type: 'text', text: 'Classifique esta amostra de uma tela compartilhada numa chamada.' },
            ],
          },
        ],
      });
      return extractVerdict(message);
    },
  };
}
