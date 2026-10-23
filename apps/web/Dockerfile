# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN npm install --workspace=@scale/shared --workspace=scale-frontend
COPY packages/shared ./packages/shared
RUN npm run build --workspace=@scale/shared
COPY apps/web ./apps/web
# Injetados pelo docker-compose (build.args). O Next inlina NEXT_PUBLIC_* no
# bundle do browser em BUILD time, entao precisam existir nesta etapa —
# caso contrario a imagem cai nos defaults de next.config.js.
ARG NEXT_PUBLIC_BACKEND_PORT=4000
ARG NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
ARG NEXT_PUBLIC_WS_URL=http://localhost:4000
ENV NEXT_PUBLIC_BACKEND_PORT=${NEXT_PUBLIC_BACKEND_PORT}
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
RUN npm run build --workspace=scale-frontend

# ---- run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Docker injects HOSTNAME (container id); Next.js standalone binds only to that
# address, leaving loopback unserved and breaking the container healthcheck.
# Pin HOSTNAME to 0.0.0.0 so the server listens on all interfaces.
ENV HOSTNAME=0.0.0.0
RUN apk add --no-cache wget
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
# standalone output in this monorepo nests under apps/web/ (verified from build output)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]