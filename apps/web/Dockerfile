# Imagem do servico `proxy`: Caddy servindo o frontend ESTATICO (next export)
# e roteando /api e /socket.io para o backend. Nao existe servidor Node do
# frontend em producao. Contexto de build: raiz do monorepo.

# ---- build stage: next build (output: 'export') -> apps/web/out ----
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN npm install --workspace=@scale/shared --workspace=scale-frontend
COPY packages/shared ./packages/shared
RUN npm run build --workspace=@scale/shared
COPY apps/web ./apps/web
# next build + scripts/csp.mjs (gera apps/web/.caddy/csp.caddy com os sha256
# dos scripts inline do export, importado pelo Caddyfile).
# URL publica (https) do instalador nativo do Windows; vazio = so o PWA.
ARG NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL=
ENV NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL=$NEXT_PUBLIC_DESKTOP_DOWNLOAD_URL
RUN npm run build --workspace=scale-frontend

# ---- run stage: Caddy com os estaticos ----
FROM caddy:2-alpine AS runner
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/apps/web/.caddy/csp.caddy /etc/caddy/csp.caddy
COPY --from=builder /app/apps/web/out /srv
EXPOSE 8080
