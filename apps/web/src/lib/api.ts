import { z } from 'zod';
import type { CreateRoomInput, RoomResponse, RoomListItem, AuthResponse, LoginInput, RegisterInput, Metrics } from './validation';
import {
  communityAuditEntrySchema,
  communityBanSchema,
  memberTimeoutSchema,
  moderationReasonBodySchema,
  type TimeoutDuration,
  acceptCallResponseSchema,
  activeCallsSchema,
  adminModerationStateSchema,
  adminRoleAuditEntrySchema,
  adminUserRowSchema,
  adminUsersPageSchema,
  type AdminRoleAuditEntry,
  type AdminSource,
  type AdminUserRow,
  type AdminUsersPage,
  moderationAuditEntrySchema,
  moderationVerdictSchema,
  directMessageSchema,
  dmSendSchema,
  friendsListSchema,
  moderationConfigSchema,
  screenShareGateSchema,
  startCallResponseSchema,
  SCREEN_SHARE_CONSENT_VERSION,
  type ActiveCalls,
  type AdminModerationState,
  type AdminModerationUpdate,
  type DirectMessage,
  type ModerationAuditEntry,
  type ModerationVerdict,
  type FriendsList,
  type ModerationConfig,
  type ScreenShareGate,
} from '@scale/shared';
import { messageSearchQuerySchema, type MessageSearchQuery, type MessageSearchResponse } from '@scale/shared';
import { createRoomSchema, authResponseSchema, roomResponseSchema, roomListItemSchema, metricsSchema } from './validation';

import { communityCreateSchema, channelCreateSchema, channelUpdateSchema, communityMemberRoleSchema, communityInviteCreateSchema, communityInviteCodeSchema, channelMessageSendSchema, communityRoleSchema, channelKindSchema, communityPermissionsSchema, customRoleInputSchema, memberCustomRoleSchema, categoryInputSchema, communityLayoutSchema, type CustomRoleInput, type CommunityImageKind, type CommunityLayout } from '@scale/shared';
import { channelOverrideSchema, channelSettingsSchema, type ChannelSettings } from '@scale/shared';
import { channelReplySchema, channelReactionSummarySchema, channelReactionEventSchema, channelReactionToggleSchema, channelPinEventSchema, type ChannelReaction } from '@scale/shared';

const okSchema = z.object({ ok: z.literal(true) });
const communitySchema = z.object({ id: z.string(), name: z.string(), ownerId: z.string(), iconUpdatedAt: z.string().nullish(), bannerUpdatedAt: z.string().nullish() });
const categorySchema = z.object({ id: z.string(), name: z.string(), position: z.number() });
export type CommunityCategory = z.infer<typeof categorySchema>;
const channelSchema = z.object({ id: z.string(), name: z.string(), kind: channelKindSchema, position: z.number(), categoryId: z.string().nullish(), topic: z.string().nullish(), unread: z.number().int().min(0).optional(), announcement: z.boolean().optional(), slowModeSeconds: z.number().int().min(0).optional(), canSend: z.boolean().optional(), overrides: z.array(channelOverrideSchema).optional() });
const memberSchema = z.object({ userId: z.string(), name: z.string(), username: z.string().nullable(), role: communityRoleSchema, customRoleId: z.string().nullable().default(null), timeoutUntil: z.string().nullable().optional() });
const customRoleSchema = z.object({ id: z.string(), name: z.string(), color: z.string(), permissions: communityPermissionsSchema });
const noPermissions = { manageChannels: false, manageInvites: false, manageMessages: false, kickMembers: false };
export const channelMessageSchema = z.object({ id: z.string(), channelId: z.string(), author: z.object({ id: z.string().nullable(), name: z.string(), username: z.string().nullable() }), content: z.string(), createdAt: z.string(), editedAt: z.string().nullable(), deletedAt: z.string().nullable(), files: z.array(z.object({ id: z.string(), filename: z.string(), mime: z.string(), size: z.number() })).default([]), replyTo: channelReplySchema.nullable().default(null), reactions: z.array(channelReactionSummarySchema).default([]), pinnedAt: z.string().nullable().default(null), pinnedById: z.string().nullable().default(null) });
const messageSearchResponseSchema = z.object({ results: z.array(z.object({ id: z.string(), channelId: z.string(), channelName: z.string(), author: z.object({ id: z.string().nullable(), name: z.string(), username: z.string().nullable() }), content: z.string(), createdAt: z.string() })), nextCursor: z.string().nullable() });
const communityDetailSchema = z.object({ community: communitySchema, myRole: communityRoleSchema, myPermissions: communityPermissionsSchema.default(noPermissions), roles: z.array(customRoleSchema).default([]), categories: z.array(categorySchema).optional(), channels: z.array(channelSchema), members: z.array(memberSchema) });
export type CommunityCustomRole = z.infer<typeof customRoleSchema>;
const communityListSchema = z.object({ communities: z.array(z.object({ id: z.string(), name: z.string(), role: communityRoleSchema, iconUpdatedAt: z.string().nullish(), unread: z.number().int().min(0).optional() })) });
const inviteSchema = z.object({ id: z.string(), createdById: z.string(), expiresAt: z.string(), maxUses: z.number().nullable(), uses: z.number(), revokedAt: z.string().nullable(), createdAt: z.string() });
export type ChannelMessage = z.infer<typeof channelMessageSchema>;
export type CommunityDetail = z.infer<typeof communityDetailSchema>;
export type CommunityListItem = z.infer<typeof communityListSchema>['communities'][number];
export type CommunityInvite = z.infer<typeof inviteSchema>;

