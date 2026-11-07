import { isRateLimitExempt } from './clientIp.js';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * Resultado de um balde: além de bloquear ou não, devolve quantos segundos
 * faltam para a janela reabrir — é o que alimenta o header `Retry-After`.
 */
export interface RateLimitResult {
  limited: boolean;
  retryAfterSeconds: number;
}

const NOT_LIMITED: RateLimitResult = { limited: false, retryAfterSeconds: 0 };

/**
 * Registro de TODOS os baldes (nome + store).
 *
 * Necessário desde que as chaves passaram a ser parcialmente controladas pelo
 * cliente (IP/email por requisição): uma entrada por chave sem expurgo cresce
 * sem limite. O expurgo (`sweepExpiredEntries`) varre este registro e derruba
 * toda entrada cuja janela já expirou — uma entrada só vive enquanto a janela
 * está viva.
 */
const registeredBuckets: Array<{ name: string; store: Map<string, RateLimitEntry> }> = [];

/** Cria um store e o registra para o expurgo periódico. */
function createBucket(name: string): Map<string, RateLimitEntry> {
  const store = new Map<string, RateLimitEntry>();
  registeredBuckets.push({ name, store });
  return store;
}

/**
 * Expurgo único: remove de TODOS os baldes as entradas cuja janela expirou.
 *
 * Chamado periodicamente (ver SWEEP_INTERVAL_MS) e também de forma preguiçosa
 * no caminho quente (ver throttledSweep). É O(nº de chaves vivas), barato.
 *
 * @param now instante de referência (default: agora) — os testes usam um
 *            instante futuro para simular janelas expiradas.
 * @returns quantas entradas foram removidas.
 */
export function sweepExpiredEntries(now: number = Date.now()): number {
  let removed = 0;
  for (const { store } of registeredBuckets) {
    for (const [key, entry] of store) {
      if (now > entry.resetAt) {
        store.delete(key);
        removed += 1;
      }
    }
  }
  return removed;
}

/**
 * Tamanho de cada balde registrado — usado pelos testes para provar que o
 * expurgo esvazia as janelas mortas.
 */
export function rateLimitStoreSizes(): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const { name, store } of registeredBuckets) {
    sizes[name] = store.size;
  }
  return sizes;
}

/**
 * Motor dos baldes novos: conta a requisição na janela e responde se estourou.
 * Usado pelos limites por IP/email de auth, upload e TURN.
 */
function take(
  store: Map<string, RateLimitEntry>,
  key: string,
  windowMs: number,
  max: number,
): RateLimitResult {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return NOT_LIMITED;
  }

  entry.count++;

  if (entry.count > max) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }

  return NOT_LIMITED;
}

/**
 * Balde por IP. Requisições de loopback NÃO são contadas fora de produção
 * (dev/E2E/proxy local do Next — ver lib/clientIp.ts isRateLimitExempt); em
 * produção o balde vale sempre, inclusive atrás de um túnel no mesmo host, onde
 * todos os requests chegam como 127.0.0.1.
 */
function ipBucket(
  store: Map<string, RateLimitEntry>,
  ip: string,
  windowMs: number,
  max: number,
): RateLimitResult {
  if (isRateLimitExempt(ip)) return NOT_LIMITED;
  return take(store, ip, windowMs, max);
}

/** Zera o balde (ex.: login bem-sucedido libera o usuário). */
function reset(store: Map<string, RateLimitEntry>, key: string): void {
  store.delete(key);
}

const store = createBucket('signal');

const CLEANUP_INTERVAL_MS = 60_000;
const WINDOW_MS = 1000; // 1 second
const MAX_REQUESTS = 30;

let lastCleanup = Date.now();

/** Expurgo preguiçoso (no máximo 1x por minuto) no caminho quente. */
function throttledSweep(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  sweepExpiredEntries(now);
}

