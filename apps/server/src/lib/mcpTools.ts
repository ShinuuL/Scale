import jwt from 'jsonwebtoken';
import type { FastifyInstance, InjectOptions } from 'fastify';
import type { McpScope } from '@scale/shared';
import { getEnv } from './env.js';
import { prisma } from './prisma.js';
import { issueViaAppNonce, runAsApp, VIA_APP_HEADER } from './viaApp.js';
import { signRoomTicket, ROOM_TICKET_HEADER } from './roomTicket.js';
import type { McpPrincipal } from './oauthServer.js';
import { getRoomPeersSnapshot, isUserInRoom, sendRoomChatAsUser } from '../socket/handler.js';

/**
 * Ferramentas do servidor MCP.
 *
 * Regra central: a ferramenta NAO reimplementa regra de negocio. Ela chama a
 * rota REST de sempre por `app.inject`, como o proprio usuario (sessao de 60 s
 * que nunca sai do processo), dentro de `runAsApp` — entao valem as mesmas
 * permissoes de canal, cargos, castigo, modo lento, baldes e eventos em tempo
 * real, e a mensagem/auditoria sai marcada "via <app>".
 */

type JsonSchema = Record<string, unknown>;
type Args = Record<string, unknown>;

export interface ToolResult { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

interface ToolContext { app: FastifyInstance; principal: McpPrincipal }

interface ToolDef {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  readOnly: boolean;
  inputSchema: JsonSchema;
  run: (args: Args, ctx: ToolContext) => Promise<ToolResult>;
}

/* ─── Esquemas de entrada ─────────────────────────────────────────────── */

const id = (description: string): JsonSchema => ({ type: 'string', format: 'uuid', description });
const obj = (properties: Record<string, JsonSchema>, required: string[] = []): JsonSchema =>
  ({ type: 'object', properties, required, additionalProperties: false });
const content: JsonSchema = { type: 'string', minLength: 1, maxLength: 2000, description: 'Texto da mensagem.' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ToolInputError extends Error {}

function needId(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new ToolInputError(`"${key}" precisa ser um id (UUID).`);
  return value;
}

/** Copia so as chaves permitidas (o corpo e validado de novo pela rota). */
function pick(args: Args, keys: string[]): Args {
  const out: Args = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
}

/* ─── Execucao ────────────────────────────────────────────────────────── */

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data ?? { ok: true }, null, 2) }] });
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

const STATUS_TEXT: Record<number, string> = {
  400: 'Pedido invalido para o Scale',
  401: 'Sessao do app expirou',
  403: 'Sem permissao para esta acao',
  404: 'Nao encontrado ou sem acesso',
  409: 'Conflito com o estado atual',
  429: 'Limite de uso atingido; tente de novo mais tarde',
};

async function sessionToken(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true } });
  if (!user) return null;
  return jwt.sign({ userId: user.id, email: user.email, name: user.name }, getEnv().JWT_SECRET, { expiresIn: 60 });
}

async function callApi(ctx: ToolContext, opts: { method: InjectOptions['method']; url: string; body?: unknown; headers?: Record<string, string> }): Promise<ToolResult> {
  const token = await sessionToken(ctx.principal.userId);
  if (!token) return fail('Conta nao encontrada.');
  const res = await runAsApp(ctx.principal.appName, () => ctx.app.inject({
    method: opts.method,
    url: opts.url,
    headers: { authorization: `Bearer ${token}`, [VIA_APP_HEADER]: issueViaAppNonce(ctx.principal.appName), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}), ...opts.headers },
    ...(opts.body !== undefined ? { payload: JSON.stringify(opts.body) } : {}),
  }));
  let data: unknown = null;
  if (res.body) { try { data = JSON.parse(res.body); } catch { data = res.body; } }
  if (res.statusCode >= 200 && res.statusCode < 300) return ok(data);
  const detail = data && typeof data === 'object' ? JSON.stringify(data) : '';
  return fail(`${STATUS_TEXT[res.statusCode] ?? `Erro ${res.statusCode}`} (HTTP ${res.statusCode}). ${detail}`.trim());
}

const enc = encodeURIComponent;

/* ─── Catalogo ────────────────────────────────────────────────────────── */

