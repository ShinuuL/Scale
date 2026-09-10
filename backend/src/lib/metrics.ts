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