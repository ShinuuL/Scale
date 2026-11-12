import { z } from 'zod';
import type { CreateRoomInput, RoomResponse, RoomListItem, AuthResponse, LoginInput, RegisterInput, Metrics } from './validation';
import {
  acceptCallResponseSchema,
  activeCallsSchema,
  directMessageSchema,
  dmSendSchema,
  friendsListSchema,
  startCallResponseSchema,
  type ActiveCalls,
  type DirectMessage,
  type FriendsList,
} from '@scale/shared';
import { createRoomSchema, authResponseSchema, roomResponseSchema, roomListItemSchema, metricsSchema } from './validation';

import { communityCreateSchema, channelCreateSchema, channelUpdateSchema, communityMemberRoleSchema, communityInviteCreateSchema, communityInviteCodeSchema, channelMessageSendSchema, communityRoleSchema, channelKindSchema } from '@scale/shared';

const okSchema = z.object({ ok: z.literal(true) });
const communitySchema = z.object({ id: z.string(), name: z.string(), ownerId: z.string() });
const channelSchema = z.object({ id: z.string(), name: z.string(), kind: channelKindSchema, position: z.number() });
const memberSchema = z.object({ userId: z.string(), name: z.string(), username: z.string().nullable(), role: communityRoleSchema });
export const channelMessageSchema = z.object({ id: z.string(), channelId: z.string(), author: z.object({ id: z.string().nullable(), name: z.string(), username: z.string().nullable() }), content: z.string(), createdAt: z.string(), editedAt: z.string().nullable(), deletedAt: z.string().nullable(), files: z.array(z.object({ id: z.string(), filename: z.string(), mime: z.string(), size: z.number() })).default([]) });
const communityDetailSchema = z.object({ community: communitySchema, myRole: communityRoleSchema, channels: z.array(channelSchema), members: z.array(memberSchema) });
const communityListSchema = z.object({ communities: z.array(z.object({ id: z.string(), name: z.string(), role: communityRoleSchema })) });
const inviteSchema = z.object({ id: z.string(), createdById: z.string(), expiresAt: z.string(), maxUses: z.number().nullable(), uses: z.number(), revokedAt: z.string().nullable(), createdAt: z.string() });
export type ChannelMessage = z.infer<typeof channelMessageSchema>;
export type CommunityDetail = z.infer<typeof communityDetailSchema>;
export type CommunityListItem = z.infer<typeof communityListSchema>['communities'][number];
export type CommunityInvite = z.infer<typeof inviteSchema>;

// Caminhos SEMPRE relativos (`/api/...`): em producao o Caddy serve o frontend
// estatico e encaminha `/api` ao backend no mesmo origin; em `next dev` o
// next.config.js reescreve `/api` para o backend no host. Nao ha SSR.
const BASE_URL = '';

interface ApiError {
  error: string;
  details?: Record<string, string[]>;
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

    const body = await response.json();

    if (!response.ok) {
      const error: ApiError = {
        error: body.error || `HTTP ${response.status}`,
        details: body.details,
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

  // ─── Comunidades ─────────────────────────────────────────────
  async listCommunities() { return communityListSchema.parse(await this.request('/api/communities')); }
  async getCommunity(id: string) { return communityDetailSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}`)); }
  async createCommunity(name: string) {
    return z.object({ community: communitySchema }).parse(await this.request('/api/communities', { method: 'POST', body: JSON.stringify(communityCreateSchema.parse({ name })) }));
  }
  async updateCommunity(id: string, name: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(communityCreateSchema.parse({ name })) })); }
  async deleteCommunity(id: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' })); }
  async leaveCommunity(id: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/leave`, { method: 'POST', body: '{}' })); }
  async removeCommunityMember(id: string, userId: string): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE', body: '{}' })); }
  async updateCommunityMemberRole(id: string, userId: string, role: 'ADMIN' | 'MEMBER'): Promise<void> { okSchema.parse(await this.request(`/api/communities/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(communityMemberRoleSchema.parse({ role })) })); }
  async createChannel(id: string, name: string, kind: 'TEXT' | 'VOICE') { return z.object({ channel: channelSchema }).parse(await this.request(`/api/communities/${encodeURIComponent(id)}/channels`, { method: 'POST', body: JSON.stringify(channelCreateSchema.parse({ name, kind })) })); }
  async updateChannel(id: string, name: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(channelUpdateSchema.parse({ name })) })); }
  async deleteChannel(id: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' })); }
  async getChannelMessages(id: string, cursor?: string, limit?: number) {
    const query = new URLSearchParams(); if (cursor) query.set('cursor', cursor); if (limit !== undefined) query.set('limit', String(limit));
    const suffix = query.toString();
    return z.object({ messages: z.array(channelMessageSchema), nextCursor: z.string().nullable() }).parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages${suffix ? `?${suffix}` : ''}`));
  }
  async sendChannelMessage(id: string, content: string) { return z.object({ message: channelMessageSchema }).parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify(channelMessageSendSchema.parse({ content })) })); }
  async editChannelMessage(id: string, messageId: string, content: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: JSON.stringify(channelMessageSendSchema.parse({ content })) })); }
  /** Imagens no canal: mesma rota de arquivos das salas (membro do canal de texto passa). */
  async uploadChannelImages(id: string, files: File[], content: string) {
    const form = new FormData();
    form.append('content', content);
    for (const file of files) form.append('file', file, file.name);
    const response = await fetch(`${this.baseUrl}/api/rooms/${encodeURIComponent(id)}/files`, { method: 'POST', body: form, credentials: 'include' });
    const body: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error: ApiError = { error: z.object({ error: z.string() }).safeParse(body).data?.error ?? `HTTP ${response.status}`, status: response.status };
      throw error;
    }
    return z.object({ message: channelMessageSchema }).parse(body);
  }
  fileUrl(fileId: string) { return `${this.baseUrl}/api/files/${encodeURIComponent(fileId)}`; }
  async deleteChannelMessage(id: string, messageId: string): Promise<void> { okSchema.parse(await this.request(`/api/channels/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE', body: '{}' })); }
  async createCommunityInvite(id: string, input: { expiresIn?: '1h' | '24h' | '7d'; maxUses?: number }) { return z.object({ invite: z.object({ id: z.string(), code: z.string(), expiresAt: z.string(), maxUses: z.number().nullable() }) }).parse(await this.request(`/api/communities/${encodeURIComponent(id)}/invites`, { method: 'POST', body: JSON.stringify(communityInviteCreateSchema.parse(input)) })); }
  async listCommunityInvites(id: string) { return z.object({ invites: z.array(inviteSchema) }).parse(await this.request(`/api/communities/${encodeURIComponent(id)}/invites`)); }
  async revokeCommunityInvite(id: string): Promise<void> { okSchema.parse(await this.request(`/api/invites/${encodeURIComponent(id)}`, { method: 'DELETE', body: '{}' })); }
  async previewCommunityInvite(code: string) { return z.object({ community: z.object({ id: z.string(), name: z.string(), memberCount: z.number() }), alreadyMember: z.boolean() }).parse(await this.request('/api/invites/preview', { method: 'POST', body: JSON.stringify(communityInviteCodeSchema.parse({ code })) })); }
  async acceptCommunityInvite(code: string) { return z.object({ communityId: z.string() }).parse(await this.request('/api/invites/accept', { method: 'POST', body: JSON.stringify(communityInviteCodeSchema.parse({ code })) })); }

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
