# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/
RUN npm install --workspace=frontend
COPY frontend ./frontend
COPY package.json ./
RUN npm run build --workspace=frontend

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
# standalone output in this monorepo nests under frontend/ (verified from build output)
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/frontend/public ./frontend/public
USER nextjs
EXPOSE 3000
CMD ["node", "frontend/server.js"]