/**
 * Expurgo periódico de todos os baldes. `unref()` para o timer não segurar o
 * processo (dev/scripts/testes) vivo após o trabalho terminar.
 */
const sweepTimer = setInterval(() => sweepExpiredEntries(), CLEANUP_INTERVAL_MS);
sweepTimer.unref();

function cleanup(): void {
  throttledSweep();
}

export function isRateLimited(key: string): boolean {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    return true;
  }

  return false;
}

export function resetRateLimit(key: string): void {
  store.delete(key);
}

// --- Chat rate limit (janela isolada 5 msgs / 5s — não colide com 30/s de signal) ---

const CHAT_WINDOW_MS = 5_000;
const CHAT_MAX = 5;
const chatStore = createBucket('chat');

export function isChatRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = chatStore.get(key);

  if (!entry || now > entry.resetAt) {
    chatStore.set(key, { count: 1, resetAt: now + CHAT_WINDOW_MS });
    return false;
  }

  entry.count++;

  if (entry.count > CHAT_MAX) {
    return true;
  }

  return false;
}

export function resetChatRateLimit(key: string): void {
  chatStore.delete(key);
}

// --- Criacao de salas (janela isolada 10 salas / 5s por IP) ---
// POST /api/rooms grava uma sala (e um uuid) no SQLite a cada chamada. Sem
// limite, um cliente automatico enche o banco e a listagem publica de salas.

const ROOM_CREATE_WINDOW_MS = 5_000;
const ROOM_CREATE_MAX = 10;
const roomCreateStore = createBucket('roomCreate');

export function isRoomCreateRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = roomCreateStore.get(key);

  if (!entry || now > entry.resetAt) {
    roomCreateStore.set(key, { count: 1, resetAt: now + ROOM_CREATE_WINDOW_MS });
    return false;
  }

  entry.count++;

  if (entry.count > ROOM_CREATE_MAX) {
    return true;
  }

  return false;
}

export function resetRoomCreateRateLimit(key: string): void {
  roomCreateStore.delete(key);
}

// --- Autenticacao (Etapa 4) ----------------------------------------------
// O app deixou de ser "Tailnet only" e passou a ser alcancavel por tunel
// publico: /api/auth/{login,register,refresh} ficam expostos a credential
// stuffing e a criacao em massa de contas. Cada balde tem sua janela e o par
// isX/resetX (reset usado no login bem-sucedido). Os baldes por IP ignoram
// loopback apenas FORA de producao (ver ipBucket e lib/clientIp.ts
// isRateLimitExempt) — quem valida os 429 nos testes usa um IP publico
// explicito ou roda com NODE_ENV=production.

// Login: 10 tentativas / 5 min por IP. Segura o flood de um unico host.
const LOGIN_IP_WINDOW_MS = 5 * 60_000;
const LOGIN_IP_MAX = 10;
const loginIpStore = createBucket('loginIp');

export function isLoginRateLimited(ip: string): RateLimitResult {
  return ipBucket(loginIpStore, ip, LOGIN_IP_WINDOW_MS, LOGIN_IP_MAX);
}

export function resetLoginRateLimit(ip: string): void {
  reset(loginIpStore, ip);
}

// Login: 10 tentativas / 5 min por email normalizado. E o balde que barra o
// credential stuffing distribuido (mesma conta, varios IPs).
const LOGIN_EMAIL_WINDOW_MS = 5 * 60_000;
const LOGIN_EMAIL_MAX = 10;
const loginEmailStore = createBucket('loginEmail');

export function isLoginEmailRateLimited(email: string): RateLimitResult {
  return take(loginEmailStore, email, LOGIN_EMAIL_WINDOW_MS, LOGIN_EMAIL_MAX);
}

export function resetLoginEmailRateLimit(email: string): void {
  reset(loginEmailStore, email);
}

