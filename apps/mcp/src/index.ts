import { buildApp } from './app.js';
import { requireMcpToken } from './security.js';

const PORT = Number(process.env.PORT) || 4001;
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:4000';
// Token de servico (>= 32 chars) que o backend aceita em /api/metrics (mesmo
// valor de METRICS_SERVICE_TOKEN no backend). Sem ele /mcp/metrics devolve 503.
const METRICS_SERVICE_TOKEN = process.env.METRICS_SERVICE_TOKEN || '';

let mcpToken: string;
try {
  // Fail-closed: sem MCP_TOKEN forte (>= 32 caracteres) o servidor nao sobe.
  mcpToken = requireMcpToken(process.env.MCP_TOKEN);
} catch (err) {
  console.error(err instanceof Error ? err.message : 'MCP_TOKEN invalido');
  process.exit(1);
}

const server = buildApp({
  mcpToken,
  backendUrl: BACKEND_URL,
  metricsServiceToken: METRICS_SERVICE_TOKEN,
});

const start = async (): Promise<void> => {
  try {
    await server.listen({ port: PORT, host: '0.0.0.0' });
    server.log.info(`MCP Server running on port ${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
