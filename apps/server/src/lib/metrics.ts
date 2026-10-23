const startedAt = Date.now();

export interface MemoryUsage {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
}

export function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startedAt) / 1000);
}

export function getMemoryUsage(): MemoryUsage {
  const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
  return { rss, heapTotal, heapUsed, external };
}

export function getVersion(): string {
  // npm_package_version é definido quando rodando via npm scripts;
  // em Docker (node dist/server.js) usa o fallback do package.json.
  return process.env.npm_package_version ?? '0.1.0';
}

// --- Chat metrics (scale_chat_*) — contadores de observabilidade ---

let chatMessagesPersistent = 0;
let chatMessagesTemporary = 0;
let chatEdits = 0;
let chatDeletes = 0;
let chatFilesBytes = 0;
let chatQuotaExceeded = 0;

export interface ChatMetricsSnapshot {
  messagesPersistent: number;
  messagesTemporary: number;
  edits: number;
  deletes: number;
  filesBytes: number;
  quotaExceeded: number;
}

export function incChatMessages(roomType: 'persistent' | 'temporary'): void {
  if (roomType === 'persistent') {
    chatMessagesPersistent += 1;
  } else {
    chatMessagesTemporary += 1;
  }
}

export function incChatEdits(): void {
  chatEdits += 1;
}

export function incChatDeletes(): void {
  chatDeletes += 1;
}

export function addChatFilesBytes(bytes: number): void {
  chatFilesBytes += bytes;
}

export function incQuotaExceeded(): void {
  chatQuotaExceeded += 1;
}

export function getChatMetricsSnapshot(): ChatMetricsSnapshot {
  return {
    messagesPersistent: chatMessagesPersistent,
    messagesTemporary: chatMessagesTemporary,
    edits: chatEdits,
    deletes: chatDeletes,
    filesBytes: chatFilesBytes,
    quotaExceeded: chatQuotaExceeded,
  };
}

export function getChatMetricsText(): string {
  return [
    `scale_chat_messages_total{room_type="persistent"} ${chatMessagesPersistent}`,
    `scale_chat_messages_total{room_type="temporary"} ${chatMessagesTemporary}`,
    `scale_chat_edits_total ${chatEdits}`,
    `scale_chat_deletes_total ${chatDeletes}`,
    `scale_chat_files_bytes_total ${chatFilesBytes}`,
    `scale_chat_quota_exceeded_total ${chatQuotaExceeded}`,
  ].join('\n');
}