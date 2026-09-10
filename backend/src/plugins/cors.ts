import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { getEnv } from '../lib/env.js';

export async function corsPlugin(fastify: FastifyInstance): Promise<void> {
  const env = getEnv();
  const origins = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

  await fastify.register(cors, {
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
}
