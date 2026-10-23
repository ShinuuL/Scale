# Contexto de build: raiz do monorepo (docker-compose.yml -> build.context: .)
# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/server/package.json ./apps/server/
COPY apps/server/prisma ./apps/server/prisma
RUN npm install --workspace=@scale/shared --workspace=scale-backend
RUN npx prisma generate --schema=apps/server/prisma/schema.prisma
# @scale/shared: compilado para ESM + .d.ts antes do server (o server importa o dist).
COPY packages/shared ./packages/shared
RUN npm run build --workspace=@scale/shared
COPY apps/server ./apps/server
RUN npm run build --workspace=scale-backend

# ---- run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser
# /app/uploads: anexos do chat (lib/uploads.ts grava em cwd/uploads). Sem o
# diretório pré-criado com dono appuser, o mkdir em runtime dava EACCES e TODO
# upload (PDF, imagem...) respondia 500.
RUN mkdir -p /app/data /app/uploads && chown appuser:nodejs /app/data /app/uploads
COPY --from=builder /app/apps/server/dist ./dist
# Workspace-local deps that npm could not hoist into the root tree live in
# apps/server/node_modules (e.g. @fastify/multipart + its fastify-plugin@5 while
# the root tree uses fastify-plugin@6). Copy them beside dist/ so ESM
# resolution from dist/*.js finds them without clobbering root versions.
COPY --from=builder /app/apps/server/node_modules ./dist/node_modules
COPY --from=builder /app/node_modules ./node_modules
# node_modules/@scale/shared e um symlink do workspace para ../packages/shared:
# o alvo precisa existir na imagem final (so package.json + dist).
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/server/prisma ./prisma
COPY --from=builder /app/apps/server/package.json ./
USER appuser
EXPOSE 4000
# Apply the Prisma schema to the SQLite database (volume-backed /app/data)
# before booting. Idempotent; the repo has no migrations folder yet.
CMD ["sh", "-c", "npx prisma db push --schema=prisma/schema.prisma --skip-generate && node dist/server.js"]
