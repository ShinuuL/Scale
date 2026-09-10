# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY backend/package.json ./backend/
COPY backend/prisma ./backend/prisma
RUN npm install --workspace=backend
RUN npx prisma generate --schema=backend/prisma/schema.prisma
COPY backend ./backend
COPY package.json ./
RUN npm run build --workspace=backend

# ---- run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 appuser
RUN mkdir -p /app/data && chown appuser:nodejs /app/data
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/prisma ./prisma
COPY --from=builder /app/backend/package.json ./
USER appuser
EXPOSE 4000
# Apply the Prisma schema to the SQLite database (volume-backed /app/data)
# before booting. Idempotent; the repo has no migrations folder yet.
CMD ["sh", "-c", "npx prisma db push --schema=prisma/schema.prisma --skip-generate && node dist/server.js"]
