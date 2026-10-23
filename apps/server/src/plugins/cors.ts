import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { getAllowedOrigins } from '../lib/env.js';

export async function corsPlugin(fastify: FastifyInstance): Promise<void> {
  await fastify.register(cors, {
    origin: getAllowedOrigins(),
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}

// `skip-override` reproduz o `fastify-plugin` (mesmo padrão de plugins/auth.ts)
// sem adicionar dependência. Sem ele, este plugin roda num contexto filho e o
// hook `onRequest` do @fastify/cors fica encapsulado: as rotas vivem nos
// contextos irmãos e o `Access-Control-Allow-Origin` nunca era emitido — medido:
// GET /api/health respondia sem o header. Mantenha este marcador.
(corsPlugin as unknown as Record<symbol, boolean>)[Symbol.for('skip-override')] = true;