// Cadastro: 5 contas / hora por IP. Sem isto um script enche o SQLite de
// usuarios. Nao resetamos no sucesso: cada cadastro criado E o abuso.
const REGISTER_WINDOW_MS = 60 * 60_000;
const REGISTER_MAX = 5;
const registerStore = createBucket('register');

export function isRegisterRateLimited(ip: string): RateLimitResult {
  return ipBucket(registerStore, ip, REGISTER_WINDOW_MS, REGISTER_MAX);
}

export function resetRegisterRateLimit(ip: string): void {
  reset(registerStore, ip);
}

// Refresh: 30 / 5 min por IP. Assina um novo JWT (custo de CPU) a cada chamada.
const REFRESH_WINDOW_MS = 5 * 60_000;
const REFRESH_MAX = 30;
const refreshStore = createBucket('refresh');

export function isRefreshRateLimited(ip: string): RateLimitResult {
  return ipBucket(refreshStore, ip, REFRESH_WINDOW_MS, REFRESH_MAX);
}

export function resetRefreshRateLimit(ip: string): void {
  reset(refreshStore, ip);
}

// Checagem de @nome livre no cadastro: 60 / min por IP. O formulario consulta
// enquanto a pessoa digita (com atraso), entao o teto e folgado; so barra a
// varredura em massa de nomes.
const USERNAME_CHECK_WINDOW_MS = 60_000;
const USERNAME_CHECK_MAX = 60;
const usernameCheckStore = createBucket('usernameCheck');

export function isUsernameCheckRateLimited(ip: string): RateLimitResult {
  return ipBucket(usernameCheckStore, ip, USERNAME_CHECK_WINDOW_MS, USERNAME_CHECK_MAX);
}

// Login com GitHub: 20 / 10 min por IP, somando inicio e callback. Cada
// callback faz duas chamadas HTTP ao GitHub; o balde segura o abuso disso.
const GITHUB_OAUTH_WINDOW_MS = 10 * 60_000;
const GITHUB_OAUTH_MAX = 20;
const githubOAuthStore = createBucket('githubOAuth');

export function isGithubOAuthRateLimited(ip: string): RateLimitResult {
  return ipBucket(githubOAuthStore, ip, GITHUB_OAUTH_WINDOW_MS, GITHUB_OAUTH_MAX);
}

export function resetGithubOAuthRateLimit(ip: string): void {
  reset(githubOAuthStore, ip);
}

// Upload de arquivos: 30 / min por IP. Cada upload grava bytes no disco e no
// SQLite; o balde fica ANTES de bufferizar o multipart.
const UPLOAD_WINDOW_MS = 60_000;
const UPLOAD_MAX = 30;
const uploadStore = createBucket('upload');

export function isFileUploadRateLimited(ip: string): RateLimitResult {
  return ipBucket(uploadStore, ip, UPLOAD_WINDOW_MS, UPLOAD_MAX);
}

export function resetFileUploadRateLimit(ip: string): void {
  reset(uploadStore, ip);
}

// Perfil (nome e foto): 20 / 10 min por USUARIO (chave = userId). A rota exige
// login; a foto grava ate 32 MB no disco por chamada.
const PROFILE_WINDOW_MS = 10 * 60_000;
const PROFILE_MAX = 20;
const profileStore = createBucket('profile');

export function isProfileUpdateRateLimited(userId: string): RateLimitResult {
  return take(profileStore, userId, PROFILE_WINDOW_MS, PROFILE_MAX);
}

export function resetProfileUpdateRateLimit(userId: string): void {
  reset(profileStore, userId);
}

// Ligacoes: 15 / 5 min por USUARIO. Cada uma cria uma sala e faz o celular
// do amigo tocar; o teto barra o "trote" em sequencia.
const CALL_WINDOW_MS = 5 * 60_000;
const CALL_MAX = 15;
const callStore = createBucket('call');

export function isCallRateLimited(userId: string): RateLimitResult {
  return take(callStore, userId, CALL_WINDOW_MS, CALL_MAX);
}

