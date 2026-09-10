import type { FastifyInstance } from 'fastify';
import { getEnv } from '../lib/env.js';
import os from 'os';

function getLocalIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;
    for (const net of nets) {
      // Skip internal interfaces and non-IPv4
      if (!net.internal && net.family === 'IPv4') {
        return net.address;
      }
    }
  }
  return null;
}

export async function tailscaleRoutes(fastify: FastifyInstance): Promise<void> {
  // GET /api/tailscale/status
  fastify.get('/api/tailscale/status', async (_request, reply) => {
    const env = getEnv();
    const localIp = getLocalIp();
    const tailscaleIp = env.TAILSCALE_IP || null;
    // Docker não enxerga tailscale0 do host; só reporta 100.x se configurado via .env
    const isTailscaleIp = tailscaleIp?.startsWith('100.');

    return reply.send({
      tailscaleIp: tailscaleIp ?? null,
      localIp: localIp ?? null,
      configured: !!env.TAILSCALE_IP,
      interfaceDetected: !!isTailscaleIp,
      hint: !tailscaleIp ? 'Defina TAILSCALE_IP=100.x.y.z no .env do host (ex: 100.119.215.109 visto no print) e recrie os containers' : undefined,
    });
  });

  // GET /api/tailscale/ip
  fastify.get('/api/tailscale/ip', async (_request, reply) => {
    const env = getEnv();
    const tailscaleIp = env.TAILSCALE_IP || getLocalIp();

    if (!tailscaleIp) {
      return reply.code(404).send({
        error: 'No Tailscale IP detected',
        hint: 'Set TAILSCALE_IP in your .env file or ensure Tailscale is running',
      });
    }

    return reply.send({ ip: tailscaleIp });
  });
}