// Caminhos SEMPRE relativos (`/api/...`): em producao o Caddy serve o frontend
// estatico e encaminha `/api` ao backend no mesmo origin; em `next dev` o
// next.config.js reescreve `/api` para o backend no host. Nao ha SSR.
const BASE_URL = '';

export interface ApiError {
  error: string;
  details?: Record<string, string[]>;
  /** Campo invalido (400 do painel de administracao: `{ error, field }`). */
  field?: string;
  /** Detalhe legivel (502 `provider_error` do teste de moderacao; nunca traz a chave). */
  detail?: string;
  /** Modo lento (429 de canal): segundos ate poder enviar de novo. */
  retryAfterSeconds?: number;
  status: number;
}

// ─── Fetch retry (createRoom) ─────────────────────────────────
export const FETCH_RETRY_MAX_ATTEMPTS = 3;
const FETCH_RETRY_BACKOFF_MS = [500, 1000, 2000];

export interface RetryOptions {
  /** Called after a retryable failure, before the next attempt (1-based failed attempt). */
  onRetry?: (failedAttempt: number, maxAttempts: number) => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

/**
 * Fetch with retry: retries on network-level failures (e.g. "Failed to fetch",
 * TypeError thrown by fetch) and HTTP 5xx responses, with exponential backoff.
 * Non-retryable responses (4xx, 2xx, 3xx) are returned as-is so callers can
 * parse/validate them normally.
 */
export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  onRetry?: (failedAttempt: number, maxAttempts: number) => void,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRY_MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!isRetryableStatus(response.status)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
      if (attempt < FETCH_RETRY_MAX_ATTEMPTS) {
        onRetry?.(attempt, FETCH_RETRY_MAX_ATTEMPTS);
        await delay(FETCH_RETRY_BACKOFF_MS[attempt - 1]);
      }
    } catch (err) {
      // Network-level failures ("Failed to fetch") are retryable; anything else
      // (abort, unknown) is not.
      if (!(err instanceof TypeError)) throw err;
      lastError = err;
      if (attempt < FETCH_RETRY_MAX_ATTEMPTS) {
        onRetry?.(attempt, FETCH_RETRY_MAX_ATTEMPTS);
        await delay(FETCH_RETRY_BACKOFF_MS[attempt - 1]);
      }
    }
  }
  throw lastError;
}

export interface MeUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  /** ISO da ultima troca de foto; null = sem foto. */
  avatarUpdatedAt?: string | null;
  /** @nome unico; null = ainda nao escolheu (necessario para amizades). */
  username?: string | null;
  /**
   * Gate de partilha de tela (idade verificada + consentimento). Nunca traz a
   * data de nascimento. Ausente = servidor antigo (trata como nao liberado).
   */
  screenShare?: ScreenShareGate;
  /** Admin do sistema (`ADMIN_EMAILS`): ve o painel /admin/moderation. Ausente = nao. */
  isAdmin?: boolean;
  /** Origem do papel: 'env' = raiz (.env), 'db' = concedido, null = usuario comum. */
  adminSource?: AdminSource | null;
}

/** Evento `me:admin` (socket `user:<id>`): papel de admin mudou para esta conta. */
export const meAdminEventSchema = z.object({
  isAdmin: z.boolean(),
  adminSource: z.enum(['env', 'db']).nullable(),
});
export type MeAdminEvent = z.infer<typeof meAdminEventSchema>;

