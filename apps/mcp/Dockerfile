# Contexto de build: raiz do monorepo (docker-compose.yml -> build.context: .)
# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/mcp/package.json ./apps/mcp/
RUN npm install --workspace=scale-mcp
COPY apps/mcp/tsconfig.json ./apps/mcp/
COPY apps/mcp/src ./apps/mcp/src
RUN npm run build --workspace=scale-mcp

# ---- run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget
COPY --from=builder /app/apps/mcp/dist ./dist
# Dependencias hoisted na raiz do workspace (fastify, @fastify/cors).
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/mcp/package.json ./
USER node
EXPOSE 4001
CMD ["node", "dist/index.js"]
