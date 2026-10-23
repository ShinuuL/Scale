import { z } from 'zod';
import type { CreateRoomInput, RoomResponse, RoomListItem, AuthResponse, LoginInput, RegisterInput, Metrics } from './validation';
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

  async getMe(): Promise<{ user: { id: string; email: string; name: string; createdAt: string } }> {
    return this.request('/api/auth/me');
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
