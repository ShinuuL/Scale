import { z } from 'zod';
import type { CreateRoomInput, RoomResponse, RoomListItem, AuthResponse, LoginInput, RegisterInput, Metrics } from './validation';
import { directMessageSchema, dmSendSchema, friendsListSchema, type DirectMessage, type FriendsList } from '@scale/shared';
import { createRoomSchema, authResponseSchema, roomResponseSchema, roomListItemSchema, metricsSchema } from './validation';

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

  /** Provedores de login externos ligados no servidor (o botao some quando desligado). */
  async getAuthProviders(): Promise<{ github: boolean }> {
    const data = await this.request<unknown>('/api/auth/providers');
    return z.object({ github: z.boolean() }).parse(data);
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
