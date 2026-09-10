# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
COPY mcp/package.json ./mcp/
COPY mcp/tsconfig.json ./mcp/
COPY mcp/src ./mcp/src
RUN cd mcp && npm install
RUN cd mcp && npx tsc

# ---- run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
RUN apk add --no-cache wget
COPY --from=builder /app/mcp/dist ./dist
COPY --from=builder /app/mcp/node_modules ./node_modules
COPY --from=builder /app/mcp/package.json ./
USER node
EXPOSE 4001
CMD ["node", "dist/index.js"]