export function resetCallRateLimit(userId: string): void {
  reset(callStore, userId);
}

// Pedidos de amizade: 30 / hora por USUARIO. Freia a varredura de @nomes
// (o pedido revela se o nome existe).
const FRIEND_REQUEST_WINDOW_MS = 60 * 60_000;
const FRIEND_REQUEST_MAX = 30;
const friendRequestStore = createBucket('friendRequest');

export function isFriendRequestRateLimited(userId: string): RateLimitResult {
  return take(friendRequestStore, userId, FRIEND_REQUEST_WINDOW_MS, FRIEND_REQUEST_MAX);
}

export function resetFriendRequestRateLimit(userId: string): void {
  reset(friendRequestStore, userId);
}

// Mensagens privadas: 20 / 10 s por USUARIO (mesma ordem do chat de sala).
const DM_WINDOW_MS = 10_000;
const DM_MAX = 20;
const dmStore = createBucket('dm');

export function isDirectMessageRateLimited(userId: string): RateLimitResult {
  return take(dmStore, userId, DM_WINDOW_MS, DM_MAX);
}

export function resetDirectMessageRateLimit(userId: string): void {
  reset(dmStore, userId);
}

// Exclusao de sala: 20 / 10 min por USUARIO (chave = userId). A rota exige
// login, entao o balde nao depende de IP; sem isencao de loopback.
const ROOM_DELETE_WINDOW_MS = 10 * 60_000;
const ROOM_DELETE_MAX = 20;
const roomDeleteStore = createBucket('roomDelete');

export function isRoomDeleteRateLimited(userId: string): RateLimitResult {
  return take(roomDeleteStore, userId, ROOM_DELETE_WINDOW_MS, ROOM_DELETE_MAX);
}

export function resetRoomDeleteRateLimit(userId: string): void {
  reset(roomDeleteStore, userId);
}

// Credenciais TURN: 30 / min por IP. Hoje ENABLE_TURN=false (so STUN), mas
// quando ligado o endpoint entrega credenciais do coturn.
const TURN_WINDOW_MS = 60_000;
const TURN_MAX = 30;
const turnStore = createBucket('turn');

export function isTurnRateLimited(ip: string): RateLimitResult {
  return ipBucket(turnStore, ip, TURN_WINDOW_MS, TURN_MAX);
}

export function resetTurnRateLimit(ip: string): void {
  reset(turnStore, ip);
}

// Falhas de credencial de sala (senha/convite): 10 falhas / 15 min por
// IP+roomId. So FALHAS contam (acesso concedido nao consome o balde) e nao ha
// isencao de loopback: e um limite contra brute force da senha da sala, nao de
// volume. Usado em GET /api/rooms/:id/messages, GET /api/files/:id, upload e
// join-room.
const ROOM_AUTH_WINDOW_MS = 15 * 60_000;
const ROOM_AUTH_MAX = 10;
const roomAuthStore = createBucket('roomAuthFail');

function roomAuthKey(ip: string, roomId: string): string {
  return `${ip}|${roomId}`;
}

/** Bloqueado? (nao conta tentativa — so le o balde). */
export function isRoomAuthLocked(ip: string, roomId: string): RateLimitResult {
  const entry = roomAuthStore.get(roomAuthKey(ip, roomId));
  const now = Date.now();
  if (!entry || now > entry.resetAt || entry.count < ROOM_AUTH_MAX) return NOT_LIMITED;
  return {
    limited: true,
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  };
}

/** Registra uma falha de credencial de sala. */
export function recordRoomAuthFailure(ip: string, roomId: string): void {
  take(roomAuthStore, roomAuthKey(ip, roomId), ROOM_AUTH_WINDOW_MS, ROOM_AUTH_MAX);
}

export function resetRoomAuthFailures(ip: string, roomId: string): void {
  reset(roomAuthStore, roomAuthKey(ip, roomId));
}