/** Aplica `me:admin` no usuario em memoria. */
export function applyMeAdmin(user: MeUser, event: MeAdminEvent): MeUser {
  return { ...user, isAdmin: event.isAdmin, adminSource: event.adminSource };
}

export interface AdminUsersParams {
  q?: string;
  filter?: 'all' | 'admins';
  cursor?: string | null;
  limit?: number;
}

/** Mensagem PT-BR para erros da gestao de administradores. */
export function adminRoleErrorMessage(err: unknown, fallback: string): string {
  const e = (typeof err === 'object' && err !== null ? err : {}) as Partial<ApiError>;
  if (e.status === 409 && e.error === 'env_admin') return 'Admin raiz: só pode ser removido no .env.';
  if (e.status === 400 && e.error === 'cannot_revoke_self') return 'Você não pode remover o seu próprio acesso.';
  if (e.status === 404) return 'Usuário não encontrado.';
  if (e.status === 403) return 'Somente administradores podem fazer isso.';
  if (e.status === 429) return 'Muitas alterações seguidas. Tente de novo em alguns minutos.';
  return fallback;
}

/** Gate quando o DTO nao trouxe o campo (ou convidado). */
export const GUEST_SCREEN_SHARE_GATE: ScreenShareGate = {
  ageVerified: false,
  isAdult: false,
  consentVersion: null,
  allowed: false,
  reason: 'guest',
};

/** Gate efetivo do `me`: convidado ou DTO sem o campo = nao liberado. */
export function screenShareGateOf(user: MeUser | null | undefined): ScreenShareGate {
  if (!user) return GUEST_SCREEN_SHARE_GATE;
  const parsed = screenShareGateSchema.safeParse(user.screenShare);
  return parsed.success ? parsed.data : { ...GUEST_SCREEN_SHARE_GATE, reason: 'age' };
}

/** URL do icone/banner da comunidade (so membros), com versao para furar cache. */
export function communityImageUrl(communityId: string, kind: CommunityImageKind, updatedAt: string | null | undefined): string | null {
  return updatedAt ? `/api/communities/${encodeURIComponent(communityId)}/${kind}?v=${encodeURIComponent(updatedAt)}` : null;
}

/** URL da propria foto, com versao para furar cache ao trocar. */
export function avatarUrl(avatarUpdatedAt: string | null | undefined): string | null {
  return avatarUpdatedAt ? `/api/me/avatar?v=${encodeURIComponent(avatarUpdatedAt)}` : null;
}

