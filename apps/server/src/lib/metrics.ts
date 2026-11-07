import { monitorEventLoopDelay } from 'node:perf_hooks';
import { statfs } from 'node:fs/promises';
import { UPLOADS_ROOT } from './uploads.js';

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
// Histograma agregado, sem caminhos/identidades. Timer interno nao segura processo.
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
const loopReset = setInterval(() => { loopDelay.reset(); }, 60_000);
loopReset.unref();

export async function getResourceMetrics() {
  const cpu = process.cpuUsage();
  let disk: { totalBytes: number; availableBytes: number } | null = null;
  try {
    const stat = await statfs(UPLOADS_ROOT);
    disk = { totalBytes: stat.blocks * stat.bsize, availableBytes: stat.bavail * stat.bsize };
  } catch { /* Uploads pode nao existir em instalacao nova; nao simular zero. */ }
  return {
    memory: getMemoryUsage(),
    cpu: { userSeconds: cpu.user / 1e6, systemSeconds: cpu.system / 1e6 },
    eventLoop: {
      meanMs: Number.isFinite(loopDelay.mean) ? loopDelay.mean / 1e6 : 0,
      p99Ms: loopDelay.percentile(99) / 1e6,
      maxMs: loopDelay.max / 1e6,
    },
    disk,
  };
}

export function getResourceMetricsText(resources: Awaited<ReturnType<typeof getResourceMetrics>>): string {
  return [
    `scale_process_resident_memory_bytes ${resources.memory.rss}`,
    `scale_process_heap_used_bytes ${resources.memory.heapUsed}`,
    `scale_process_heap_total_bytes ${resources.memory.heapTotal}`,
    `scale_process_external_memory_bytes ${resources.memory.external}`,
    `scale_process_cpu_user_seconds_total ${resources.cpu.userSeconds}`,
    `scale_process_cpu_system_seconds_total ${resources.cpu.systemSeconds}`,
    `scale_event_loop_delay_mean_seconds ${resources.eventLoop.meanMs / 1000}`,
    `scale_event_loop_delay_p99_seconds ${resources.eventLoop.p99Ms / 1000}`,
    `scale_event_loop_delay_max_seconds ${resources.eventLoop.maxMs / 1000}`,
    ...(resources.disk ? [
      `scale_uploads_filesystem_size_bytes ${resources.disk.totalBytes}`,
      `scale_uploads_filesystem_available_bytes ${resources.disk.availableBytes}`,
    ] : []),
  ].join('\n');
}