const TOOLS: ToolDef[] = [
  // Canais de texto (escopo channels)
  {
    name: 'list_communities', title: 'Listar comunidades', scope: 'channels', readOnly: true,
    description: 'Lista as comunidades das quais o usuario e membro, com contagem de nao lidas.',
    inputSchema: obj({}),
    run: (_a, ctx) => callApi(ctx, { method: 'GET', url: '/api/communities' }),
  },
  {
    name: 'get_community', title: 'Ver comunidade', scope: 'channels', readOnly: true,
    description: 'Detalhes de uma comunidade: canais de texto e voz visiveis ao usuario, categorias, cargos e membros.',
    inputSchema: obj({ communityId: id('Id da comunidade.') }, ['communityId']),
    run: (a, ctx) => callApi(ctx, { method: 'GET', url: `/api/communities/${enc(needId(a, 'communityId'))}` }),
  },
  {
    name: 'read_channel_messages', title: 'Ler mensagens do canal', scope: 'channels', readOnly: true,
    description: 'Mensagens recentes de um canal de texto (mais antigas primeiro). Use "cursor" (nextCursor da resposta anterior) para paginar para tras.',
    inputSchema: obj({
      channelId: id('Id do canal de texto.'),
      limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Quantidade (padrao 30).' },
      cursor: id('Id da mensagem a partir da qual buscar as anteriores.'),
    }, ['channelId']),
    run: (a, ctx) => {
      const q = new URLSearchParams();
      if (typeof a.limit === 'number') q.set('limit', String(a.limit));
      if (a.cursor !== undefined) q.set('cursor', needId(a, 'cursor'));
      const qs = q.toString();
      return callApi(ctx, { method: 'GET', url: `/api/channels/${enc(needId(a, 'channelId'))}/messages${qs ? `?${qs}` : ''}` });
    },
  },
  {
    name: 'send_channel_message', title: 'Enviar mensagem no canal', scope: 'channels', readOnly: false,
    description: 'Envia uma mensagem num canal de texto como o usuario; ela aparece com o selo "via <app>". Respeita canal de avisos, modo lento e castigo.',
    inputSchema: obj({ channelId: id('Id do canal de texto.'), content, replyToId: id('Opcional: id de uma mensagem do mesmo canal para responder com citacao.') }, ['channelId', 'content']),
    run: (a, ctx) => callApi(ctx, { method: 'POST', url: `/api/channels/${enc(needId(a, 'channelId'))}/messages`, body: pick(a, ['content', 'replyToId']) }),
  },
  {
    name: 'read_thread_messages', title: 'Ler topico', scope: 'channels', readOnly: true,
    description: 'Mensagens de um topico (thread) de canal de texto.',
    inputSchema: obj({ threadId: id('Id do topico.') }, ['threadId']),
    run: (a, ctx) => callApi(ctx, { method: 'GET', url: `/api/threads/${enc(needId(a, 'threadId'))}/messages` }),
  },
  {
    name: 'send_thread_message', title: 'Responder no topico', scope: 'channels', readOnly: false,
    description: 'Envia uma resposta dentro de um topico (thread) como o usuario, com o selo "via <app>".',
    inputSchema: obj({ threadId: id('Id do topico.'), content }, ['threadId', 'content']),
    run: (a, ctx) => callApi(ctx, { method: 'POST', url: `/api/threads/${enc(needId(a, 'threadId'))}/messages`, body: pick(a, ['content']) }),
  },
  {
    name: 'search_messages', title: 'Buscar mensagens', scope: 'channels', readOnly: true,
    description: 'Busca texto nas mensagens de uma comunidade (sem diferenciar maiusculas e acentos).',
    inputSchema: obj({
      communityId: id('Id da comunidade.'),
      q: { type: 'string', minLength: 2, maxLength: 100, description: 'Texto a buscar.' },
      channelId: id('Opcional: limitar a um canal.'),
    }, ['communityId', 'q']),
    run: (a, ctx) => {
      const q = new URLSearchParams({ q: String(a.q ?? '') });
      if (a.channelId !== undefined) q.set('channelId', needId(a, 'channelId'));
      return callApi(ctx, { method: 'GET', url: `/api/communities/${enc(needId(a, 'communityId'))}/search?${q.toString()}` });
    },
  },

  // Configuracao de comunidade (escopo community.manage)
  {
    name: 'create_channel', title: 'Criar canal', scope: 'community.manage', readOnly: false,
    description: 'Cria um canal de texto ou de voz. Exige permissao de gerenciar canais.',
    inputSchema: obj({
      communityId: id('Id da comunidade.'),
      name: { type: 'string', minLength: 1, maxLength: 40, description: 'Nome do canal.' },
      kind: { type: 'string', enum: ['TEXT', 'VOICE'], description: 'TEXT = canal de texto, VOICE = canal de voz.' },
    }, ['communityId', 'name', 'kind']),
    run: (a, ctx) => callApi(ctx, { method: 'POST', url: `/api/communities/${enc(needId(a, 'communityId'))}/channels`, body: pick(a, ['name', 'kind']) }),
  },
  {
    name: 'update_channel', title: 'Editar canal', scope: 'community.manage', readOnly: false,
    description: 'Renomeia um canal e/ou muda o topico (topic null ou vazio limpa).',
    inputSchema: obj({
      channelId: id('Id do canal.'),
      name: { type: 'string', minLength: 1, maxLength: 40 },
      topic: { type: ['string', 'null'], maxLength: 200 },
    }, ['channelId']),
    run: (a, ctx) => callApi(ctx, { method: 'PATCH', url: `/api/channels/${enc(needId(a, 'channelId'))}`, body: pick(a, ['name', 'topic']) }),
  },
  {
    name: 'delete_channel', title: 'Apagar canal', scope: 'community.manage', readOnly: false,
    description: 'Apaga um canal e todo o seu historico. Irreversivel: confirme com o usuario antes.',
    inputSchema: obj({ channelId: id('Id do canal.') }, ['channelId']),
    run: (a, ctx) => callApi(ctx, { method: 'DELETE', url: `/api/channels/${enc(needId(a, 'channelId'))}` }),
  },
  {
    name: 'update_channel_settings', title: 'Configurar canal', scope: 'community.manage', readOnly: false,
    description: 'Canal de avisos, modo lento e sobrescritas de permissao por cargo. Substitui as sobrescritas inteiras.',
    inputSchema: obj({
      channelId: id('Id do canal de texto.'),
      announcement: { type: 'boolean', description: 'true = so quem gerencia posta.' },
      slowModeSeconds: { type: 'integer', enum: [0, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 21600] },
      overrides: {
        type: 'array', maxItems: 21,
        items: obj({
          target: { type: 'string', description: '"everyone" ou id de cargo personalizado.' },
          viewChannel: { type: ['boolean', 'null'], description: 'true permite, false nega, null herda.' },
          sendMessages: { type: ['boolean', 'null'] },
        }, ['target', 'viewChannel', 'sendMessages']),
      },
    }, ['channelId', 'announcement', 'slowModeSeconds', 'overrides']),
    run: (a, ctx) => callApi(ctx, { method: 'PUT', url: `/api/channels/${enc(needId(a, 'channelId'))}/settings`, body: pick(a, ['announcement', 'slowModeSeconds', 'overrides']) }),
  },
  {
    name: 'create_category', title: 'Criar categoria', scope: 'community.manage', readOnly: false,
    description: 'Cria uma categoria de canais.',
    inputSchema: obj({ communityId: id('Id da comunidade.'), name: { type: 'string', minLength: 1, maxLength: 40 } }, ['communityId', 'name']),
    run: (a, ctx) => callApi(ctx, { method: 'POST', url: `/api/communities/${enc(needId(a, 'communityId'))}/categories`, body: pick(a, ['name']) }),
  },
  {
    name: 'rename_category', title: 'Renomear categoria', scope: 'community.manage', readOnly: false,
    description: 'Renomeia uma categoria de canais.',
    inputSchema: obj({ categoryId: id('Id da categoria.'), name: { type: 'string', minLength: 1, maxLength: 40 } }, ['categoryId', 'name']),
    run: (a, ctx) => callApi(ctx, { method: 'PATCH', url: `/api/community-categories/${enc(needId(a, 'categoryId'))}`, body: pick(a, ['name']) }),
  },
  {
    name: 'delete_category', title: 'Apagar categoria', scope: 'community.manage', readOnly: false,
    description: 'Apaga uma categoria; os canais dela ficam sem categoria.',
    inputSchema: obj({ categoryId: id('Id da categoria.') }, ['categoryId']),
    run: (a, ctx) => callApi(ctx, { method: 'DELETE', url: `/api/community-categories/${enc(needId(a, 'categoryId'))}` }),
  },
  {
    name: 'set_community_layout', title: 'Reordenar canais', scope: 'community.manage', readOnly: false,
    description: 'Define a ordem das categorias e de TODOS os canais (com a categoria de cada um). Lista incompleta e recusada; leia get_community antes.',
    inputSchema: obj({
      communityId: id('Id da comunidade.'),
      categories: { type: 'array', items: { type: 'string', format: 'uuid' } },
      channels: { type: 'array', items: obj({ id: { type: 'string', format: 'uuid' }, categoryId: { type: ['string', 'null'], format: 'uuid' } }, ['id', 'categoryId']) },
    }, ['communityId', 'categories', 'channels']),
    run: (a, ctx) => callApi(ctx, { method: 'PUT', url: `/api/communities/${enc(needId(a, 'communityId'))}/layout`, body: pick(a, ['categories', 'channels']) }),
  },
  {
    name: 'create_role', title: 'Criar cargo', scope: 'community.manage', readOnly: false,
    description: 'Cria um cargo personalizado (so o dono da comunidade).',
    inputSchema: obj({
      communityId: id('Id da comunidade.'),
      name: { type: 'string', minLength: 1, maxLength: 32 },
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'Cor hexadecimal, ex.: #5b6cff.' },
      permissions: obj({
        manageChannels: { type: 'boolean' }, manageInvites: { type: 'boolean' }, manageMessages: { type: 'boolean' }, kickMembers: { type: 'boolean' },
      }, ['manageChannels', 'manageInvites', 'manageMessages', 'kickMembers']),
    }, ['communityId', 'name', 'color', 'permissions']),
    run: (a, ctx) => callApi(ctx, { method: 'POST', url: `/api/communities/${enc(needId(a, 'communityId'))}/roles`, body: pick(a, ['name', 'color', 'permissions']) }),
  },
  {
    name: 'update_role', title: 'Editar cargo', scope: 'community.manage', readOnly: false,
    description: 'Altera nome, cor e permissoes de um cargo personalizado (so o dono).',
    inputSchema: obj({
      roleId: id('Id do cargo.'),
      name: { type: 'string', minLength: 1, maxLength: 32 },
      color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      permissions: obj({
        manageChannels: { type: 'boolean' }, manageInvites: { type: 'boolean' }, manageMessages: { type: 'boolean' }, kickMembers: { type: 'boolean' },
      }, ['manageChannels', 'manageInvites', 'manageMessages', 'kickMembers']),
    }, ['roleId', 'name', 'color', 'permissions']),
    run: (a, ctx) => callApi(ctx, { method: 'PATCH', url: `/api/community-roles/${enc(needId(a, 'roleId'))}`, body: pick(a, ['name', 'color', 'permissions']) }),
  },
  {
    name: 'delete_role', title: 'Apagar cargo', scope: 'community.manage', readOnly: false,
    description: 'Apaga um cargo personalizado (so o dono); quem o tinha fica sem cargo personalizado.',
    inputSchema: obj({ roleId: id('Id do cargo.') }, ['roleId']),
    run: (a, ctx) => callApi(ctx, { method: 'DELETE', url: `/api/community-roles/${enc(needId(a, 'roleId'))}` }),
  },
  {
    name: 'assign_role', title: 'Atribuir cargo', scope: 'community.manage', readOnly: false,
    description: 'Da ou tira o cargo personalizado de um membro (customRoleId null tira). So o dono.',
    inputSchema: obj({
      communityId: id('Id da comunidade.'),
      userId: { type: 'string', description: 'Id do membro (de get_community).' },
      customRoleId: { type: ['string', 'null'], format: 'uuid' },
    }, ['communityId', 'userId', 'customRoleId']),
    run: (a, ctx) => {
      const userId = typeof a.userId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(a.userId) ? a.userId : null;
      if (!userId) throw new ToolInputError('"userId" invalido.');
      return callApi(ctx, { method: 'PUT', url: `/api/communities/${enc(needId(a, 'communityId'))}/members/${enc(userId)}/custom-role`, body: pick(a, ['customRoleId']) });
    },
  },
  {
    name: 'set_welcome', title: 'Configurar boas-vindas', scope: 'community.manage', readOnly: false,
    description: 'Canal e texto de boas-vindas ({nome} vira o nome de quem entrou). channelId null desliga. Dono ou ADMIN.',
    inputSchema: obj({
      communityId: id('Id da comunidade.'),
      channelId: { type: ['string', 'null'], format: 'uuid', description: 'Canal de texto, ou null para desligar.' },
      message: { type: 'string', maxLength: 400, description: 'Modelo da mensagem; use {nome}.' },
    }, ['communityId', 'channelId', 'message']),
    run: (a, ctx) => callApi(ctx, { method: 'PUT', url: `/api/communities/${enc(needId(a, 'communityId'))}/welcome`, body: pick(a, ['channelId', 'message']) }),
  },

  // Chat de sala de voz (escopo room.chat): so enquanto o usuario esta na sala
  {
    name: 'list_my_voice_rooms', title: 'Salas em que estou', scope: 'room.chat', readOnly: true,
    description: 'Salas de voz em que o usuario esta conectado agora (o chat delas so funciona enquanto ele estiver dentro).',
    inputSchema: obj({}),
    run: async (_a, ctx) => {
      const ids = [...getRoomPeersSnapshot().keys()].filter((roomId) => isUserInRoom(roomId, ctx.principal.userId));
      if (!ids.length) return ok({ rooms: [] });
      const rooms = await prisma.room.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, isPersistent: true, communityId: true } });
      return ok({ rooms });
    },
  },
  {
    name: 'read_room_chat', title: 'Ler chat da sala', scope: 'room.chat', readOnly: true,
    description: 'Historico do chat de uma sala de voz em que o usuario esta agora.',
    inputSchema: obj({ roomId: id('Id da sala.') }, ['roomId']),
    run: async (a, ctx) => {
      const roomId = needId(a, 'roomId');
      if (!isUserInRoom(roomId, ctx.principal.userId)) return fail('Voce precisa estar nesta sala agora para ler o chat dela.');
      const ticket = signRoomTicket(roomId, `u:${ctx.principal.userId}`, 60);
      return callApi(ctx, { method: 'GET', url: `/api/rooms/${enc(roomId)}/messages`, headers: { [ROOM_TICKET_HEADER]: ticket } });
    },
  },
  {
    name: 'send_room_chat', title: 'Enviar no chat da sala', scope: 'room.chat', readOnly: false,
    description: 'Envia uma mensagem no chat de uma sala de voz em que o usuario esta agora, com o selo "via <app>". Passa pela moderacao.',
    inputSchema: obj({ roomId: id('Id da sala.'), content: { ...content, maxLength: 400 } }, ['roomId', 'content']),
    run: async (a, ctx) => {
      const roomId = needId(a, 'roomId');
      if (typeof a.content !== 'string') throw new ToolInputError('"content" precisa ser texto.');
      const text = a.content;
      const ack = await runAsApp(ctx.principal.appName, () => sendRoomChatAsUser(roomId, ctx.principal.userId, text));
      if (ack.success) return ok({ messageId: ack.messageId });
      if (ack.error === 'Not in room') return fail('Voce precisa estar nesta sala agora para enviar no chat dela.');
      if (ack.code === 'MODERATED') return fail('Mensagem bloqueada pela moderacao.');
      return fail(ack.error ?? 'Falha ao enviar.');
    },
  },
];

/* ─── API do modulo ───────────────────────────────────────────────────── */

export function listTools(scopes: McpScope[]) {
  return TOOLS.filter((t) => scopes.includes(t.scope)).map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: t.name.startsWith('delete_'), openWorldHint: false },
  }));
}

export async function callTool(name: string, args: Args, ctx: ToolContext): Promise<ToolResult | null> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return null;
  if (!ctx.principal.scopes.includes(tool.scope)) return fail(`Este app nao tem a permissao "${tool.scope}". Reconecte o app e autorize essa permissao.`);
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    if (err instanceof ToolInputError) return fail(err.message);
    throw err;
  }
}

/** Nomes do catalogo (testes). */
export const TOOL_NAMES = TOOLS.map((t) => t.name);