/** URL da foto de um amigo (ou a propria), com versao para furar cache. */
export function userAvatarUrl(userId: string, avatarUpdatedAt: string | null | undefined): string | null {
  return avatarUpdatedAt
    ? `/api/users/${encodeURIComponent(userId)}/avatar?v=${encodeURIComponent(avatarUpdatedAt)}`
    : null;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
    retry: RetryOptions = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const response = await fetchWithRetry(
      url,
      {
        ...options,
        headers,
        credentials: 'include', // send HttpOnly cookies
      },
      retry.onRetry,
    );

    // 204/205 (PUT/DELETE de privacidade) nao tem corpo. Nos demais, corpo
    // vazio ou invalido vira `{}`: o status decide se e erro.
    const body: { error?: string; details?: Record<string, string[]> } & Record<string, unknown> =
      response.status === 204 || response.status === 205
        ? {}
        : ((await response.json().catch(() => ({}))) as Record<string, unknown>);

    if (!response.ok) {
      const error: ApiError = {
        error: body.error || `HTTP ${response.status}`,
        details: body.details,
        field: typeof body.field === 'string' ? body.field : undefined,
        detail: typeof body.detail === 'string' ? body.detail : undefined,
        retryAfterSeconds: typeof body.retryAfterSeconds === 'number' ? body.retryAfterSeconds : undefined,
        status: response.status,
      };
      throw error;
    }

    return body as T;
  }

  // ─── Rooms ──────────────────────────────────────────────────
  async createRoom(input: CreateRoomInput, retry: RetryOptions = {}): Promise<RoomResponse> {
    const validated = createRoomSchema.parse(input);
    const data = await this.request<Record<string, unknown>>(
      '/api/rooms',
      {
        method: 'POST',
        body: JSON.stringify(validated),
      },
      retry,
    );
    return roomResponseSchema.parse(data);
  }

  async getRoom(id: string): Promise<RoomResponse> {
    const data = await this.request<Record<string, unknown>>(`/api/rooms/${id}`);
    return roomResponseSchema.parse(data);
  }

  async listRooms(): Promise<{ rooms: RoomListItem[] }> {
    const data = await this.request<{ rooms: unknown[] }>('/api/rooms');
    return { rooms: z.array(roomListItemSchema).parse(data.rooms) };
  }

  /**
   * Apaga a sala para sempre (dono ou admin do sistema). Corpo `{}` porque o
   * Fastify recusa JSON vazio com Content-Type application/json.
   */
  async deleteRoom(id: string): Promise<void> {
    await this.request<{ success: boolean }>(`/api/rooms/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: '{}',
    });
  }

  // ─── Auth ───────────────────────────────────────────────────
  /** Encerra a sessão: o servidor apaga o cookie HttpOnly (204, sem corpo). */
  async logout(): Promise<void> {
    const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const data = await this.request<Record<string, unknown>>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return authResponseSchema.parse(data);
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const data = await this.request<Record<string, unknown>>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return authResponseSchema.parse(data);
  }

  // ─── Ligacoes ───────────────────────────────────────────────
  /**
   * Liga para um amigo e faz a tela dele tocar. Sem `roomId` cria uma sala
   * privada nova; com `roomId` chama para a sala em que voce ja esta.
   */
  async startCall(friendId: string, roomId?: string): Promise<{ callId: string; roomId: string; expiresAt: string }> {
    const data = await this.request<unknown>('/api/calls', {
      method: 'POST',
      body: JSON.stringify(roomId ? { friendId, roomId } : { friendId }),
    });
    return startCallResponseSchema.parse(data);
  }

  /** Chamadas tocando agora (recebidas e feitas por esta conta). */
  async getActiveCalls(): Promise<ActiveCalls> {
    return activeCallsSchema.parse(await this.request<unknown>('/api/calls'));
  }

  async acceptCall(callId: string): Promise<{ roomId: string; inviteToken: string }> {
    const data = await this.request<unknown>(`/api/calls/${encodeURIComponent(callId)}/accept`, {
      method: 'POST',
      body: '{}',
    });
    return acceptCallResponseSchema.parse(data);
  }

  async declineCall(callId: string): Promise<void> {
    await this.request(`/api/calls/${encodeURIComponent(callId)}/decline`, { method: 'POST', body: '{}' });
  }

  async cancelCall(callId: string): Promise<void> {
    await this.request(`/api/calls/${encodeURIComponent(callId)}/cancel`, { method: 'POST', body: '{}' });
  }

  /** O @nome esta livre? (o servidor normaliza: "@Fulano" vira "fulano"). */
  async checkUsername(username: string): Promise<{ username: string; available: boolean }> {
    const data = await this.request<unknown>(
      `/api/auth/username-available?username=${encodeURIComponent(username)}`,
    );
    return z.object({ username: z.string(), available: z.boolean() }).parse(data);
  }

  /** Provedores de login externos ligados no servidor (o botao some quando desligado). */
  async getAuthProviders(): Promise<{ github: boolean; google: boolean }> {
    const data = await this.request<unknown>('/api/auth/providers');
    // `google` com default: servidor antigo (sem o campo) = desligado.
    return z.object({ github: z.boolean(), google: z.boolean().default(false) }).parse(data);
  }

  /** Contas de login externo vinculadas a conta logada. */
  async getLinkedAccounts(): Promise<{ github: { login: string } | null; google: boolean }> {
    const data = await this.request<unknown>('/api/me/links');
    return z
      .object({ github: z.object({ login: z.string() }).nullable(), google: z.boolean() })
      .parse(data);
  }

  async getMe(): Promise<{ user: MeUser }> {
    return this.request('/api/auth/me');
  }

  // ─── Perfil ─────────────────────────────────────────────────
  async updateProfile(input: { name: string }): Promise<{ user: MeUser }> {
    return this.request('/api/me', { method: 'PATCH', body: JSON.stringify(input) });
  }

  /** Multipart: sem Content-Type manual (o browser define o boundary). */
  async uploadAvatar(file: File): Promise<{ user: MeUser }> {
    const form = new FormData();
    form.append('avatar', file);
    const response = await fetch(`${this.baseUrl}/api/me/avatar`, {
      method: 'PUT',
      body: form,
      credentials: 'include',
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error: ApiError = { error: body.error || `HTTP ${response.status}`, status: response.status };
      throw error;
    }
    return body as { user: MeUser };
  }

  async deleteAvatar(): Promise<{ user: MeUser }> {
    return this.request('/api/me/avatar', { method: 'DELETE', body: '{}' });
  }

  async setUsername(username: string): Promise<{ user: MeUser }> {
    return this.request('/api/me/username', { method: 'PUT', body: JSON.stringify({ username }) });
  }

  // ─── Privacidade e gate de partilha de tela ─────────────────
  /** Data de nascimento (AAAA-MM-DD). O servidor so guarda e devolve booleanos. */
  async setBirthDate(birthDate: string): Promise<{ ageVerified: boolean; isAdult: boolean }> {
    const data = await this.request<unknown>('/api/me/age', {
      method: 'PUT',
      body: JSON.stringify({ birthDate }),
    });
    return z.object({ ageVerified: z.boolean(), isAdult: z.boolean() }).parse(data);
  }

  async deleteBirthDate(): Promise<void> {
    await this.request('/api/me/age', { method: 'DELETE', body: '{}' });
  }

  /** Aceita o termo de partilha de tela na versao atual do @scale/shared. */
  async giveScreenShareConsent(): Promise<void> {
    await this.request('/api/me/screen-share-consent', {
      method: 'PUT',
      body: JSON.stringify({ version: SCREEN_SHARE_CONSENT_VERSION }),
    });
  }

  async revokeScreenShareConsent(): Promise<void> {
    await this.request('/api/me/screen-share-consent', { method: 'DELETE', body: '{}' });
  }

  /** Exportacao LGPD: JSON bruto como Blob para o download "Baixar meus dados". */
  async exportPrivacyData(): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/api/me/privacy/export`, { credentials: 'include' });
    if (!res.ok) {
      const error: ApiError = { error: `HTTP ${res.status}`, status: res.status };
      throw error;
    }
    return res.blob();
  }

  /** Configuracao publica do assistente de moderacao. */
  async getModerationConfig(): Promise<ModerationConfig> {
    return moderationConfigSchema.parse(await this.request<unknown>('/api/moderation/config'));
  }

  /**
   * Amostra de tela do sharer (JPEG pequeno). Multipart; o veredito chega por
   * socket, a rota so responde 204. Ticket no header, nunca na URL.
   */
  async sendModerationFrame(roomId: string, frame: Blob, roomTicket: string): Promise<void> {
    const form = new FormData();
    form.append('frame', frame, 'frame.jpg');
    const res = await fetch(`${this.baseUrl}/api/rooms/${encodeURIComponent(roomId)}/moderation/frame`, {
      method: 'POST',
      body: form,
      credentials: 'include',
      headers: { 'X-Room-Ticket': roomTicket },
    });
    if (!res.ok) {
      const error: ApiError = { error: `HTTP ${res.status}`, status: res.status };
      throw error;
    }
  }

  // ─── Amizades e mensagens privadas ──────────────────────────
  async getFriends(): Promise<FriendsList> {
    return friendsListSchema.parse(await this.request('/api/friends'));
  }

  async sendFriendRequest(username: string): Promise<{ status: 'PENDING' | 'ACCEPTED' }> {
    return this.request('/api/friends/requests', { method: 'POST', body: JSON.stringify({ username }) });
  }

  async acceptFriendRequest(id: string): Promise<void> {
    await this.request(`/api/friends/requests/${encodeURIComponent(id)}/accept`, { method: 'POST', body: '{}' });
  }

  /** Recusa (recebido) ou cancela (enviado). */
  async deleteFriendRequest(id: string): Promise<void> {
    await this.request(`/api/friends/requests/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' });
  }

  async removeFriend(userId: string): Promise<void> {
    await this.request(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE', body: '{}' });
  }

  async getDirectMessages(userId: string, before?: string): Promise<{ messages: DirectMessage[]; hasMore: boolean }> {
    const qs = before ? `?before=${encodeURIComponent(before)}` : '';
    const data = await this.request<{ messages: unknown[]; hasMore: boolean }>(
      `/api/dm/${encodeURIComponent(userId)}/messages${qs}`,
    );
    return { messages: z.array(directMessageSchema).parse(data.messages), hasMore: data.hasMore === true };
  }

  async sendDirectMessage(userId: string, content: string): Promise<DirectMessage> {
    const data = await this.request<{ message: unknown }>(`/api/dm/${encodeURIComponent(userId)}/messages`, {
      method: 'POST',
      body: JSON.stringify(dmSendSchema.parse({ content })),
    });
    return directMessageSchema.parse(data.message);
  }

  // ─── Administracao da moderacao (so admin do sistema; 403 para os demais) ──
  async getAdminModeration(): Promise<AdminModerationState> {
    return adminModerationStateSchema.parse(await this.request<unknown>('/api/admin/moderation'));
  }

  /** Parcial: so os campos alterados; `null` = volta ao valor do .env. */
  async updateAdminModeration(update: AdminModerationUpdate): Promise<AdminModerationState> {
    const data = await this.request<unknown>('/api/admin/moderation', {
      method: 'PUT',
      body: JSON.stringify(update),
    });
    return adminModerationStateSchema.parse(data);
  }

  async deleteAdminModerationApiKey(): Promise<AdminModerationState> {
    const data = await this.request<unknown>('/api/admin/moderation/api-key', {
      method: 'DELETE',
      body: '{}',
    });
    return adminModerationStateSchema.parse(data);
  }

  /** Classifica um texto com o provedor efetivo sem gravar evento (valida chave/modelo). */
  async testAdminModeration(text: string): Promise<ModerationVerdict> {
    const data = await this.request<unknown>('/api/admin/moderation/test', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    return moderationVerdictSchema.parse(data);
  }

  async getAdminModerationAudit(limit = 50): Promise<{ entries: ModerationAuditEntry[] }> {
    const data = await this.request<{ entries: unknown[] }>(
      `/api/admin/moderation/audit?limit=${encodeURIComponent(String(limit))}`,
    );
    return { entries: z.array(moderationAuditEntrySchema).parse(data.entries) };
  }
  // ─── Comunidades ─────────────────────────────────────────────
  async listCommunities() { return communityListSchema.parse(await this.request('/api/communities')); }
  async getCommunity(id: string) { return communityDetailSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}`)); }
  async createCommunity(name: string) {
    return z.object({ community: communitySchema }).parse(await this.request('/api/communities', { method: 'POST', body: JSON.stringify(communityCreateSchema.parse({ name })) }));
  }
  async updateCommunity(id: string, name: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(communityCreateSchema.parse({ name })) })); }
  async deleteCommunity(id: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' })); }
  /** Nao lidas: marca um canal de texto (ou todos os da comunidade) como lido agora. */
  async markChannelRead(id: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' })); }
  async markCommunityRead(id: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' })); }
  async leaveCommunity(id: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/leave`, { method: 'POST', body: '{}' })); }
  async removeCommunityMember(id: string, userId: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE', body: '{}' })); }
  async updateCommunityMemberRole(id: string, userId: string, role: 'ADMIN' | 'MEMBER'): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(communityMemberRoleSchema.parse({ role })) })); }
  async createChannel(id: string, name: string, kind: 'TEXT' | 'VOICE') { return z.object({ channel: channelSchema }).parse(await this.request(`/api/communities/${encodeURIComponent(id)}/channels`, { method: 'POST', body: JSON.stringify(channelCreateSchema.parse({ name, kind })) })); }
  async updateChannel(id: string, name: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(channelUpdateSchema.parse({ name })) })); }
  async updateChannelTopic(id: string, topic: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(channelUpdateSchema.parse({ topic })) })); }
  /** Fase 3: aviso, modo lento e sobrescritas por cargo (substitui todas). */
  async saveChannelSettings(id: string, settings: ChannelSettings): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}/settings`, { method: 'PUT', body: JSON.stringify(channelSettingsSchema.parse(settings)) })); }
  async deleteChannel(id: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' })); }
  async searchCommunityMessages(communityId: string, input: MessageSearchQuery): Promise<MessageSearchResponse> {
    const parsed = messageSearchQuerySchema.parse(input);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed)) if (value !== undefined) query.set(key, value);
    return messageSearchResponseSchema.parse(await this.request(`/api/communities/${encodeURIComponent(communityId)}/search?${query.toString()}`));
  }
  async getChannelMessages(id: string, cursor?: string, limit?: number) {
    const query = new URLSearchParams(); if (cursor) query.set('cursor', cursor); if (limit !== undefined) query.set('limit', String(limit));
    const suffix = query.toString();
    return z.object({ messages: z.array(channelMessageSchema), nextCursor: z.string().nullable() }).parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages${suffix ? `?${suffix}` : ''}`));
  }
  async sendChannelMessage(id: string, content: string, replyToId?: string) { return z.object({ message: channelMessageSchema }).parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify(channelMessageSendSchema.parse(replyToId ? { content, replyToId } : { content })) })); }
  /** Reacao (conjunto fixo): alterna a minha; devolve quem reagiu com esse icone. */
  async toggleChannelReaction(id: string, messageId: string, reaction: ChannelReaction) { return channelReactionEventSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/reactions`, { method: 'POST', body: JSON.stringify(channelReactionToggleSchema.parse({ reaction })) })); }
  /** Fixar/desafixar (exige manageMessages). */
  async setChannelPin(id: string, messageId: string, pinned: boolean) { return channelPinEventSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}/pin`, { method: pinned ? 'PUT' : 'DELETE', body: '{}' })); }
  async getChannelPins(id: string) { return z.object({ messages: z.array(channelMessageSchema) }).parse(await this.request(`/api/channels/${encodeURIComponent(id)}/pins`)); }
  async editChannelMessage(id: string, messageId: string, content: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: JSON.stringify(channelMessageSendSchema.parse({ content })) })); }
  /** Imagens no canal: mesma rota de arquivos das salas (membro do canal de texto passa). */
  async uploadChannelImages(id: string, files: File[], content: string) {
    const form = new FormData();
    form.append('content', content);
    for (const file of files) form.append('file', file, file.name);
    const response = await fetch(`${this.baseUrl}/api/rooms/${encodeURIComponent(id)}/files`, { method: 'POST', body: form, credentials: 'include' });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const parsed = z.object({ error: z.string(), retryAfterSeconds: z.number().optional() }).safeParse(body).data;
      const error: ApiError = { error: parsed?.error ?? `HTTP ${response.status}`, retryAfterSeconds: parsed?.retryAfterSeconds, status: response.status };
      throw error;
    }
    return z.object({ message: channelMessageSchema }).parse(body);
  }
  /** Icone ou banner da comunidade (multipart, campo `image`). */
  async uploadCommunityImage(id: string, kind: CommunityImageKind, file: File): Promise<void> {
    const form = new FormData();
    form.append('image', file);
    const response = await fetch(`${this.baseUrl}/api/communities/${encodeURIComponent(id)}/${kind}`, { method: 'PUT', body: form, credentials: 'include' });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => ({}));
      const error: ApiError = { error: z.object({ error: z.string() }).safeParse(body).data?.error ?? `HTTP ${response.status}`, status: response.status };
      throw error;
    }
  }
  async deleteCommunityImage(id: string, kind: CommunityImageKind): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/${kind}`, { method: 'DELETE', body: '{}' })); }
  async createCategory(id: string, name: string): Promise<void> { await this.request(`/api/communities/${encodeURIComponent(id)}/categories`, { method: 'POST', body: JSON.stringify(categoryInputSchema.parse({ name })) }); }
  async renameCategory(categoryId: string, name: string): Promise<void> { okSchema.parse(await this.request(`/api/community-categories/${encodeURIComponent(categoryId)}`, { method: 'PATCH', body: JSON.stringify(categoryInputSchema.parse({ name })) })); }
  async deleteCategory(categoryId: string): Promise<void> { okSchema.parse(await this.request(`/api/community-categories/${encodeURIComponent(categoryId)}`, { method: 'DELETE', body: '{}' })); }
  /** Ordem completa: categorias e todos os canais (com categoria). 409 = lista desatualizada. */
  async saveCommunityLayout(id: string, layout: CommunityLayout): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/layout`, { method: 'PUT', body: JSON.stringify(communityLayoutSchema.parse(layout)) })); }
  fileUrl(fileId: string) { return `${this.baseUrl}/api/files/${encodeURIComponent(fileId)}`; }
  async deleteChannelMessage(id: string, messageId: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE', body: '{}' })); }
  async createCommunityInvite(id: string, input: { expiresIn?: '1h' | '24h' | '7d'; maxUses?: number }) { return z.object({ invite: z.object({ id: z.string(), code: z.string(), expiresAt: z.string(), maxUses: z.number().nullable() }) }).parse(await this.request(`/api/communities/${encodeURIComponent(id)}/invites`, { method: 'POST', body: JSON.stringify(communityInviteCreateSchema.parse(input)) })); }
  async listCommunityInvites(id: string) { return z.object({ invites: z.array(inviteSchema) }).parse(await this.request(`/api/communities/${encodeURIComponent(id)}/invites`)); }
  async createCommunityRole(id: string, input: CustomRoleInput): Promise<void> { await this.request(`/api/communities/${encodeURIComponent(id)}/roles`, { method: 'POST', body: JSON.stringify(customRoleInputSchema.parse(input)) }); }
  async updateCommunityRole(roleId: string, input: CustomRoleInput): Promise<void> { okSchema.parse(await this.request(`/api/community-roles/${encodeURIComponent(roleId)}`, { method: 'PATCH', body: JSON.stringify(customRoleInputSchema.parse(input)) })); }
  async deleteCommunityRole(roleId: string): Promise<void> { okSchema.parse(await this.request(`/api/community-roles/${encodeURIComponent(roleId)}`, { method: 'DELETE', body: '{}' })); }
  async setMemberCustomRole(id: string, userId: string, customRoleId: string | null): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/custom-role`, { method: 'PUT', body: JSON.stringify(memberCustomRoleSchema.parse({ customRoleId })) })); }
  // ─── Moderacao de comunidade (Fase 3) ──
  async timeoutCommunityMember(id: string, userId: string, duration: TimeoutDuration, reason?: string): Promise<void> { await this.request(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/timeout`, { method: 'PUT', body: JSON.stringify(memberTimeoutSchema.parse({ duration, reason })) }); }
  async clearCommunityTimeout(id: string, userId: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/timeout`, { method: 'DELETE', body: '{}' })); }
  async kickCommunityMember(id: string, userId: string, reason?: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}/kick`, { method: 'POST', body: JSON.stringify(moderationReasonBodySchema.parse({ reason })) })); }
  async banCommunityMember(id: string, userId: string, reason?: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/bans/${encodeURIComponent(userId)}`, { method: 'PUT', body: JSON.stringify(moderationReasonBodySchema.parse({ reason })) })); }
  async unbanCommunityMember(id: string, userId: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/bans/${encodeURIComponent(userId)}`, { method: 'DELETE', body: '{}' })); }
  async listCommunityBans(id: string) { return z.object({ bans: z.array(communityBanSchema) }).parse(await this.request(`/api/communities/${encodeURIComponent(id)}/bans`)); }
  async getCommunityAudit(id: string, cursor?: string) { const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''; return z.object({ entries: z.array(communityAuditEntrySchema), nextCursor: z.string().nullable() }).parse(await this.request(`/api/communities/${encodeURIComponent(id)}/audit${qs}`)); }
  async revokeCommunityInvite(id: string): Promise<void> { okSchema.parse(await this.request(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' })); }
  async previewCommunityInvite(code: string) { return z.object({ community: z.object({ id: z.string(), name: z.string(), memberCount: z.number() }), alreadyMember: z.boolean() }).parse(await this.request('/api/invites/preview', { method: 'POST', body: JSON.stringify(communityInviteCodeSchema.parse({ code })) })); }
  async acceptCommunityInvite(code: string) { return z.object({ communityId: z.string() }).parse(await this.request('/api/invites/accept', { method: 'POST', body: JSON.stringify(communityInviteCodeSchema.parse({ code })) })); }

  // ─── Gestao de administradores (so admin; 403 para os demais) ──
  async getAdminUsers(params: AdminUsersParams = {}): Promise<AdminUsersPage> {
    const qs = new URLSearchParams();
    const q = params.q?.trim();
    if (q) qs.set('q', q);
    qs.set('filter', params.filter ?? 'all');
    if (params.cursor) qs.set('cursor', params.cursor);
    qs.set('limit', String(params.limit ?? 25));
    return adminUsersPageSchema.parse(await this.request<unknown>(`/api/admin/users?${qs.toString()}`));
  }

  async grantAdmin(userId: string): Promise<AdminUserRow> {
    const data = await this.request<unknown>(`/api/admin/users/${encodeURIComponent(userId)}/admin`, {
      method: 'PUT',
      body: '{}',
    });
    return adminUserRowSchema.parse(data);
  }

  /** 409 `env_admin` (raiz) e 400 `cannot_revoke_self`: ver `adminRoleErrorMessage`. */
  async revokeAdmin(userId: string): Promise<AdminUserRow> {
    const data = await this.request<unknown>(`/api/admin/users/${encodeURIComponent(userId)}/admin`, {
      method: 'DELETE',
      body: '{}',
    });
    return adminUserRowSchema.parse(data);
  }

  async getAdminRoleAudit(limit = 50): Promise<{ entries: AdminRoleAuditEntry[] }> {
    const data = await this.request<{ entries: unknown[] }>(
      `/api/admin/users/audit?limit=${encodeURIComponent(String(limit))}`,
    );
    return { entries: z.array(adminRoleAuditEntrySchema).parse(data.entries) };
  }

  // ─── Health ─────────────────────────────────────────────────
  async health(): Promise<{ status: string; timestamp: string }> {
    return this.request('/api/health');
  }

  // ─── Metrics ────────────────────────────────────────────────
  async getMetrics(): Promise<Metrics> {
    const data = await this.request<Record<string, unknown>>('/api/metrics');
    return metricsSchema.parse(data);
  }
}

export const api = new ApiClient(BASE_URL);
